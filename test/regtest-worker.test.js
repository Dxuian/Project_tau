// End to end, Cloudflare target: worker.js bundled by wrangler (as `wrangler
// deploy` would) runs in workerd via Miniflare, with D1 and Workers TCP sockets.
// The real miner mines through it to a regtest pool; POST /payout on the Worker
// pays the visitor 10% of the block, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { createWallet } from '../btc.js';
import { startRegtestPool } from './regtest-pool.js';
import { mineBlocks, nodeReady, ownerReward, regtest, regtestChainEnv } from './helpers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const core = regtest();

function bundleWorker(t) {
  const out = mkdtempSync(join(tmpdir(), 'tau-worker-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = spawnSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', out], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', HOME: out },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return { out, files: readdirSync(out) };
}

test('the Worker bundle holds the bridge and payouts, not the miner', (t) => {
  const { out, files } = bundleWorker(t);
  assert.ok(files.includes('worker.js'), files.join(', '));
  const code = readFileSync(join(out, 'worker.js'), 'utf8');
  assert.ok(!code.includes('gzipBase64'), 'no embedded WebAssembly in the Worker');
  assert.ok(code.includes('cloudflare:sockets'));
  const kib = Buffer.byteLength(code) / 1024;
  assert.ok(kib < 1024, `bundle is ${kib.toFixed(0)} KiB`);
});

test('Cloudflare target: a visitor finds a block through the Worker and is paid 10%, once', { skip: !core && 'BITCOIND_RPC not set (run ./dev test)', timeout: 300_000 }, async (t) => {
  await nodeReady(core);
  const { out } = bundleWorker(t);
  const owner = createWallet({ network: 'regtest' });
  const visitor = createWallet({ network: 'regtest' });
  const other = createWallet({ network: 'regtest' }).address;
  await core.rpc('generatetoaddress', [20, other]);
  const pool = await startRegtestPool({ rpc: core.rpc });
  t.after(() => pool.close());

  const mf = new Miniflare({
    modules: true,
    scriptPath: join(out, 'worker.js'),
    modulesRoot: out,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    host: '127.0.0.1',
    port: 0,
    bindings: {
      TAU_TARGET: 'cloudflare',
      TAU_NETWORK: 'regtest',
      TAU_POOL: pool.url,
      TAU_OWNER_ADDRESS: owner.address,
      TAU_STORAGE: 'd1',
      TAU_D1_BINDING: 'DB',
      TAU_CLIENT_SHARE_PERCENT: '10',
      ...regtestChainEnv(),
      OWNER_MNEMONIC: owner.mnemonic,
    },
  });
  t.after(() => mf.dispose());
  const url = await mf.ready;
  const payout = async () => {
    const res = await mf.dispatchFetch('http://worker.local/payout', { method: 'POST', body: JSON.stringify({ address: visitor.address }) });
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()).results;
  };
  const health = await (await mf.dispatchFetch('http://worker.local/health')).json();
  assert.equal(health.target, 'cloudflare');
  assert.equal(health.canPay, true);

  const blocks = await mineBlocks(visitor.address, `ws://127.0.0.1:${url.port}`, pool);
  assert.ok(pool.authorized.every((u) => u === owner.address), 'the Worker logged the visitor in as the owner');
  // The share records are in D1.
  const db = await mf.getD1Database('DB');
  const rows = (await db.prepare('SELECT visitor, block_hash FROM shares WHERE is_block = 1').all()).results;
  for (const b of blocks) assert.ok(rows.some((r) => r.block_hash === b.hash && r.visitor === visitor.address), `D1 has ${b.hash}`);

  assert.ok((await payout()).every((r) => r.status !== 'paid'), 'not mature yet');
  await core.rpc('generatetoaddress', [100, other]);
  const results = await payout();
  const paid = results.filter((r) => r.status === 'paid');
  assert.deepEqual(paid.map((r) => r.blockHash).sort(), blocks.map((b) => b.hash).sort(), JSON.stringify(results));
  let expected = 0n;
  for (const r of paid) {
    const reward = await ownerReward(core, r.blockHash, owner.address);
    assert.equal(r.payoutSats, String(reward / 10n));
    expected += reward / 10n;
  }
  await core.rpc('generatetoaddress', [1, other]);
  const coins = await core.utxos(visitor.address);
  assert.equal(coins.reduce((sum, c) => sum + c.value, 0n), expected);
  assert.ok((await payout()).filter((r) => paid.some((p) => p.blockHash === r.blockHash)).every((r) => r.status === 'already-paid'));
});
