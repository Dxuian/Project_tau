// btc.browser.js in headless Chromium: it is up to date, creates wallets with
// the browser's crypto, and a visitor's page mines a block through the payout
// bridge (regtest pool, when bitcoind is available).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { bitcoinCore, createWallet, startPayoutBridge } from '../btc.js';
import { buildBrowser } from '../scripts/build-browser.mjs';
import { startRegtestPool } from './regtest-pool.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RPC = process.env.BITCOIND_RPC;
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import * as btc from '/btc.browser.js';
window.T = {
  create: () => btc.createWallet(),
  restore: (words) => btc.walletFromMnemonic(words).address,
  valid: (a) => btc.isValidAddress(a),
  async mine(address, bridge, pool) {
    const miner = await btc.mineBTC(address, bridge, { pool, network: 'regtest', threads: 2 });
    window.miner = miner;
    return miner.stats().state;
  },
  stop: () => window.miner?.stop(),
  async serverOnly() {
    try { await btc.verifyPayout(btc.createWallet().address, { ownerMnemonic: 'x' }); return 'ran'; } catch (e) { return e.message; }
  },
};
window.ready = true;
</script>`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

let server;
let browser;
let page;
let base;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      let body;
      if (path === '/') body = PAGE;
      else {
        const file = normalize(join(ROOT, path));
        if (!file.startsWith(normalize(ROOT + sep))) throw new Error('outside root');
        body = await readFile(file);
      }
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? (path === '/' ? 'text/html' : 'application/octet-stream') });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.ready === true);
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});

test('btc.browser.js is up to date with btc.js', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tau-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fresh = await buildBrowser(join(dir, 'btc.browser.js'));
  assert.equal(readFileSync(fresh, 'utf8'), readFileSync(join(ROOT, 'btc.browser.js'), 'utf8'), 'run ./dev build');
});

test('creates and restores wallets in the browser', async () => {
  const w = await page.evaluate(() => window.T.create());
  assert.equal(w.mnemonic.split(' ').length, 12);
  assert.match(w.address, /^bc1q/);
  assert.equal(await page.evaluate((m) => window.T.restore(m), w.mnemonic), w.address);
  const abandon = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  assert.equal(await page.evaluate((m) => window.T.restore(m), abandon), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(await page.evaluate(() => window.T.valid('nope')), false);
  assert.match(await page.evaluate(() => window.T.serverOnly()), /runs on the server/);
});

test('a page mines a block through the payout bridge', { skip: !RPC && 'BITCOIND_RPC not set (run ./dev test)', timeout: 180_000 }, async (t) => {
  const core = bitcoinCore({ url: RPC, user: process.env.BITCOIND_USER, pass: process.env.BITCOIND_PASS });
  const end = Date.now() + 30_000;
  while (!(await core.rpc('getblockchaininfo').then(() => true, () => false))) {
    if (Date.now() > end) throw new Error('bitcoind not ready');
    await new Promise((r) => setTimeout(r, 200));
  }
  const owner = createWallet({ network: 'regtest' });
  const visitor = createWallet({ network: 'regtest' });
  const ledgerDir = mkdtempSync(join(tmpdir(), 'tau-browser-'));
  t.after(() => rmSync(ledgerDir, { recursive: true, force: true }));
  const pool = await startRegtestPool({ rpc: core.rpc });
  t.after(() => pool.close());
  const bridge = await startPayoutBridge({ listen: 0, host: '127.0.0.1', pool: pool.url, ownerAddress: owner.address, network: 'regtest', ledgerDir });
  t.after(() => bridge.close());

  const before = pool.found.length;
  assert.equal(await page.evaluate(([a, b, p]) => window.T.mine(a, b, p), [visitor.address, `ws://127.0.0.1:${bridge.port}`, pool.url]), 'running');
  const deadline = Date.now() + 120_000;
  while (pool.found.length === before) {
    if (Date.now() > deadline) throw new Error('no block from the page');
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.evaluate(() => window.T.stop());
  assert.ok(pool.authorized.every((u) => u === owner.address));
  const block = pool.found[before].hash;
  const shares = readFileSync(join(ledgerDir, 'shares.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const record = shares.find((s) => s.type === 'share' && s.blockHash === block);
  assert.equal(record?.visitor, visitor.address, 'the block is recorded against the page\'s visitor');
});
