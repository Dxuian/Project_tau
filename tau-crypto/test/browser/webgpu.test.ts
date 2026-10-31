// WebGPU kernel tests in headless Chromium (SwiftShader's software Vulkan in
// the dev container; no GPU needed). The kernel runs in the page; expected
// results come from node:crypto and the js kernel here, and crypto.subtle in
// the page. Skips, with the reason, only if Chromium offers no WebGPU adapter.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createJsKernel } from '../../src/backends/js.ts';
import { shareDiff } from '../../src/backends/sha256-js.ts';
import type { WebGpuKernelOptions } from '../../src/backends/webgpu.ts';
import { GENESIS_HASH, GENESIS_NONCE, GENESIS_WORDS, ROOT, diff1Target, displayHash, workData } from '../helpers.ts';
import { bundle, modulePage, serve } from './server.ts';
import type { PlainOutcome, WebGpuTestApi } from './webgpu-entry.ts';

const ALGOS = ['sha256d', 'sha256t', 'sha256q'] as const;
const PASSES: Record<string, number> = { sha256d: 2, sha256t: 3, sha256q: 4 };
const CHROMIUM_ARGS = ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const MAX = 0xffffffff;

// ------------------------------------------------------------------ setup

const dir = await mkdtemp(join(tmpdir(), 'cmo-webgpu-'));
await bundle(join(ROOT, 'test/browser/webgpu-entry.ts'), join(dir, 'entry.js'));
const server = await serve(dir, { '/index.html': modulePage('./entry.js') });
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const page = await browser.newPage();
const pageErrors: string[] = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(server.url);
await page.waitForFunction(() => (globalThis as Record<string, unknown>).__ready || (globalThis as Record<string, unknown>).__error);
const loadError = await page.evaluate(() => (globalThis as Record<string, unknown>).__error as string | undefined);
if (loadError) throw new Error(`test page failed to load: ${loadError}`);

after(async () => {
  await browser.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

/** Calls window.webgpuTests[name](...args) in the page. */
function call<K extends keyof WebGpuTestApi>(
  name: K,
  ...args: Parameters<WebGpuTestApi[K]>
): Promise<Awaited<ReturnType<WebGpuTestApi[K]>>> {
  return page.evaluate(
    ([n, a]) => {
      const api = (globalThis as unknown as { webgpuTests: Record<string, (...x: unknown[]) => unknown> }).webgpuTests;
      return api[n as string](...(a as unknown[]));
    },
    [name, args] as const,
  ) as Promise<Awaited<ReturnType<WebGpuTestApi[K]>>>;
}

const adapter = await call('adapter');
const skip = typeof adapter.error === 'string' ? `no WebGPU in headless Chromium: ${adapter.error}` : false;
if (skip) console.log(`# SKIPPING webgpu tests: ${skip}`);

// -------------------------------------------------------------- reference

let seed = 0x9e3779b9;
function rnd(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}
const randomWords = (): number[] => Array.from({ length: 20 }, rnd);

function refHash(algo: string, words: number[], nonce: number): number[] {
  const header = Buffer.alloc(80);
  for (let i = 0; i < 19; i++) header.writeUInt32BE(words[i] >>> 0, i * 4);
  header.writeUInt32BE(nonce >>> 0, 76);
  let d: Buffer = header;
  for (let p = 0; p < PASSES[algo]; p++) d = createHash('sha256').update(d).digest();
  return Array.from({ length: 8 }, (_, i) => d.readUInt32LE(i * 4));
}

/** hash <= target as 256-bit little-endian integers (independent of sha256-js). */
function leq(hash: ArrayLike<number>, target: ArrayLike<number>): boolean {
  let h = 0n;
  let t = 0n;
  for (let i = 7; i >= 0; i--) {
    h = (h << 32n) | BigInt(hash[i] >>> 0);
    t = (t << 32n) | BigInt(target[i] >>> 0);
  }
  return h <= t;
}

const gpuScan = (algo: string, words: number[], target: number[], start: number, end: number, options?: WebGpuKernelOptions) =>
  call('scan', algo, words, target, start, end, options ?? {});

function jsScan(algo: string, words: number[], target: number[], start: number, end: number): PlainOutcome {
  const k = createJsKernel({ backend: 'js', algo: { name: algo, id: 0, paramN: 0, paramR: 0, key: null } });
  const o = k.scan({ seq: 7, data: workData(words), target: Uint32Array.from(target), start, end });
  return {
    hashesDone: o.hashesDone,
    ms: 0,
    solutions: o.solutions.map((s) => ({
      seq: s.seq,
      nonce: s.data[19],
      data: Array.from(s.data),
      hash: Array.from(s.hash),
      shareDiff: s.shareDiff,
    })),
  };
}

/** Checks every reported solution against node:crypto and the target. */
function checkSolutions(algo: string, words: number[], target: number[], out: PlainOutcome): void {
  const data = Array.from(workData(words));
  let prev = -1;
  for (const s of out.solutions) {
    assert.ok(s.nonce > prev, 'solutions in increasing nonce order');
    prev = s.nonce;
    assert.equal(s.seq, 7);
    data[19] = s.nonce;
    assert.deepEqual(s.data, data, 'solution data = work data with the nonce');
    assert.deepEqual(s.hash, refHash(algo, words, s.nonce), `hash of nonce ${s.nonce}`);
    assert.ok(leq(s.hash, target), 'hash <= target');
    assert.equal(s.shareDiff, shareDiff(s.hash));
  }
}

// ------------------------------------------------------------------ tests

test('WebGPU adapter', { skip }, (t) => {
  t.diagnostic(`adapter: ${JSON.stringify(adapter)}`);
  assert.equal(typeof adapter.architecture, 'string');
});

test('sha256d finds exactly the genesis nonce in a ±256 window', { skip }, async () => {
  const target = Array.from(diff1Target());
  const out = await gpuScan('sha256d', GENESIS_WORDS, target, GENESIS_NONCE - 256, GENESIS_NONCE + 256);
  assert.equal(out.hashesDone, 512);
  assert.equal(out.solutions.length, 1);
  assert.equal(out.solutions[0].nonce, GENESIS_NONCE);
  assert.equal(displayHash(Uint32Array.from(out.solutions[0].hash)), GENESIS_HASH);
  checkSolutions('sha256d', GENESIS_WORDS, target, out);
});

test('early-exit boundaries: ties on hash words 7 and 6 (genesis)', { skip }, async () => {
  const h = refHash('sha256d', GENESIS_WORDS, GENESIS_NONCE); // h[7] = 0, h[6] = 0x0019d668
  const targets: number[][] = [
    h.slice(),
    [h[0] - 1, ...h.slice(1)],
    [MAX, MAX, MAX, MAX, MAX, MAX, h[6] - 1, h[7]],
    [0, 0, 0, 0, 0, 0, h[6], h[7]],
    [0, 0, 0, 0, 0, 0, h[6] + 1, h[7]],
    [MAX, MAX, MAX, MAX, MAX, h[5] - 1, h[6], h[7]],
    [0, 0, 0, 0, 0, h[5] + 1, h[6], h[7]],
    [0, 0, 0, 0, 0, 0, 0, h[7] + 1],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ];
  for (const target of targets) {
    const out = await gpuScan('sha256d', GENESIS_WORDS, target, GENESIS_NONCE, GENESIS_NONCE + 1);
    assert.equal(out.solutions.length, leq(h, target) ? 1 : 0, `target ${target.map((x) => x.toString(16))}`);
    checkSolutions('sha256d', GENESIS_WORDS, target, out);
  }
});

test('targets next to random hashes (ties on words 7 / 6 / 5)', { skip }, async () => {
  for (const algo of ALGOS) {
    for (let k = 0; k < 6; k++) {
      const words = randomWords();
      const n = 2 + (rnd() % (2 ** 32 - 8));
      const h = refHash(algo, words, n);
      const targets: number[][] = [h.slice(), [MAX, MAX, MAX, MAX, MAX, MAX, MAX, h[7]]];
      if (h[0] > 0) targets.push([h[0] - 1, ...h.slice(1)]);
      if (h[7] > 0) targets.push([MAX, MAX, MAX, MAX, MAX, MAX, MAX, h[7] - 1]);
      if (h[7] < MAX) targets.push([0, 0, 0, 0, 0, 0, 0, h[7] + 1]);
      if (h[6] > 0) targets.push([MAX, MAX, MAX, MAX, MAX, MAX, h[6] - 1, h[7]]);
      if (h[6] < MAX) targets.push([0, 0, 0, 0, 0, 0, h[6] + 1, h[7]]);
      if (h[5] > 0) targets.push([MAX, MAX, MAX, MAX, MAX, h[5] - 1, h[6], h[7]]);
      if (h[5] < MAX) targets.push([0, 0, 0, 0, 0, h[5] + 1, h[6], h[7]]);
      const window = [n - 2, n - 1, n, n + 1, n + 2];
      const hashes = window.map((x) => refHash(algo, words, x));
      for (const target of targets) {
        const out = await gpuScan(algo, words, target, n - 2, n + 3);
        const expected = window.filter((_, i) => leq(hashes[i], target));
        assert.deepEqual(out.solutions.map((s) => s.nonce), expected, `${algo} target ${target.map((x) => x.toString(16))}`);
        checkSolutions(algo, words, target, out);
      }
    }
  }
});

test('random headers: every hash matches crypto.subtle (in page) and node:crypto', { skip }, async () => {
  const target = new Array(8).fill(MAX);
  for (const algo of ALGOS) {
    for (let k = 0; k < 24; k++) {
      const words = randomWords();
      const start = rnd() % (2 ** 32 - 32);
      const out = await gpuScan(algo, words, target, start, start + 32);
      assert.equal(out.hashesDone, 32);
      const nonces = Array.from({ length: 32 }, (_, i) => start + i);
      assert.deepEqual(out.solutions.map((s) => s.nonce), nonces);
      const subtle = await call('subtleHashes', algo, words, nonces);
      assert.deepEqual(out.solutions.map((s) => s.hash), subtle, `${algo} vs crypto.subtle`);
      checkSolutions(algo, words, target, out);
    }
  }
});

type Stats = { submissions: number; dispatches: number; grids2d: number; rescans: number; candidates: number };
async function stats(algo: string, options?: WebGpuKernelOptions): Promise<Stats> {
  return (await call('kernelInfo', algo, options ?? {})).stats as Stats;
}
const delta = (a: Stats, b: Stats): Stats => ({
  submissions: b.submissions - a.submissions,
  dispatches: b.dispatches - a.dispatches,
  grids2d: b.grids2d - a.grids2d,
  rescans: b.rescans - a.rescans,
  candidates: b.candidates - a.candidates,
});

test('many dispatches per scan (small dispatches, 2D grids, several submissions)', { skip }, async () => {
  const split: WebGpuKernelOptions = { workgroupSize: 64, dispatchNonces: 1000, dispatchesPerSubmit: 3, maxWorkgroupsPerDimension: 4 };
  const target = [MAX, MAX, MAX, MAX, MAX, MAX, MAX, 0x003fffff];
  for (const algo of ALGOS) {
    const words = randomWords();
    const start = 2 ** 31 - 7000;
    const expected = jsScan(algo, words, target, start, start + 20000);
    assert.ok(expected.solutions.length > 5 && expected.solutions.length < 64, `${expected.solutions.length} solutions`);
    const before = await stats(algo, split);
    const small = await gpuScan(algo, words, target, start, start + 20000, split);
    const used = delta(before, await stats(algo, split));
    // 20 dispatches of 1000 nonces = 16 workgroups of 64 in a 4 x 4 grid, 3 per submission.
    assert.deepEqual(used, { submissions: 7, dispatches: 20, grids2d: 20, rescans: 0, candidates: used.candidates });
    assert.ok(used.candidates >= expected.solutions.length);
    const whole = await gpuScan(algo, words, target, start, start + 20000);
    assert.equal(small.hashesDone, 20000);
    assert.deepEqual(small.solutions, expected.solutions, `${algo}: split kernel vs js kernel`);
    assert.deepEqual(whole.solutions, expected.solutions, `${algo}: default kernel vs js kernel`);
    checkSolutions(algo, words, target, small);
  }
  const info = await call('kernelInfo', 'sha256d', split);
  assert.equal(info.granularity, 64);
  // A grid of at most 2 x 2 workgroups caps a dispatch at 256 nonces.
  const tiny = { ...split, maxWorkgroupsPerDimension: 2 };
  const words = randomWords();
  const before = await stats('sha256d', tiny);
  const out = await gpuScan('sha256d', words, target, 0, 20000, tiny);
  assert.deepEqual(delta(before, await stats('sha256d', tiny)).dispatches, 79);
  assert.deepEqual(out.solutions, jsScan('sha256d', words, target, 0, 20000).solutions);
});

test('candidate overflow re-scans and keeps the first 64 solutions in nonce order', { skip }, async () => {
  const words = randomWords();
  const start = 123456;
  const all = new Array(8).fill(MAX);
  for (const options of [{}, { candidateCap: 8 }, { candidateCap: 8, dispatchNonces: 100 }] as WebGpuKernelOptions[]) {
    const before = await stats('sha256d', options);
    const out = await gpuScan('sha256d', words, all, start, start + 1000, options);
    assert.ok(delta(before, await stats('sha256d', options)).rescans > 0, 'overflowing dispatches were re-scanned');
    assert.equal(out.hashesDone, 1000);
    assert.deepEqual(
      out.solutions.map((s) => s.nonce),
      Array.from({ length: 64 }, (_, i) => start + i),
      JSON.stringify(options),
    );
    checkSolutions('sha256d', words, all, out);
    const half = [MAX, MAX, MAX, MAX, MAX, MAX, MAX, 0x7fffffff];
    const got = await gpuScan('sha256d', words, half, start, start + 1000, options);
    assert.deepEqual(got.solutions, jsScan('sha256d', words, half, start, start + 1000).solutions);
  }
});

test('nonce range ending at 2^32', { skip }, async () => {
  for (const algo of ALGOS) {
    const words = randomWords();
    const target = [MAX, MAX, MAX, MAX, MAX, MAX, MAX, 0x0fffffff];
    const out = await gpuScan(algo, words, target, 2 ** 32 - 300, 2 ** 32);
    assert.equal(out.hashesDone, 300);
    assert.deepEqual(out.solutions, jsScan(algo, words, target, 2 ** 32 - 300, 2 ** 32).solutions);
    const all = new Array(8).fill(MAX);
    const tail = await gpuScan(algo, words, all, 2 ** 32 - 16, 2 ** 32);
    assert.deepEqual(tail.solutions.map((s) => s.nonce), Array.from({ length: 16 }, (_, i) => 2 ** 32 - 16 + i));
    checkSolutions(algo, words, all, tail);
  }
});

test('concurrent scans on one kernel are queued, each result intact', { skip }, async () => {
  const a = randomWords();
  const b = randomWords();
  const target = [MAX, MAX, MAX, MAX, MAX, MAX, MAX, 0x00ffffff];
  const [outA, outB] = await call('scanPair', 'sha256t', a, b, target, 5000, 25000);
  assert.deepEqual(outA.solutions, jsScan('sha256t', a, target, 5000, 25000).solutions);
  assert.deepEqual(outB.solutions, jsScan('sha256t', b, target, 5000, 25000).solutions);
});

test('hashesDone, empty and odd-sized ranges', { skip }, async () => {
  const words = randomWords();
  const all = new Array(8).fill(MAX);
  const empty = await gpuScan('sha256d', words, all, 1000, 1000);
  assert.deepEqual([empty.hashesDone, empty.solutions.length], [0, 0]);
  const odd = await gpuScan('sha256d', words, all, 5, 18);
  assert.equal(odd.hashesDone, 13);
  assert.deepEqual(odd.solutions.map((s) => s.nonce), Array.from({ length: 13 }, (_, i) => 5 + i));
  const info = await call('kernelInfo', 'sha256d');
  assert.equal(info.granularity, 256);
  assert.ok((info.memoryBytes as number) > 0);
});

test('errors surface as rejected promises with clear messages', { skip }, async (t) => {
  const messages = {
    afterDispose: await call('afterDispose'),
    afterDeviceLoss: await call('afterDeviceLoss'),
    lossDuringScan: await call('lossDuringScan'),
    badAlgo: await call('createError', 'scrypt', {}),
    badWorkgroup: await call('createError', 'sha256d', { workgroupSize: 4096 }),
  };
  t.diagnostic(JSON.stringify(messages));
  assert.match(messages.afterDispose, /disposed/);
  assert.match(messages.afterDeviceLoss, /^WebGPU device lost/);
  assert.match(messages.lossDuringScan, /^in flight: WebGPU device lost/);
  assert.match(messages.badAlgo, /does not implement scrypt/);
  assert.match(messages.badWorkgroup, /workgroup size 4096/);
  assert.deepEqual(pageErrors, []);
});

test('throughput (informational)', { skip }, async (t) => {
  const words = randomWords();
  for (const algo of ALGOS) {
    const n = 1 << 22;
    const out = await gpuScan(algo, words, [0, 0, 0, 0, 0, 0, 0, 0], 0, n);
    t.diagnostic(`webgpu ${algo}: ${((n / out.ms) * 1e3 / 1e6).toFixed(1)} MH/s on ${adapter.vendor}/${adapter.architecture}`);
  }
});
