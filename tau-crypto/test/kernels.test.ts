// Hand-written sha256d / sha256t / sha256q kernels (js, node-crypto) and the
// sha256-js primitives, checked against node:crypto and the compiled upstream
// cpuminer-opt.
//
// Upstream references: the sse41 build (4-way scanhash code) for sha256d and
// sha256t. Its 4-way sha256q hashes a corrupted header (upstream bug, pinned
// down by a test below), so sha256q is compared with the avx2 build's 8-way
// path instead; like upstream's scalar sha256q, that one runs its nonce
// counter byte-swapped (it reports data[19] = bswap32(counter)), so single
// nonces are looked up through bswap32. Upstream's 4-way loops also stop 4
// nonces before max_nonce; the kernels here hash exactly [start, end).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../src/backends/index-sha256.ts';
import { getBackend } from '../src/backends/registry.ts';
import {
  bswap32,
  checkScanJob,
  hashHex,
  MAX_SOLUTIONS,
  SHA256_IV,
  sha256Compress,
  sha256HashNonce,
  sha256Midstate,
  sha256Passes,
  sha256Prehash,
  shareDiff,
  validHash,
} from '../src/backends/sha256-js.ts';
import { createWebGpuKernel } from '../src/backends/webgpu.ts';
import type { AlgoSpec, BackendName, Capabilities, FoundSolution, Kernel, ScanJob } from '../src/types.ts';
import type { Cmo, Solution } from '../src/wasm/api.ts';
import {
  GENESIS_HASH,
  GENESIS_NONCE,
  GENESIS_WORDS,
  builtVariants,
  diff1Target,
  displayHash,
  headerBytes,
  scanInstance,
  workData,
  type VariantName,
} from './helpers.ts';

const ALGOS = ['sha256d', 'sha256t', 'sha256q'] as const;
type Algo = (typeof ALGOS)[number];
const PASSES: Record<Algo, number> = { sha256d: 2, sha256t: 3, sha256q: 4 };
const BACKENDS = ['js', 'node-crypto'] as const satisfies readonly BackendName[];
const REFERENCE: Record<Algo, VariantName> = { sha256d: 'sse41', sha256t: 'sse41', sha256q: 'avx2' };
const MAX = 0xffffffff;
const MAX_TARGET = new Uint32Array(8).fill(MAX);
/** Highest target[7] for which upstream's 4-way sha256q scanner hashes anything. */
const Q4_TARGET = Uint32Array.of(MAX, MAX, MAX, MAX, MAX, MAX, MAX, 0x10000000);

const hex = (words: ArrayLike<number>): string => Array.from(words, (w) => (w >>> 0).toString(16).padStart(8, '0')).join(' ');

let seed = 0x2545f491;
function rnd(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}
const randomWords = (): number[] => Array.from({ length: 20 }, rnd);

/** Final hash (8 LE words) of `algo` over the header of `data` with `nonce`, via node:crypto. */
function refHash(algo: Algo, data: ArrayLike<number>, nonce: number): Uint32Array {
  const header = headerBytes(data, 20);
  header.writeUInt32BE(nonce >>> 0, 76);
  let d: Buffer = header;
  for (let p = 0; p < PASSES[algo]; p++) d = createHash('sha256').update(d).digest();
  return Uint32Array.from({ length: 8 }, (_, i) => d.readUInt32LE(i * 4));
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

// Upstream scan instances (one per algo) and the AlgoSpecs they resolve to.
assert.ok(builtVariants().includes('sse41') && builtVariants().includes('avx2'), 'needs the sse41 and avx2 WASM builds');
const upstream = new Map<Algo, Cmo>();
const specs = new Map<Algo, AlgoSpec>();
for (const algo of ALGOS) {
  const cmo = await scanInstance(REFERENCE[algo], algo);
  upstream.set(algo, cmo);
  const r = cmo.resolve(algo)!;
  specs.set(algo, { name: algo, id: r.id, paramN: r.paramN, paramR: 0, key: null });
}

/** Upstream's solutions among nonces [start, end), in nonce order. */
function upstreamScan(algo: Algo, data: Uint32Array, target: Uint32Array, start: number, end: number): Solution[] {
  const cmo = upstream.get(algo)!;
  cmo.setScanWork(data, target);
  if (algo !== 'sha256q') {
    cmo.scan(start, end + 4); // the 4-way loop stops 4 nonces early
    return cmo.solutions().filter((s) => s.data[19] >= start && s.data[19] < end);
  }
  const out: Solution[] = [];
  for (let n = start; n < end; n++) {
    const counter = bswap32(n); // the 8-way loop's counter for nonce n
    cmo.scan(counter, (counter + 16) >>> 0);
    out.push(...cmo.solutions().filter((s) => s.data[19] === n));
  }
  return out;
}

const kernels = new Map<string, Kernel>();
async function kernel(backend: BackendName, algo: Algo): Promise<Kernel> {
  const key = `${backend} ${algo}`;
  let k = kernels.get(key);
  if (!k) {
    k = await getBackend(backend).create({ backend, algo: specs.get(algo)! });
    kernels.set(key, k);
  }
  return k;
}

async function scan(backend: BackendName, algo: Algo, job: ScanJob) {
  return (await kernel(backend, algo)).scan(job);
}

const job = (data: Uint32Array, target: Uint32Array, start: number, end: number, seq = 11): ScanJob => ({
  seq,
  data,
  target,
  start,
  end,
});

function assertSolution(algo: Algo, j: ScanJob, s: FoundSolution, nonce: number): void {
  const data = j.data.slice();
  data[19] = nonce;
  assert.equal(s.seq, j.seq);
  assert.deepEqual(s.data, data);
  assert.deepEqual(s.hash, refHash(algo, j.data, nonce), `${algo} hash of nonce ${nonce}`);
  assert.ok(leq(s.hash, j.target));
  assert.equal(s.shareDiff, shareDiff(s.hash));
}

function assertSameAsUpstream(ours: FoundSolution[], theirs: { data: Uint32Array; hash: Uint32Array; shareDiff: number }[]): void {
  assert.equal(ours.length, theirs.length, 'solution count vs upstream');
  ours.forEach((s, i) => {
    assert.deepEqual(s.data, theirs[i].data, 'data vs upstream');
    assert.deepEqual(s.hash, theirs[i].hash, 'hash vs upstream');
    assert.equal(s.shareDiff, theirs[i].shareDiff, 'shareDiff vs upstream');
  });
}

// --------------------------------------------------------------- sha256-js

test('sha256-js: genesis intermediate vectors', () => {
  const data = workData(GENESIS_WORDS);
  const pre = sha256Prehash(data);
  assert.equal(hex(pre.midstate), 'bc909a33 6358bff0 90ccac7d 1e59caa8 c3c8d8e9 4f0103c8 96b18736 4719f91b');
  assert.deepEqual(pre.midstate, sha256Midstate(data));
  // Upstream keeps the round-4 state in its A..H variables rotated by four.
  const upstreamOrder = Array.from({ length: 8 }, (_, j) => pre.state4[(j + 4) & 7]);
  assert.equal(hex(upstreamOrder), 'a979115f 238956e3 af5e1cba a8a8881c 7ab4e0a4 de845910 1f8aee5c b7f888df');
  assert.equal(hex(pre.x), '8bd2d587 0ec2c145 3050c043 4989b609 00a00055 ab0c206f c76773a1');
  const block1 = [data[16], data[17], data[18], GENESIS_NONCE, 0x80000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 640];
  const digest = sha256Compress(pre.midstate, block1);
  assert.equal(hex(digest), 'af42031e 805ff493 a07341e2 f74ff581 49d22ab9 ba19f613 43e2c86c 71c5d66d');
  const hash = sha256HashNonce(data, GENESIS_NONCE, 2);
  assert.equal(hex(hash), '0a8ce26f 72b3f1b6 46a2a6c1 4ff763ae 65831e93 9c085ae1 0019d668 00000000');
  assert.equal(hashHex(hash), GENESIS_HASH);
  assert.deepEqual(sha256HashNonce(data, GENESIS_NONCE, 2, new Uint32Array(8), pre.midstate), hash);
});

test('sha256-js: compression matches node:crypto on one-block messages', () => {
  for (let len = 0; len <= 55; len++) {
    const msg = Buffer.from(Array.from({ length: len }, () => rnd() & 0xff));
    const block = Buffer.alloc(64);
    msg.copy(block);
    block[len] = 0x80;
    block.writeUInt32BE(len * 8, 60);
    const words16 = Array.from({ length: 16 }, (_, i) => block.readUInt32BE(i * 4));
    const out = sha256Compress(SHA256_IV, words16);
    const ref = createHash('sha256').update(msg).digest();
    assert.deepEqual(Array.from(out), Array.from({ length: 8 }, (_, i) => ref.readUInt32BE(i * 4)), `length ${len}`);
  }
});

test('sha256-js: sha256HashNonce matches node:crypto for 2, 3 and 4 passes', () => {
  for (const algo of ALGOS) {
    for (let k = 0; k < 300; k++) {
      const data = workData(randomWords());
      const nonce = rnd();
      assert.deepEqual(sha256HashNonce(data, nonce, PASSES[algo]), refHash(algo, data, nonce));
    }
  }
});

test('sha256-js: validHash is valid_hash (vs BigInt and the compiled C)', () => {
  const cmo = upstream.get('sha256d')!;
  for (let k = 0; k < 3000; k++) {
    const hash = Uint32Array.from({ length: 8 }, rnd);
    const target = Uint32Array.from({ length: 8 }, rnd);
    // Force ties from the top down to exercise every word.
    const ties = k % 9;
    for (let i = 7; i > 7 - ties; i--) target[i] = hash[i];
    const ours = validHash(hash, target);
    assert.equal(ours, leq(hash, target));
    if (k % 10 === 0) assert.equal(ours, cmo.validHash(hash, target));
  }
  const h = Uint32Array.from({ length: 8 }, rnd);
  assert.equal(validHash(h, h), true, 'equal hash is valid');
});

test('sha256-js: shareDiff = 2^96 / hash words 7..4', () => {
  assert.equal(shareDiff(new Uint32Array(8)), Infinity);
  assert.equal(shareDiff(Uint32Array.of(0, 0, 0, 0, 0, 0, 0, 1)), 1);
  assert.equal(shareDiff(Uint32Array.of(MAX, MAX, MAX, MAX, 0, 0, 0, 2)), 0.5, 'words 0..3 are ignored');
  for (let k = 0; k < 1000; k++) {
    const hash = Uint32Array.from({ length: 8 }, rnd);
    if (k % 2) hash[7] = 0;
    const h = hash[7] * 2 ** 96 + hash[6] * 2 ** 64 + hash[5] * 2 ** 32 + hash[4];
    const approx = 2 ** 96 / h;
    assert.ok(Math.abs(shareDiff(hash) - approx) <= approx * 1e-15, `${shareDiff(hash)} vs ${approx}`);
  }
});

test('sha256-js: algorithm names and scan job validation', () => {
  assert.deepEqual(ALGOS.map(sha256Passes), [2, 3, 4]);
  assert.throws(() => sha256Passes('sha256'), /not a sha256 family/);
  const data = workData(GENESIS_WORDS);
  const t = diff1Target();
  for (const [start, end] of [[5, 4], [-1, 3], [0, 2 ** 32 + 1], [0.5, 3], [0, NaN]]) {
    assert.throws(() => checkScanJob(job(data, t, start, end)), RangeError, `[${start}, ${end})`);
  }
  assert.throws(() => checkScanJob(job(data.subarray(0, 19), t, 0, 1)), RangeError);
  assert.throws(() => checkScanJob(job(data, t.subarray(0, 7), 0, 1)), RangeError);
  checkScanJob(job(data, t, 0, 2 ** 32));
});

// ---------------------------------------------------------------- backends

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  runtime: 'node',
  cores: 1,
  memoryBytes: null,
  wasm: { available: true, simd128: true, relaxedSimd: false },
  workers: true,
  webgpu: null,
  nodeCrypto: true,
  crossOriginIsolated: false,
  ...over,
});

test('registry: js and node-crypto factories', async () => {
  const js = getBackend('js');
  const nc = getBackend('node-crypto');
  assert.deepEqual([js.kind, js.priority, nc.kind, nc.priority], ['cpu', 50, 'cpu', 40]);
  const scrypt: AlgoSpec = { name: 'scrypt', id: 0, paramN: 0, paramR: 0, key: null };
  for (const algo of ALGOS) {
    assert.equal(js.unsupported(specs.get(algo)!, caps({ nodeCrypto: false })), null);
    assert.equal(nc.unsupported(specs.get(algo)!, caps()), null);
    assert.match(nc.unsupported(specs.get(algo)!, caps({ nodeCrypto: false }))!, /node:crypto/);
  }
  assert.match(js.unsupported(scrypt, caps())!, /sha256d/);
  assert.match(nc.unsupported(scrypt, caps())!, /sha256d/);
  await assert.rejects(js.create({ backend: 'js', algo: scrypt }), /does not implement scrypt/);
  await assert.rejects(nc.create({ backend: 'node-crypto', algo: scrypt }), /does not implement scrypt/);
  for (const name of BACKENDS) {
    const k = await kernel(name, 'sha256d');
    assert.equal(k.backend, name);
    assert.equal(k.granularity, 1);
    assert.ok(k.memoryBytes() >= 0);
  }
});

test('webgpu factory outside a browser: unsupported, and create() rejects', async () => {
  const gpu = getBackend('webgpu');
  assert.deepEqual([gpu.kind, gpu.priority], ['gpu', 5]);
  assert.match(gpu.unsupported(specs.get('sha256d')!, caps())!, /WebGPU/);
  assert.equal(
    gpu.unsupported(
      specs.get('sha256q')!,
      caps({ webgpu: { vendor: 'x', architecture: 'y', description: '', maxComputeWorkgroupSizeX: 256, maxComputeInvocationsPerWorkgroup: 256, maxStorageBufferBindingSize: 1 << 27 } }),
    ),
    null,
  );
  await assert.rejects(createWebGpuKernel({ backend: 'webgpu', algo: specs.get('sha256d')! }), /WebGPU is not available/);
});

for (const backend of BACKENDS) {
  test(`[${backend}] sha256d finds exactly the genesis nonce in a ±256 window`, async () => {
    const j = job(workData(GENESIS_WORDS), diff1Target(), GENESIS_NONCE - 256, GENESIS_NONCE + 256);
    const out = await scan(backend, 'sha256d', j);
    assert.equal(out.hashesDone, 512);
    assert.equal(out.solutions.length, 1);
    const [s] = out.solutions;
    assert.equal(s.data[19], GENESIS_NONCE);
    assert.equal(displayHash(s.hash), GENESIS_HASH);
    assertSolution('sha256d', j, s, GENESIS_NONCE);
    assertSameAsUpstream(out.solutions, upstreamScan('sha256d', j.data, j.target, j.start, j.end));
    assert.deepEqual(j.data, workData(GENESIS_WORDS), 'job data untouched');
  });

  test(`[${backend}] 2000 random headers x 8 nonces vs node:crypto and upstream`, async () => {
    for (const algo of ALGOS) {
      for (let k = 0; k < 2000; k++) {
        const data = workData(randomWords());
        const start = rnd() % (2 ** 32 - 64);
        // Every nonce is a solution with the maximum target.
        const j = job(data, MAX_TARGET, start, start + 8, k);
        const out = await scan(backend, algo, j);
        assert.equal(out.hashesDone, 8);
        assert.equal(out.solutions.length, 8);
        out.solutions.forEach((s, i) => assertSolution(algo, j, s, start + i));
        const up = upstreamScan(algo, data, MAX_TARGET, start, start + 8);
        assert.equal(up.length, 8, `${algo}: upstream covers the window`);
        assertSameAsUpstream(out.solutions, up);
      }
    }
  });

  test(`[${backend}] targets next to hashes: ties on words 7, 6 and 5`, async () => {
    for (const algo of ALGOS) {
      for (let k = 0; k < 40; k++) {
        const data = workData(randomWords());
        const n = 8 + (rnd() % (2 ** 32 - 64));
        const h = refHash(algo, data, n);
        const targets: number[][] = [Array.from(h), [h[0] - 1, ...h.slice(1)], [MAX, MAX, MAX, MAX, MAX, MAX, MAX, h[7] - 1]];
        targets.push([0, 0, 0, 0, 0, 0, 0, h[7] + 1], [MAX, MAX, MAX, MAX, MAX, MAX, h[6] - 1, h[7]]);
        targets.push([0, 0, 0, 0, 0, 0, h[6] + 1, h[7]], [MAX, MAX, MAX, MAX, MAX, h[5] - 1, h[6], h[7]]);
        targets.push([0, 0, 0, 0, 0, h[5] + 1, h[6], h[7]], [0, 0, 0, 0, 0, 0, h[6], h[7]]);
        const window = Array.from({ length: 8 }, (_, i) => n - 3 + i);
        const hashes = window.map((x) => refHash(algo, data, x));
        for (const tw of targets) {
          if (tw.some((w) => w < 0 || w > MAX)) continue;
          const target = Uint32Array.from(tw);
          const j = job(data, target, n - 3, n + 5, k);
          const out = await scan(backend, algo, j);
          const expected = window.filter((_, i) => leq(hashes[i], target));
          assert.deepEqual(out.solutions.map((s) => s.data[19]), expected, `${algo} target ${hex(target)}`);
          out.solutions.forEach((s) => assertSolution(algo, j, s, s.data[19]));
          assertSameAsUpstream(out.solutions, upstreamScan(algo, data, target, n - 3, n + 5));
        }
      }
    }
  });

  test(`[${backend}] nonce range ending at 2^32`, async () => {
    for (const algo of ALGOS) {
      const data = workData(randomWords());
      const j = job(data, MAX_TARGET, 2 ** 32 - 16, 2 ** 32);
      const out = await scan(backend, algo, j);
      assert.equal(out.hashesDone, 16);
      assert.deepEqual(out.solutions.map((s) => s.data[19]), Array.from({ length: 16 }, (_, i) => 2 ** 32 - 16 + i));
      out.solutions.forEach((s) => assertSolution(algo, j, s, s.data[19]));
      assert.equal(out.solutions[15].data[19], 0xffffffff);
      if (algo === 'sha256q') {
        assertSameAsUpstream(out.solutions, upstreamScan(algo, data, MAX_TARGET, 2 ** 32 - 16, 2 ** 32));
      } else {
        // max_nonce 2^32 wraps to 0 upstream, whose 4-way loop then stops at 0xfffffffc.
        const cmo = upstream.get(algo)!;
        cmo.setScanWork(data, MAX_TARGET);
        cmo.scan(2 ** 32 - 16, 2 ** 32);
        assertSameAsUpstream(out.solutions.slice(0, 12), cmo.solutions());
      }
    }
  });

  test(`[${backend}] more than 64 solutions: the first 64 in nonce order`, async () => {
    for (const algo of ALGOS) {
      const data = workData(randomWords());
      const j = job(data, MAX_TARGET, 1000, 1200);
      const out = await scan(backend, algo, j);
      assert.equal(out.hashesDone, 200);
      assert.equal(out.solutions.length, MAX_SOLUTIONS);
      assert.deepEqual(out.solutions.map((s) => s.data[19]), Array.from({ length: 64 }, (_, i) => 1000 + i));
      out.solutions.forEach((s) => assertSolution(algo, j, s, s.data[19]));
    }
  });

  test(`[${backend}] hashesDone, empty and odd ranges, bad input`, async () => {
    const k = await kernel(backend, 'sha256t');
    const data = workData(randomWords());
    const copy = data.slice();
    for (const [start, end] of [[7, 7], [7, 8], [7, 20], [2 ** 31 - 3, 2 ** 31 + 2]]) {
      const out = await k.scan(job(data, MAX_TARGET, start, end));
      assert.equal(out.hashesDone, end - start);
      assert.deepEqual(out.solutions.map((s) => s.data[19]), Array.from({ length: end - start }, (_, i) => start + i));
    }
    assert.deepEqual(data, copy, 'job data untouched');
    assert.throws(() => k.scan(job(data, MAX_TARGET, 10, 9)), RangeError);
    k.dispose();
    kernels.delete(`${backend} sha256t`);
  });

  test(`[${backend}] single-thread hash rate (informational)`, async (t) => {
    const counts = backend === 'js' ? [3_000_000, 2_000_000, 1_500_000] : [400_000, 300_000, 250_000];
    for (const [i, algo] of ALGOS.entries()) {
      const k = await kernel(backend, algo);
      const data = workData(randomWords());
      const zero = new Uint32Array(8);
      k.scan(job(data, zero, 0, counts[i] / 10)); // warm up (JIT tiers)
      const t0 = performance.now();
      const out = await k.scan(job(data, zero, 0, counts[i]));
      const hps = out.hashesDone / ((performance.now() - t0) / 1e3);
      t.diagnostic(`${backend} ${algo}: ${(hps / 1e6).toFixed(3)} MH/s`);
    }
  });
}

test('upstream 4-way sha256q (sse41, sse42) hashes header words 8..10 in place of 16..18', async (t) => {
  // Known upstream bug (cpuminer-opt 26.1, simd-utils/intrlv.h): the 128-bit
  // v128_bswap32_intrlv80_4x32 fills words 16..19 from s2 (words 8..11)
  // instead of s4. The kernels here hash the real header, like upstream's
  // scalar sha256q.c and its 8/16-way code. Passes once the bug is fixed too.
  for (const v of builtVariants().filter((x) => x !== 'avx2')) {
    const cmo = await scanInstance(v, 'sha256q');
    let buggy = 0;
    let correct = 0;
    for (let k = 0; k < 60; k++) {
      const data = workData(randomWords());
      const start = rnd() % (2 ** 32 - 64);
      cmo.setScanWork(data, Q4_TARGET); // it scans nothing for target[7] > 0x10000000
      cmo.scan(start, start + 36);
      for (const s of cmo.solutions()) {
        const n = s.data[19];
        assert.ok(n >= start && n < start + 32);
        if (refHash('sha256q', data, n).every((w, i) => w === s.hash[i])) {
          correct++;
          continue;
        }
        const corrupted = data.slice();
        corrupted.set(data.subarray(8, 11), 16);
        assert.deepEqual(s.hash, refHash('sha256q', corrupted, n), `${v}: neither the real nor the known-bug hash`);
        buggy++;
      }
    }
    assert.ok(buggy + correct > 20);
    t.diagnostic(`wasm-${v} sha256q: ${buggy} solutions hash the corrupted header, ${correct} the real one`);
  }
});

test('upstream single-thread hash rate, for comparison (informational)', async (t) => {
  for (const v of ['sse41', 'avx2'] as const) {
    for (const algo of ALGOS) {
      const cmo = await scanInstance(v, algo);
      // Hard but non-zero target: the 4-way sha256q needs target[7] in 1..0x10000000 to scan.
      cmo.setScanWork(workData(randomWords()), Uint32Array.of(0, 0, 0, 0, 0, 0, 0, 1));
      cmo.scan(0, 200_000);
      const n = 2_000_000;
      const t0 = performance.now();
      const done = cmo.scan(1000, 1000 + n);
      t.diagnostic(`wasm-${v} (upstream) ${algo}: ${(done / ((performance.now() - t0) / 1e3) / 1e6).toFixed(3)} MH/s`);
    }
  }
});
