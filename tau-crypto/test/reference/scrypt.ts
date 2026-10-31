// Independent scrypt (RFC 7914, p = 1) for anchoring scrypt golden vectors.
// OpenSSL (node:crypto) refuses N >= 2^(16 r), which rules out scryptn2
// (N = 2^20, r = 1), so this plain implementation is used instead.
import { pbkdf2Sync } from 'node:crypto';

function salsa208(b: Uint32Array): void {
  const x = b.slice();
  const R = (a: number, n: number) => (a << n) | (a >>> (32 - n));
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R(x[0] + x[12], 7);  x[8] ^= R(x[4] + x[0], 9);
    x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7);   x[13] ^= R(x[9] + x[5], 9);
    x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9);
    x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9);
    x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7);   x[2] ^= R(x[1] + x[0], 9);
    x[3] ^= R(x[2] + x[1], 13);  x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7);   x[7] ^= R(x[6] + x[5], 9);
    x[4] ^= R(x[7] + x[6], 13);  x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9);
    x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9);
    x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  for (let i = 0; i < 16; i++) b[i] = (b[i] + x[i]) | 0;
}

// BlockMix for r = 1 on 32 words, in place.
function blockMix(x: Uint32Array, t: Uint32Array): void {
  t.set(x.subarray(16, 32));
  for (let i = 0; i < 16; i++) t[i] ^= x[i];
  salsa208(t);
  const y0 = t.slice();
  for (let i = 0; i < 16; i++) t[i] ^= x[16 + i];
  salsa208(t);
  x.set(y0, 0);
  x.set(t, 16);
}

export function scrypt(password: Uint8Array, salt: Uint8Array, N: number, dkLen = 32): Buffer {
  const b = pbkdf2Sync(password, salt, 1, 128, 'sha256');
  const x = new Uint32Array(32);
  for (let i = 0; i < 32; i++) x[i] = b.readUInt32LE(i * 4);
  const v = new Uint32Array(32 * N);
  const t = new Uint32Array(16);
  for (let i = 0; i < N; i++) {
    v.set(x, i * 32);
    blockMix(x, t);
  }
  for (let i = 0; i < N; i++) {
    const j = (x[16] >>> 0) % N;
    for (let k = 0; k < 32; k++) x[k] ^= v[j * 32 + k];
    blockMix(x, t);
  }
  const out = Buffer.alloc(128);
  for (let i = 0; i < 32; i++) out.writeUInt32LE(x[i] >>> 0, i * 4);
  return pbkdf2Sync(password, out, 1, dkLen, 'sha256');
}
