// End to end: a real Miner (autotune -> worker pool -> stratum client) against
// the local mock pool, with Bitcoin block 1 as the job. The miner must submit
// block 1's nonce, formatted exactly like cpuminer-opt, and count the share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMiner } from '../src/index.ts';
import { MockPool } from './mock-pool.ts';
import { BLOCK1 } from './helpers.ts';
import type { BackendName } from '../src/types.ts';

async function mineBlock1(backend: BackendName) {
  const pool = await MockPool.start({ extranonce1: BLOCK1.xnonce1, extranonce2Size: 4 });
  const miner = await createMiner({
    algo: 'sha256d',
    url: pool.url,
    user: 'bc1qtestaddress',
    pass: 'x',
    backend,
    threads: 2,
    gpu: false,
    warmupMs: 20,
    measureMs: 50,
    // Every worker scans a window around block 1's nonce.
    nonceRange: { start: BLOCK1.nonceWord - 5000, end: BLOCK1.nonceWord + 5000 },
  });
  const shares: unknown[] = [];
  miner.on('share', (s) => shares.push(s));
  const errors: Error[] = [];
  miner.on('error', (e) => errors.push(e));
  try {
    await miner.start();
    await pool.waitForMethod('mining.authorize');
    pool.setDifficulty(1);
    pool.notify(BLOCK1.notify('b1'));
    const submit = await pool.waitForMethod('mining.submit');
    // Wait for the verdict to come back to the miner.
    for (let i = 0; i < 100 && !shares.length; i++) await new Promise((r) => setTimeout(r, 20));
    return { submit, shares, errors, stats: miner.stats(), submits: pool.messages('mining.submit') };
  } finally {
    await miner.stop();
    await pool.close();
  }
}

for (const backend of ['wasm-sse41', 'wasm-sha256-x8'] as BackendName[]) {
  test(`miner (${backend}) mines block 1 through the mock pool`, async () => {
    const r = await mineBlock1(backend);
    assert.deepEqual(r.errors.map((e) => e.message), []);
    // Two workers get extranonce2 00000000 and 01000000; only the first
    // reproduces block 1's coinbase, so exactly one share exists in the window.
    assert.equal(r.submits.length, 1);
    assert.equal(r.submit.method, 'mining.submit');
    assert.deepEqual(r.submit.params, ['bc1qtestaddress', 'b1', '00000000', '4966bc61', '9962e301']);
    assert.equal(typeof r.submit.id, 'number', 'the client assigns its own per-share id');
    assert.equal(r.shares.length, 1);
    assert.equal((r.shares[0] as { accepted: boolean }).accepted, true);
    assert.equal(r.stats.accepted, 1);
    assert.equal(r.stats.backend, backend);
    assert.equal(r.stats.jobId, 'b1');
  });
}

test('miner switches to a new job and drops invalid ones', async () => {
  const pool = await MockPool.start({ extranonce1: BLOCK1.xnonce1, extranonce2Size: 4 });
  const miner = await createMiner({
    algo: 'sha256d', url: pool.url, user: 'u', backend: 'wasm-sse41', threads: 1, gpu: false,
    warmupMs: 20, measureMs: 50, nonceRange: { start: 0, end: 1 << 20 },
  });
  const jobs: string[] = [];
  const errors: string[] = [];
  miner.on('job', (j) => jobs.push(j.jobId));
  miner.on('error', (e) => errors.push(e.message));
  try {
    await miner.start();
    await pool.waitForMethod('mining.authorize');
    pool.notify(BLOCK1.notify('j1'));
    pool.notify(['bad', 'zz']);
    pool.notify(BLOCK1.notify('j2', false));
    for (let i = 0; i < 100 && jobs.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(jobs, ['j1', 'j2']);
    assert.ok(errors.some((m) => m.includes('invalid job')), 'invalid notify reported');
    assert.equal(miner.stats().jobId, 'j2');
    assert.equal(miner.stats().state, 'running');
  } finally {
    await miner.stop();
    await pool.close();
  }
});

test('nothing runs before start()', async () => {
  const pool = await MockPool.start();
  try {
    const miner = await createMiner({ algo: 'sha256d', url: pool.url, user: 'u' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(pool.received.length, 0, 'no connection before start()');
    assert.equal(miner.stats().state, 'idle');
  } finally {
    await pool.close();
  }
});
