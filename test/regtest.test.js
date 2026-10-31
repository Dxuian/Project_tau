// End to end on a private regtest chain (real Bitcoin Core, no network): a
// visitor mines with the real cpuminer-opt-js miner through the payout bridge,
// bitcoind accepts the block, and verifyPayout pays the visitor 10% of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bitcoinCore, createWallet, mineBTC, startPayoutBridge, verifyPayout } from '../btc.js';
import { startRegtestPool } from './regtest-pool.js';

const RPC = process.env.BITCOIND_RPC;
const core = RPC && bitcoinCore({ url: RPC, user: process.env.BITCOIND_USER, pass: process.env.BITCOIND_PASS });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(condition, ms, what) {
  const end = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

async function nodeReady() {
  await until(() => core.rpc('getblockchaininfo').then(() => true, () => false), 30_000, 'bitcoind');
}

/** Mines through the bridge until the pool has `count` more blocks, then stops. */
async function mineBlocks(visitor, bridge, pool, count) {
  const before = pool.found.length;
  const miner = await mineBTC(visitor.address, `ws://127.0.0.1:${bridge.port}`, {
    pool: pool.url,
    network: 'regtest',
    threads: 2,
    backend: 'wasm-sha256-x8',
    gpu: false,
  });
  const errors = [];
  miner.on('error', (e) => errors.push(e.message));
  try {
    await until(() => pool.found.length >= before + count, 120_000, 'a block');
  } finally {
    await miner.stop();
  }
  return { blocks: pool.found.slice(before), errors };
}

test('a visitor finds blocks through the payout bridge and is paid 10% of each, once', { skip: !RPC && 'BITCOIND_RPC not set (run ./dev test)', timeout: 300_000 }, async (t) => {
  await nodeReady();
  const owner = createWallet({ network: 'regtest' });
  const visitor = createWallet({ network: 'regtest' });
  const other = createWallet({ network: 'regtest' }).address;
  await core.rpc('generatetoaddress', [20, other]);

  const ledgerDir = mkdtempSync(join(tmpdir(), 'tau-regtest-'));
  t.after(() => rmSync(ledgerDir, { recursive: true, force: true }));
  const pool = await startRegtestPool({ rpc: core.rpc });
  t.after(() => pool.close());
  const bridge = await startPayoutBridge({ listen: 0, host: '127.0.0.1', pool: pool.url, ownerAddress: owner.address, network: 'regtest', ledgerDir });
  t.after(() => bridge.close());
  const verify = () => verifyPayout(visitor.address, { network: 'regtest', chain: core, ownerMnemonic: owner.mnemonic, ledgerDir });

  const { blocks } = await mineBlocks(visitor, bridge, pool, 1);
  // The pool only ever saw the owner's address: the bridge rewrote the visitor's login.
  assert.ok(pool.authorized.length >= 1);
  assert.ok(pool.authorized.every((u) => u === owner.address), `pool saw ${pool.authorized}`);
  assert.ok(pool.submits.every((p) => p[0] === owner.address));
  for (const b of blocks) {
    const header = await core.rpc('getblockheader', [b.hash]);
    assert.ok(header.confirmations >= 1, 'bitcoind accepted the block into its best chain');
  }

  // Not mature yet: nothing is paid.
  assert.ok((await verify()).every((r) => r.status !== 'paid'));

  await core.rpc('generatetoaddress', [100, other]);
  const results = await verify();
  const paid = results.filter((r) => r.status === 'paid');
  assert.deepEqual(paid.map((r) => r.blockHash).sort(), blocks.map((b) => b.hash).sort(), JSON.stringify(results, (k, v) => (typeof v === 'bigint' ? String(v) : v)));
  for (const r of paid) {
    assert.equal(r.rewardSats, 5_000_000_000n); // the 50 BTC regtest subsidy
    assert.equal(r.payoutSats, 500_000_000n);
  }
  // Other candidates (shares the pool didn't turn into blocks) are not on the chain.
  assert.ok(results.filter((r) => r.status !== 'paid').every((r) => r.status === 'not-in-chain'));

  await core.rpc('generatetoaddress', [1, other]);
  const coins = await core.utxos(visitor.address);
  assert.equal(coins.reduce((sum, c) => sum + c.value, 0n), 500_000_000n * BigInt(blocks.length));
  assert.ok((await verify()).filter((r) => paid.some((p) => p.blockHash === r.blockHash)).every((r) => r.status === 'already-paid'));

  // A block that leaves the best chain is never paid.
  const { blocks: more } = await mineBlocks(visitor, bridge, pool, 1);
  const orphan = more[more.length - 1].hash;
  await core.rpc('invalidateblock', [orphan]);
  await core.rpc('generatetoaddress', [101, other]);
  const late = await verify();
  assert.equal(late.find((r) => r.blockHash === orphan)?.status, 'not-in-chain');
});
