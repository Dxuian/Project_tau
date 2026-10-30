// The hand-tuned wasm_simd128 sha256 kernel (native/kernels/sha256_fast.c)
// against node:crypto and against upstream cpuminer-opt's own scanhash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Cmo } from '../src/wasm/api.ts';
import {
  diff1Target,
  displayHash,
  GENESIS_HASH,
  GENESIS_NONCE,
  GENESIS_WORDS,
  headerBytes,
  loadModule,
  scanInstance,
  workData,
} from './helpers.ts';

const KIND: Record<string, number> = { sha256d: 2, sha256t: 3, sha256q: 4 };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest();
const reference = (algo: string, header: Uint8Array) => {
  let h = sha(header);
  for (let i = 1; i < KIND[algo]; i++) h = sha(h);
  return h;
};

function fastScan(cmo: Cmo, algo: string, lanes: number, data: Uint32Array, target: Uint32Array, start: number, end: number) {
  cmo.setScanWork(data, target);
  const done = cmo.call('cmo_sha256_fast_scan', KIND[algo], lanes, start >>> 0, end);
  return { done, sols: cmo.solutions() };
}

function hex(h: Uint32Array): string {
  return Buffer.from(new Uint8Array(h.buffer, h.byteOffset, 32)).toString('hex');
}

const MAX = new Uint32Array(8).fill(0xffffffff);

for (const lanes of [4, 8]) {
  test(`[x${lanes}] genesis: finds exactly the nonce, word-7 tie with nbits target`, async () => {
    const cmo = await scanInstance('sse41', 'sha256d');
    const { done, sols } = fastScan(cmo, 'sha256d', lanes, workData(GENESIS_WORDS), diff1Target(), GENESIS_NONCE - 257, GENESIS_NONCE + 259);
    assert.equal(done, 516);
    assert.equal(sols.length, 1);
    assert.equal(sols[0].data[19], GENESIS_NONCE);
    assert.equal(displayHash(sols[0].hash), GENESIS_HASH);
  });

  for (const algo of ['sha256d', 'sha256t', 'sha256q']) {
    test(`[x${lanes}] ${algo}: every hash equals node:crypto (300 random headers, max target)`, async () => {
      const cmo = await scanInstance('sse41', algo);
      for (let t = 0; t < 300; t++) {
        const header = randomBytes(80);
        const words = new Uint32Array(20);
        for (let i = 0; i < 20; i++) words[i] = header.readUInt32BE(i * 4);
        const start = header.readUInt32BE(76) & 0x7fffffff;
        const count = 1 + (t % 21); // includes the scalar tail path
        const { done, sols } = fastScan(cmo, algo, lanes, workData(words), MAX, start, start + count);
        assert.equal(done, count);
        assert.equal(sols.length, count);
        for (const s of sols) {
          const n = s.data[19];
          header.writeUInt32BE(n, 76);
          assert.equal(hex(s.hash), reference(algo, header).toString('hex'), `${algo} nonce ${n}`);
        }
      }
    });

    test(`[x${lanes}] ${algo}: same solutions as upstream cpuminer-opt for near-hash targets`, async () => {
      const fast = await scanInstance('sse41', algo);
      const upstream = await scanInstance('sse41', algo);
      for (let t = 0; t < 40; t++) {
        const words = new Uint32Array(20);
        const rnd = randomBytes(80);
        for (let i = 0; i < 20; i++) words[i] = rnd.readUInt32BE(i * 4);
        const data = workData(words);
        // Word 7 of the target equal to (or below) one hash's word 7 exercises
        // the early-exit tie paths; word 6 equal to its word 6 the next level.
        // Upstream's 4-way loops hash nothing unless target[7] <= 0x10000000,
        // so the probe is a hash whose word 7 is below that.
        const low = new Uint32Array(8).fill(0xffffffff);
        low[7] = 0x0fffffff;
        const probe = fastScan(fast, algo, lanes, data, low, 1000, 3000).sols[0].hash;
        const target = new Uint32Array(8).fill(0xffffffff);
        target[7] = Math.min(probe[7], 0x00ffffff) >>> (t % 3);
        if (t % 4 === 1) {
          target[7] = probe[7];
          target[6] = probe[6];
        }
        const mine = fastScan(fast, algo, lanes, data, target, 0, 4096).sols;
        upstream.setScanWork(data, target);
        upstream.scan(0, 4096);
        // Upstream's 4/8-way loops stop up to one vector short of max_nonce; compare below that.
        const theirs = upstream.solutions().filter((s) => s.data[19] < 4096 - 16);
        const mineCut = mine.filter((s) => s.data[19] < 4096 - 16);
        assert.deepEqual(mineCut.map((s) => s.data[19]), theirs.map((s) => s.data[19]), `trial ${t}`);
        for (let i = 0; i < theirs.length; i++) assert.equal(hex(mineCut[i].hash), hex(theirs[i].hash));
      }
    });
  }

  test(`[x${lanes}] nonce range ending at 2^32 and lane mapping`, async () => {
    const cmo = await scanInstance('sse41', 'sha256d');
    const words = Array.from(GENESIS_WORDS);
    const { done, sols } = fastScan(cmo, 'sha256d', lanes, workData(words), MAX, 0xffffffff - 20, 0x100000000);
    assert.equal(done, 21);
    assert.deepEqual(sols.map((s) => s.data[19]), Array.from({ length: 21 }, (_, i) => 0xffffffff - 20 + i));
    // Lane k must hold nonce start + k: start so that the genesis nonce lands in each lane.
    for (let k = 0; k < lanes; k++) {
      const r = fastScan(cmo, 'sha256d', lanes, workData(words), diff1Target(), GENESIS_NONCE - k, GENESIS_NONCE - k + lanes);
      assert.equal(r.sols.length, 1, `lane ${k}`);
      assert.equal(r.sols[0].data[19], GENESIS_NONCE);
    }
  });
}

test('throughput (informational)', async () => {
  const header = headerBytes(GENESIS_WORDS);
  assert.equal(header.length, 80);
  const cmo = await Cmo.create(loadModule('sse41'));
  assert.equal(cmo.init(cmo.resolve('sha256d')!.id, { threadInit: true }), 0);
  const data = workData(GENESIS_WORDS);
  const zero = new Uint32Array(8);
  const rate = (fn: () => number) => {
    fn();
    const t = performance.now();
    const n = fn();
    return n / (performance.now() - t) / 1000;
  };
  cmo.setScanWork(data, zero);
  const up = rate(() => cmo.scan(0, 1 << 21));
  const x4 = rate(() => fastScan(cmo, 'sha256d', 4, data, zero, 0, 1 << 21).done);
  const x8 = rate(() => fastScan(cmo, 'sha256d', 8, data, zero, 0, 1 << 21).done);
  console.log(`sha256d single thread: upstream sse41 ${up.toFixed(2)} MH/s, x4 ${x4.toFixed(2)} MH/s, x8 ${x8.toFixed(2)} MH/s`);
});
