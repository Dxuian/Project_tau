// The built library (dist/) in headless Chromium: detection, lazy WASM
// loading, Blob-URL workers, autotune with the GPU, and a full mining flow
// page -> bridge (WebSocket) -> mock pool (TCP) with Bitcoin block 1.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { MockPool } from '../mock-pool.ts';
import { BLOCK1, GENESIS_HASH, GENESIS_WORDS, headerBytes, ROOT } from '../helpers.ts';
import { serve, type StaticServer } from './server.ts';

const BUILT = existsSync(`${ROOT}dist/index.js`);
const CHROMIUM_ARGS = ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];

// Page-side helpers: everything the tests drive, returning plain data.
const PAGE = `<!doctype html><meta charset="utf-8"><title>dist test</title>
<script type="module">
import * as lib from '/dist/index.js';
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
window.T = {
  async detect() { return lib.detect(); },
  algoCount() { return lib.listAlgorithms().length; },
  async hash(headerHex) {
    const h = await lib.hash('sha256d', new Uint8Array(headerHex.match(/../g).map((x) => parseInt(x, 16))));
    return hex([...h].reverse());
  },
  async tune() {
    const p = await lib.autotune(lib.resolveAlgo('sha256d'), { mode: 'quick', warmupMs: 50, measureMs: 150 });
    return { cpu: p.cpu, gpu: p.gpu, measurements: p.measurements.map((m) => ({ backend: m.backend, hps: m.hps, error: m.error })) };
  },
  async mine(opts) {
    const miner = await lib.createMiner(opts);
    const shares = [];
    const errors = [];
    miner.on('share', (s) => shares.push(s));
    miner.on('error', (e) => errors.push(e.message));
    window.miner = miner;
    await miner.start();
    for (let i = 0; i < 400 && !shares.length; i++) await new Promise((r) => setTimeout(r, 25));
    const stats = miner.stats();
    await miner.stop();
    return { shares, errors, stats, after: miner.stats().state };
  },
};
window.__ready = true;
</script>`;

let server: StaticServer;
let browser: Browser;
let page: Page;

before(async () => {
  if (!BUILT) return;
  server = await serve(ROOT, { '/index.html': PAGE });
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
  page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(server.url);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const skip = !BUILT && 'run ./dev build first';

test('detect() in Chromium', { skip, timeout: 120_000 }, async () => {
  const caps = await page.evaluate(() => (window as any).T.detect());
  assert.equal(caps.runtime, 'browser');
  assert.equal(caps.wasm.available, true);
  assert.equal(caps.wasm.simd128, true);
  assert.equal(caps.workers, true, 'Blob-URL Web Workers are allowed');
  assert.ok(caps.cores >= 1);
  assert.ok(caps.webgpu, 'WebGPU adapter (SwiftShader) detected');
  assert.equal(await page.evaluate(() => (window as any).T.algoCount()), 91);
});

test('hash() loads the embedded WASM in the browser', { skip, timeout: 120_000 }, async () => {
  const h = await page.evaluate((x) => (window as any).T.hash(x), headerBytes(GENESIS_WORDS).toString('hex'));
  assert.equal(h, GENESIS_HASH);
});

test('quick autotune measures WASM in Blob workers and the WebGPU kernel', { skip, timeout: 120_000 }, async () => {
  const plan = await page.evaluate(() => (window as any).T.tune());
  const names = plan.measurements.map((m: { backend: string }) => m.backend);
  assert.ok(names.includes('wasm-sha256-x8'), names.join(','));
  assert.ok(names.includes('webgpu'), names.join(','));
  for (const m of plan.measurements) assert.ok(m.hps > 0, `${m.backend}: ${m.error ?? 'no rate'}`);
  assert.ok(plan.cpu.threads >= 1);
  assert.ok(plan.gpu && plan.gpu.hps > 0);
});

test('mines Bitcoin block 1 from the page through the bridge', { skip, timeout: 120_000 }, async () => {
  const pool = await MockPool.start({ extranonce1: BLOCK1.xnonce1, extranonce2Size: 4 });
  const bridge: Bridge = await createBridge({ port: 0, host: '127.0.0.1', allow: [pool.target] });
  try {
    const run = page.evaluate(
      (o) => (window as any).T.mine(o),
      {
        algo: 'sha256d',
        url: pool.url,
        bridge: `ws://127.0.0.1:${bridge.port}`,
        user: 'bc1qbrowsertest',
        backend: 'wasm-sha256-x8',
        threads: 2,
        gpu: false,
        warmupMs: 20,
        measureMs: 50,
        nonceRange: { start: BLOCK1.nonceWord - 5000, end: BLOCK1.nonceWord + 5000 },
      },
    );
    await pool.waitForMethod('mining.authorize');
    pool.setDifficulty(1);
    pool.notify(BLOCK1.notify('b1'));
    const submit = await pool.waitForMethod('mining.submit');
    assert.deepEqual(submit.params, ['bc1qbrowsertest', 'b1', '00000000', '4966bc61', '9962e301']);
    const r = await run;
    assert.deepEqual(r.errors, []);
    assert.equal(r.shares.length, 1);
    assert.equal(r.shares[0].accepted, true);
    assert.equal(r.stats.accepted, 1);
    assert.equal(r.after, 'stopped');
  } finally {
    await bridge.close();
    await pool.close();
  }
});
