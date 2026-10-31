// Known-answer tests for sha256d through the compiled cpuminer-opt code, in
// every built WASM variant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  builtVariants,
  diff1Target,
  displayHash,
  GENESIS_HASH,
  GENESIS_NONCE,
  GENESIS_WORDS,
  headerBytes,
  scanInstance,
  sha256d,
  workData,
} from './helpers.ts';

test('genesis vector matches node:crypto', () => {
  const display = Buffer.from(sha256d(headerBytes(GENESIS_WORDS))).reverse().toString('hex');
  assert.equal(display, GENESIS_HASH);
});

for (const v of builtVariants()) {
  test(`[${v}] sha256d finds the genesis nonce`, async () => {
    const cmo = await scanInstance(v, 'sha256d');
    cmo.setScanWork(workData(GENESIS_WORDS), diff1Target());
    const done = cmo.scan(GENESIS_NONCE - 256, GENESIS_NONCE + 256);
    assert.ok(done >= 500, `hashes done ${done}`);
    const sols = cmo.solutions();
    assert.equal(sols.length, 1, 'exactly one solution in the window');
    assert.equal(sols[0].data[19], GENESIS_NONCE);
    assert.equal(displayHash(sols[0].hash), GENESIS_HASH);
  });
}
