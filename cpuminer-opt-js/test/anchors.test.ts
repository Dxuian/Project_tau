// Independent anchors. The golden tests compare the WASM builds with the same
// C code built natively, so a bug present in upstream (and therefore in both)
// can't show up there. Here every solution of every variant is re-hashed with
// an implementation that shares no code with cpuminer-opt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { builtVariants, scanInstance, workData } from './helpers.ts';
import { scrypt } from './reference/scrypt.ts';

const sha = (alg: string) => (b: Uint8Array) => createHash(alg).update(b).digest();
const repeat = (f: (b: Uint8Array) => Buffer, n: number) => (b: Uint8Array) => {
  let h = f(b);
  for (let i = 1; i < n; i++) h = f(h);
  return h;
};

const ANCHORS: { algo: string; ref: (header: Buffer) => Buffer; nonces: number; headers: number }[] = [
  { algo: 'sha256d', ref: repeat(sha('sha256'), 2), nonces: 512, headers: 4 },
  { algo: 'sha256t', ref: repeat(sha('sha256'), 3), nonces: 512, headers: 4 },
  { algo: 'sha256q', ref: repeat(sha('sha256'), 4), nonces: 512, headers: 4 },
  { algo: 'blake2s', ref: sha('blake2s256'), nonces: 512, headers: 4 },
  { algo: 'sha512256d', ref: repeat(sha('sha512-256'), 2), nonces: 512, headers: 4 },
  { algo: 'scrypt', ref: (h) => scryptSync(h, h, 32, { N: 1024, r: 1, p: 1 }), nonces: 256, headers: 2 },
  { algo: 'scrypt:1048576', ref: (h) => scrypt(h, h, 1 << 20), nonces: 32, headers: 1 },
];

for (const v of builtVariants()) {
  for (const a of ANCHORS) {
    test(`[${v}] ${a.algo} solutions match an independent implementation`, async () => {
      const cmo = await scanInstance(v, a.algo);
      // Older scan loops skip hashing unless target[7] <= 0x10000000.
      const target = new Uint32Array(8).fill(0xffffffff);
      target[7] = 0x0fffffff;
      let checked = 0;
      for (let t = 0; t < a.headers; t++) {
        const rnd = randomBytes(80);
        const words = new Uint32Array(20);
        for (let i = 0; i < 20; i++) words[i] = rnd.readUInt32BE(i * 4);
        cmo.setScanWork(workData(words), target);
        cmo.scan(0, a.nonces);
        for (const s of cmo.solutions()) {
          assert.equal(s.legacy, false);
          // data[] holds the header words that were hashed, nonce included.
          const header = Buffer.alloc(80);
          for (let i = 0; i < 20; i++) header.writeUInt32BE(s.data[i], i * 4);
          const got = Buffer.from(new Uint8Array(s.hash.buffer, s.hash.byteOffset, 32)).toString('hex');
          assert.equal(got, a.ref(header).toString('hex'), `${a.algo} nonce word ${s.data[19].toString(16)}`);
          checked++;
        }
      }
      assert.ok(checked > 0, 'some solutions were checked');
    });
  }
}
