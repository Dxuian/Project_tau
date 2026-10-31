// End to end, Node target, on a private regtest chain (real Bitcoin Core, no
// network): the real miner mines through the Node payout bridge to a fresh
// owner address (one per slot; 2 s here instead of an hour), bitcoind accepts
// the block, and POST /payout pays the visitor 10% of it, once, from that
// address, with the owner's 90% going back to its first address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWallet, newAddress } from '../tau-crypto/dist/wallet.js';
import { loadConfig } from '../server/config.js';
import { startNodeServer } from '../server/node/index.js';
import { startRegtestPool } from './regtest-pool.js';
import { FAST_SLOTS, mineBlocks, nextSlot, nodeReady, ownerReward, regtest, regtestChainEnv, slotAddresses } from './helpers.js';

const core = regtest();

test('Node target: a visitor mines to a fresh owner address and is paid 10% of each block, once, from it', { skip: !core && 'BITCOIND_RPC not set (run ./dev test)', timeout: 300_000 }, async (t) => {
  await nodeReady(core);
  const owner = createWallet({ network: 'regtest' });
  const visitor = createWallet({ network: 'regtest' });
  const other = createWallet({ network: 'regtest' }).address;
  await core.rpc('generatetoaddress', [20, other]);

  const dir = mkdtempSync(join(tmpdir(), 'tau-node-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pool = await startRegtestPool({ rpc: core.rpc });
  t.after(() => pool.close());
  const config = loadConfig({
    TAU_NETWORK: 'regtest',
    TAU_POOL: pool.url,
    TAU_OWNER_ADDRESS: owner.address,
    TAU_STORAGE_DIR: dir,
    TAU_LISTEN: '0',
    TAU_HOST: '127.0.0.1',
    ...FAST_SLOTS,
    ...regtestChainEnv(),
  });
  const server = await startNodeServer(config, { ownerMnemonic: owner.mnemonic });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;
  const payout = async () => {
    const res = await fetch(`${base}/payout`, { method: 'POST', body: JSON.stringify({ address: visitor.address }) });
    assert.equal(res.status, 200);
    return (await res.json()).results;
  };

  // GET /address: the slot's address, cacheable until the slot ends.
  const res = await fetch(`${base}/address`);
  const shown = await res.json();
  assert.equal(shown.address, newAddress(owner, { index: shown.index }).address);
  assert.match(res.headers.get('cache-control'), /^public, max-age=[0-2]$/);

  const t0 = Date.now();
  const blocks = await mineBlocks(visitor.address, `ws://127.0.0.1:${server.port}`, pool);
  const ours = slotAddresses(owner, t0);
  assert.ok(pool.authorized.every((u) => ours.has(u)), `the pool only ever saw the owner's slot addresses, not ${pool.authorized}`);
  assert.ok(pool.submits.every((p) => ours.has(p[0])));
  assert.ok(!pool.authorized.includes(owner.address), "a slot's address, never the owner's first");
  for (const b of blocks) assert.ok((await core.rpc('getblockheader', [b.hash])).confirmations >= 1, 'bitcoind accepted it');

  assert.ok((await payout()).every((r) => r.status !== 'paid'), 'not mature yet');
  await core.rpc('generatetoaddress', [100, other]);
  const results = await payout();
  const paid = results.filter((r) => r.status === 'paid');
  assert.deepEqual(paid.map((r) => r.blockHash).sort(), blocks.map((b) => b.hash).sort(), JSON.stringify(results));
  let expected = 0n;
  let change = 0n;
  for (const r of paid) {
    assert.equal(r.ownerAddress, blocks.find((b) => b.hash === r.blockHash).user, 'paid from the address the block paid');
    // What bitcoind says the block paid (the regtest subsidy halves every 150 blocks).
    const reward = await ownerReward(core, r.blockHash, r.ownerAddress);
    assert.equal(r.rewardSats, String(reward));
    assert.equal(r.payoutSats, String(reward / 10n));
    expected += reward / 10n;
    change += reward - reward / 10n - BigInt(r.feeSats);
  }
  assert.ok(results.filter((r) => r.status !== 'paid').every((r) => r.status === 'not-in-chain'));
  await core.rpc('generatetoaddress', [1, other]);
  const sum = (coins) => coins.reduce((s, c) => s + c.value, 0n);
  assert.equal(sum(await core.utxos(visitor.address)), expected);
  assert.equal(sum(await core.utxos(owner.address)), change, "the owner's 90% is at its first address");
  for (const b of blocks) assert.deepEqual(await core.utxos(b.user), [], 'the slot address was spent');
  const again = await payout();
  assert.ok(again.filter((r) => paid.some((p) => p.blockHash === r.blockHash)).every((r) => r.status === 'already-paid'));

  // A later session gets a later slot's address; a block that leaves the best chain is never paid.
  await nextSlot();
  const more = await mineBlocks(visitor.address, `ws://127.0.0.1:${server.port}`, pool);
  assert.ok(more.every((b) => !blocks.some((first) => first.user === b.user)), 'a fresh address');
  const orphan = more[more.length - 1].hash;
  await core.rpc('invalidateblock', [orphan]);
  await core.rpc('generatetoaddress', [101, other]);
  assert.equal((await payout()).find((r) => r.blockHash === orphan)?.status, 'not-in-chain');
});
