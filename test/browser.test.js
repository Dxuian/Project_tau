// A visitor's page in headless Chromium, using the library's dist/ directly:
// creates a wallet, mines a regtest block through the Node payout bridge, and
// asks for its payout over CORS. The block is recorded against the page's visitor.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createWallet, loadConfig, startNodeServer } from '../btc.js';
import { startRegtestPool } from './regtest-pool.js';
import { nodeReady, regtest, regtestChainEnv, until } from './helpers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const core = regtest();
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { mineBTC } from '/cpuminer-opt-js/dist/index.js';
import { createWallet } from '/cpuminer-opt-js/dist/wallet.js';
window.T = {
  wallet: () => createWallet({ network: 'regtest' }),
  async mine(address, bridge, pool) {
    window.miner = await mineBTC(address, bridge, { pool, network: 'regtest', threads: 2 });
    return window.miner.stats().state;
  },
  stop: () => window.miner?.stop(),
  async payout(api, address) {
    const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) });
    return { status: res.status, body: await res.json() };
  },
};
window.ready = true;
</script>`;

let site;
let browser;
let page;
let origin;

before(async () => {
  site = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(normalize(ROOT + sep))) throw new Error('outside root');
      const body = path === '/' ? PAGE : await readFile(file);
      res.writeHead(200, { 'content-type': path === '/' ? 'text/html' : extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => window.ready === true);
});

after(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
});

test('a page mines a block through the payout bridge and asks for its payout', { skip: !core && 'BITCOIND_RPC not set (run ./dev test)', timeout: 240_000 }, async (t) => {
  await nodeReady(core);
  const owner = createWallet({ network: 'regtest' });
  const visitor = await page.evaluate(() => window.T.wallet());
  assert.match(visitor.address, /^bcrt1q/);
  const dir = mkdtempSync(join(tmpdir(), 'tau-browser-'));
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
    TAU_ORIGINS: origin,
    ...regtestChainEnv(),
  });
  const server = await startNodeServer(config, { ownerMnemonic: owner.mnemonic });
  t.after(() => server.close());

  const before = pool.found.length;
  assert.equal(await page.evaluate(([a, b, p]) => window.T.mine(a, b, p), [visitor.address, `ws://127.0.0.1:${server.port}`, pool.url]), 'running');
  await until(() => pool.found.length > before, 120_000, 'a block from the page');
  await page.evaluate(() => window.T.stop());
  assert.ok(pool.authorized.every((u) => u === owner.address));
  const block = pool.found[before].hash;
  const records = readFileSync(join(dir, 'blocks.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(records.find((r) => r.blockHash === block)?.visitor, visitor.address, "recorded against the page's visitor");
  const res = await page.evaluate(([api, a]) => window.T.payout(api, a), [`http://127.0.0.1:${server.port}/payout`, visitor.address]);
  assert.equal(res.status, 200, 'CORS allowed the page');
  assert.equal(res.body.results.find((r) => r.blockHash === block)?.status, 'immature');
});
