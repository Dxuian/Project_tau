// Pure-JS SHA-256 building blocks for the sha256d/sha256t/sha256q kernels:
// a plain compression function, the per-work precompute that every fast
// scanner uses (midstate, block-1 rounds 0-3, nonce-independent message
// schedule terms), full per-nonce hashing for verifying candidates, and the
// hash/target helpers matching cpuminer-opt (valid_hash, hash_to_diff).
//
// Word conventions follow cpuminer-opt: work data words are big-endian u32s of
// the header bytes (data[0..19] are already SHA-256 message words, the nonce is
// data[19]); hashes and targets are 8 little-endian words of the digest bytes,
// word 7 most significant.
import type { FoundSolution, ScanJob } from '../types.ts';

export const SHA256_IV: Uint32Array = Uint32Array.of(
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
);

export const SHA256_K: Uint32Array = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);

/** Most solutions one scan call returns (as upstream's CMO_MAX_SOLUTIONS). */
export const MAX_SOLUTIONS = 64;

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
const bsig0 = (x: number): number => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
const bsig1 = (x: number): number => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
const ssig0 = (x: number): number => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
const ssig1 = (x: number): number => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);

export function bswap32(x: number): number {
  return ((x << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0;
}

const W = new Int32Array(64);

/**
 * One SHA-256 compression: out = state + rounds(state, block). Reads 16
 * words of `block` (big-endian message words); `out` may alias either input.
 */
export function sha256Compress(
  state: ArrayLike<number>,
  block: ArrayLike<number>,
  out: Uint32Array = new Uint32Array(8),
): Uint32Array {
  for (let i = 0; i < 16; i++) W[i] = block[i];
  for (let i = 16; i < 64; i++) W[i] = (ssig1(W[i - 2]) + W[i - 7] + ssig0(W[i - 15]) + W[i - 16]) | 0;
  let a = state[0] | 0, b = state[1] | 0, c = state[2] | 0, d = state[3] | 0;
  let e = state[4] | 0, f = state[5] | 0, g = state[6] | 0, h = state[7] | 0;
  for (let i = 0; i < 64; i++) {
    const t1 = (h + bsig1(e) + (g ^ (e & (f ^ g))) + SHA256_K[i] + W[i]) | 0;
    const t2 = (bsig0(a) + ((a & b) | (c & (a | b)))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  out[0] = state[0] + a;
  out[1] = state[1] + b;
  out[2] = state[2] + c;
  out[3] = state[3] + d;
  out[4] = state[4] + e;
  out[5] = state[5] + f;
  out[6] = state[6] + g;
  out[7] = state[7] + h;
  return out;
}

/** compress(IV, header words 0..15): the state after the first 64 header bytes. */
export function sha256Midstate(data: ArrayLike<number>, out?: Uint32Array): Uint32Array {
  return sha256Compress(SHA256_IV, data, out);
}

/** Nonce-independent values of one work, as in sha256_4x32_prehash_3rounds. */
export interface Sha256Prehash {
  /** State after header words 0..15. */
  midstate: Uint32Array;
  /**
   * Block-1 working variables a..h at the start of round 4, without the nonce:
   * a scanner adds the nonce (W3) to a and e to complete round 3.
   */
  state4: Uint32Array;
  /**
   * Message schedule terms X0..X6: W16 = X0, W17 = X1, W18 = X2 + s0(nonce),
   * W19 = X3 + nonce, and the parts X4 / X5 / X6 of W30 / W31 / W32.
   */
  x: Uint32Array;
}

/** Block-1 message words that don't depend on the nonce. */
const BLOCK1_W4 = 0x80000000;
const BLOCK1_W15 = 640; // 80 bytes, in bits

export function sha256Prehash(data: ArrayLike<number>): Sha256Prehash {
  const midstate = sha256Midstate(data);
  const w0 = data[16] | 0, w1 = data[17] | 0, w2 = data[18] | 0;
  let a = midstate[0] | 0, b = midstate[1] | 0, c = midstate[2] | 0, d = midstate[3] | 0;
  let e = midstate[4] | 0, f = midstate[5] | 0, g = midstate[6] | 0, h = midstate[7] | 0;
  const w = [w0, w1, w2];
  for (let i = 0; i < 3; i++) {
    const t1 = (h + bsig1(e) + (g ^ (e & (f ^ g))) + SHA256_K[i] + w[i]) | 0;
    const t2 = (bsig0(a) + ((a & b) | (c & (a | b)))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  // Round 3 without W3: the scanner adds the nonce to both new words.
  const t1 = (h + bsig1(e) + (g ^ (e & (f ^ g))) + SHA256_K[3]) | 0;
  const t2 = (bsig0(a) + ((a & b) | (c & (a | b)))) | 0;
  const state4 = Uint32Array.of(t1 + t2, a, b, c, d + t1, e, f, g);
  const x0 = (ssig0(w1) + w0) | 0;
  const x1 = (ssig1(BLOCK1_W15) + ssig0(w2) + w1) | 0;
  const x = Uint32Array.of(
    x0,
    x1,
    ssig1(x0) + w2,
    ssig1(x1) + ssig0(BLOCK1_W4),
    ssig0(BLOCK1_W15),
    ssig0(x0) + BLOCK1_W15,
    ssig0(x1) + x0,
  );
  return { midstate, state4, x };
}

/** SHA-256 passes over the header: sha256d 2, sha256t 3, sha256q 4. */
export function sha256Passes(algo: string): 2 | 3 | 4 {
  switch (algo) {
    case 'sha256d':
      return 2;
    case 'sha256t':
      return 3;
    case 'sha256q':
      return 4;
    default:
      throw new Error(`not a sha256 family algorithm: ${algo}`);
  }
}

const block = new Uint32Array(16);

/**
 * Final hash of `passes` nested SHA-256s over the 80-byte header of `data`
 * with nonce `nonce`, as 8 little-endian words (cpuminer's hash format).
 * Pass the work's midstate to skip hashing the first 64 bytes again.
 */
export function sha256HashNonce(
  data: ArrayLike<number>,
  nonce: number,
  passes: number,
  out: Uint32Array = new Uint32Array(8),
  midstate?: ArrayLike<number>,
): Uint32Array {
  if (midstate) out.set(midstate);
  else sha256Midstate(data, out);
  block.fill(0);
  block[0] = data[16];
  block[1] = data[17];
  block[2] = data[18];
  block[3] = nonce;
  block[4] = BLOCK1_W4;
  block[15] = BLOCK1_W15;
  sha256Compress(out, block, out);
  for (let i = 1; i < passes; i++) {
    // Next pass hashes the 32-byte digest: one padded block.
    block.set(out);
    block[8] = 0x80000000;
    block.fill(0, 9, 15);
    block[15] = 256;
    sha256Compress(SHA256_IV, block, out);
  }
  for (let i = 0; i < 8; i++) out[i] = bswap32(out[i]);
  return out;
}

/** cpuminer-opt valid_hash: hash <= target as 256-bit little-endian integers. */
export function validHash(hash: ArrayLike<number>, target: ArrayLike<number>): boolean {
  for (let i = 7; i >= 0; i--) {
    const h = hash[i] >>> 0, t = target[i] >>> 0;
    if (h !== t) return h < t;
  }
  return true;
}

const TWO_224 = 1n << 224n;

/**
 * cpuminer-opt hash_to_diff: 2^96 / H with H the upper 128 bits of the hash
 * (words 7..4). Computed exactly and rounded once, which is what upstream's
 * 128-bit long double arithmetic gives.
 */
export function shareDiff(hash: ArrayLike<number>): number {
  const h =
    (BigInt(hash[7] >>> 0) << 96n) |
    (BigInt(hash[6] >>> 0) << 64n) |
    (BigInt(hash[5] >>> 0) << 32n) |
    BigInt(hash[4] >>> 0);
  if (h === 0n) return Infinity;
  // 2^224 / H has at least 96 bits; a sticky low bit keeps the rounding exact.
  let q = TWO_224 / h;
  if (q * h !== TWO_224) q |= 1n;
  return Number(q) * 2 ** -128;
}

/** Display form of a hash (block explorer order: digest bytes reversed). */
export function hashHex(hash: ArrayLike<number>): string {
  let s = '';
  for (let i = 7; i >= 0; i--) s += (hash[i] >>> 0).toString(16).padStart(8, '0');
  return s;
}

/** Validates a scan job; throws a RangeError for unusable input. */
export function checkScanJob(job: ScanJob): void {
  const { start, end } = job;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > 2 ** 32) {
    throw new RangeError(`invalid nonce range [${start}, ${end})`);
  }
  if (!job.data || job.data.length < 20) throw new RangeError('work data needs at least 20 words');
  if (!job.target || job.target.length < 8) throw new RangeError('target needs 8 words');
}

/** A solution record for nonce `nonce` of `job` with its (already valid) hash. */
export function makeSolution(job: ScanJob, nonce: number, hash: Uint32Array): FoundSolution {
  const data = job.data.slice();
  data[19] = nonce;
  return { seq: job.seq, data, hash: hash.slice(), shareDiff: shareDiff(hash) };
}
