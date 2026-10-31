// End to end, Node target, on a private regtest chain (real Bitcoin Core, no
// network): the real miner mines through server.js's payout bridge, bitcoind
// accepts the block, and POST /payout pays the visitor 10% of it, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWallet } from '../tau-crypto/dist/wallet.js';
import { loadConfig } from '../server/config.js';
import { startNodeServer } from '../server/node/index.js';
import { startRegtestPool } from './regtest-pool.js';
import { mineBlocks, nodeReady, ownerReward, regtest, regtestChainEnv } from './helpers.js';

const core = regtest();

test('Node target: a visitor finds blocks through the payout bridge and is paid 10% of each, once', { skip: !core && 'BITCOIND_RPC not set (run ./dev test)', timeout: 300_000 }, async (t) => {
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
    ...regtestChainEnv(),
  });
  const server = await startNodeServer(config, { ownerMnemonic: owner.mnemonic });
  t.after(() => server.close());
  const payout = async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/payout`, { method: 'POST', body: JSON.stringify({ address: visitor.address }) });
    assert.equal(res.status, 200);
    return (await res.json()).results;
  };

  const blocks = await mineBlocks(visitor.address, `ws://127.0.0.1:${server.port}`, pool);
  assert.ok(pool.authorized.every((u) => u === owner.address), `the pool only ever saw the owner, not ${pool.authorized}`);
  assert.ok(pool.submits.every((p) => p[0] === owner.address));
  for (const b of blocks) assert.ok((await core.rpc('getblockheader', [b.hash])).confirmations >= 1, 'bitcoind accepted it');

  assert.ok((await payout()).every((r) => r.status !== 'paid'), 'not mature yet');
  await core.rpc('generatetoaddress', [100, other]);
  const results = await payout();
  const paid = results.filter((r) => r.status === 'paid');
  assert.deepEqual(paid.map((r) => r.blockHash).sort(), blocks.map((b) => b.hash).sort(), JSON.stringify(results));
  let expected = 0n;
  for (const r of paid) {
    // What bitcoind says the block paid the owner (the regtest subsidy halves every 150 blocks).
    const reward = await ownerReward(core, r.blockHash, owner.address);
    assert.equal(r.rewardSats, String(reward));
    assert.equal(r.payoutSats, String(reward / 10n));
    expected += reward / 10n;
  }
  assert.ok(results.filter((r) => r.status !== 'paid').every((r) => r.status === 'not-in-chain'));
  await core.rpc('generatetoaddress', [1, other]);
  const coins = await core.utxos(visitor.address);
  assert.equal(coins.reduce((sum, c) => sum + c.value, 0n), expected);
  const again = await payout();
  assert.ok(again.filter((r) => paid.some((p) => p.blockHash === r.blockHash)).every((r) => r.status === 'already-paid'));

  // A block that leaves the best chain is never paid.
  const more = await mineBlocks(visitor.address, `ws://127.0.0.1:${server.port}`, pool);
  const orphan = more[more.length - 1].hash;
  await core.rpc('invalidateblock', [orphan]);
  await core.rpc('generatetoaddress', [101, other]);
  assert.equal((await payout()).find((r) => r.blockHash === orphan)?.status, 'not-in-chain');
});
