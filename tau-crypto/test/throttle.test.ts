// Throttling (src/pool/throttle.ts), the same for the CPU scan loop and the GPU loop:
// the idle time after each chunk, its range (0 to 0.99, so 1% of full speed), and the
// early wake-up that keeps a nearly idle miner quick to switch jobs, change speed and stop.
// The pool runs inline (main thread) with a real WASM kernel and a target nothing meets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAlgo } from '../src/algos.ts';
import { kernelSetup } from '../src/backends/setup.ts';
import { WorkerPool } from '../src/pool/pool.ts';
import { clampThrottle, idleMs, MAX_THROTTLE, Nap } from '../src/pool/throttle.ts';
import type { ScanJob } from '../src/types.ts';
import { GENESIS_WORDS, workData } from './helpers.ts';

const job = (seq: number): ScanJob => ({ seq, data: workData(GENESIS_WORDS), target: new Uint32Array(8), start: 0, end: 0xffffffff });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('the idle time keeps work at (1 - throttle) of the time; 0 to 0.99', () => {
  assert.equal(MAX_THROTTLE, 0.99);
  assert.equal(idleMs(100, 0), 0);
  assert.equal(idleMs(100, 0.5), 100);
  assert.equal(idleMs(100, 0.75), 300);
  assert.ok(Math.abs(idleMs(100, 0.99) - 9900) < 1e-6);
  assert.ok(Math.abs(idleMs(100, 1) - 9900) < 1e-6, 'clamped to 0.99');
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(idleMs(100, bad), 0, `throttle ${bad}`);
  assert.deepEqual([clampThrottle(-0.5), clampThrottle(0.3), clampThrottle(2), clampThrottle(Number.NaN)], [0, 0.3, 0.99, 0]);
});

test('a nap ends on its own, or at once when woken', async () => {
  const nap = new Nap();
  let t = Date.now();
  await nap.sleep(30);
  assert.ok(Date.now() - t >= 25);
  t = Date.now();
  const slept = nap.sleep(60_000);
  setTimeout(() => nap.wake(), 20);
  await slept;
  assert.ok(Date.now() - t < 1000, 'woken early');
});

async function inlinePool(chunkMs: number) {
  const pool = await WorkerPool.create(await kernelSetup('wasm-sse41', resolveAlgo('sha256d')), 1, { inline: true, chunkMs });
  const progress: { gen: number; hashes: number; at: number }[] = [];
  pool.on('progress', (e) => progress.push({ gen: e.gen, hashes: e.hashes, at: Date.now() }));
  return { pool, progress };
}

test('the scan loop hashes about (1 - throttle) as much', { timeout: 30_000 }, async () => {
  const { pool, progress } = await inlinePool(20);
  const hashesFor = async (throttle: number) => {
    pool.setThrottle(throttle);
    await wait(300); // settle on the chunk size
    const from = progress.length;
    await wait(1500);
    return progress.slice(from).reduce((s, p) => s + p.hashes, 0);
  };
  try {
    pool.assign(0, 1, job(1));
    const full = await hashesFor(0);
    const quarter = await hashesFor(0.75);
    const ratio = full / quarter;
    assert.ok(full > 0 && quarter > 0);
    assert.ok(ratio > 2.5 && ratio < 6.5, `full speed hashed ${ratio.toFixed(2)}× as much as 25% (expected about 4×)`);
  } finally {
    pool.terminate();
  }
});

test('at 1%, a new job and a new speed wake the loop instead of waiting out its idling', { timeout: 60_000 }, async () => {
  // Chunks of ~50 ms: at 1% each is followed by ~5 s of idling.
  const { pool, progress } = await inlinePool(50);
  /** Waits until a chunk is followed by a long idle: no progress for `quiet` ms. */
  const idling = async (quiet: number) => {
    for (let i = 0; i < 400; i++) {
      const n = progress.length;
      await wait(quiet);
      if (progress.length === n) return;
    }
    assert.fail('never idled');
  };
  try {
    pool.assign(0, 1, job(1));
    await wait(500); // full speed first, so the chunks grow to ~50 ms
    pool.setThrottle(0.99);
    await idling(1000); // a second without a chunk: idling for seconds

    let t = Date.now();
    pool.assign(0, 2, job(2));
    for (let i = 0; i < 100 && !progress.some((p) => p.gen === 2); i++) await wait(10);
    assert.ok(progress.some((p) => p.gen === 2), 'the new job started');
    assert.ok(Date.now() - t < 500, `without waiting out the idling (${Date.now() - t} ms)`);

    await idling(1000);
    const before = progress.length;
    t = Date.now();
    pool.setThrottle(0);
    for (let i = 0; i < 100 && progress.length < before + 3; i++) await wait(10);
    assert.ok(progress.length >= before + 3, 'full speed again');
    assert.ok(Date.now() - t < 500, `at once (${Date.now() - t} ms)`);
  } finally {
    pool.terminate();
  }
});
