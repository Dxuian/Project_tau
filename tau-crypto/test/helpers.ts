// Shared test fixtures: Bitcoin known-answer data and module loading.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Cmo } from '../src/wasm/api.ts';

export const ROOT = new URL('..', import.meta.url).pathname;
export const VARIANTS = ['sse41', 'sse42', 'avx2'] as const;
export type VariantName = (typeof VARIANTS)[number];

export function wasmPath(v: string): string {
  return `${ROOT}native/out/cmo-${v}.wasm`;
}

export function builtVariants(): VariantName[] {
  return VARIANTS.filter((v) => existsSync(wasmPath(v)));
}

const modules = new Map<string, WebAssembly.Module>();
export function loadModule(v: string): WebAssembly.Module {
  let m = modules.get(v);
  if (!m) {
    m = new WebAssembly.Module(readFileSync(wasmPath(v)));
    modules.set(v, m);
  }
  return m;
}

export async function scanInstance(v: string, algo: string, threadInit = true): Promise<Cmo> {
  const cmo = await Cmo.create(loadModule(v));
  const r = cmo.resolve(algo);
  if (!r) throw new Error(`unknown algo ${algo}`);
  const rc = cmo.init(r.id, { paramN: r.paramN, threadInit });
  if (rc !== 0) throw new Error(`init ${algo} failed: ${rc} ${cmo.drainLog().join(' | ')}`);
  return cmo;
}

export const sha256 = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();
export const sha256d = (b: Uint8Array): Buffer => sha256(sha256(b));

/** Bitcoin genesis block header as cpuminer data words (BE32 of header bytes). */
export const GENESIS_WORDS = (
  '01000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000 ' +
  '3ba3edfd 7a7b12b2 7ac72c3e 67768f61 7fc81bc3 888a5132 3a9fb8aa 4b1e5e4a 29ab5f49 ' +
  'ffff001d 1dac2b7c'
)
  .split(' ')
  .map((h) => parseInt(h, 16) >>> 0);
export const GENESIS_NONCE = 0x1dac2b7c;
export const GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

// Bitcoin block 1 as a stratum job. Its coinbase's all-zero prevout supplies
// the extranonce1/extranonce2 bytes (4 zero bytes each, as the first work uses).
export const BLOCK1 = {
  coinbase:
    '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff' +
    '0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390' +
    '813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000',
  merkleRoot: '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098',
  hash: '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048',
  nonce: 2573394689, // 0x9962e301
  /** data[19] (BE32 of the header's nonce bytes) for that nonce. */
  nonceWord: 0x01e36299,
  xnonce1: '00000000',
  /** prevhash as stratum sends it: internal byte order, each 4-byte group reversed. */
  prevhash: '0a8ce26f72b3f1b646a2a6c14ff763ae65831e939c085ae10019d66800000000',
  notify(jobId = 'b1', clean = true): unknown[] {
    const cb = BLOCK1.coinbase;
    return [jobId, BLOCK1.prevhash, cb.slice(0, 26), cb.slice(26 + 16), [], '00000001', '1d00ffff', '4966bc61', clean];
  },
};

/** Header bytes for cpuminer data words. */
export function headerBytes(words: ArrayLike<number>, count = 20): Buffer {
  const b = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) b.writeUInt32BE(words[i] >>> 0, i * 4);
  return b;
}

/** cpuminer work data: 20 header words + SHA-256 padding words. */
export function workData(words: ArrayLike<number>): Uint32Array {
  const d = new Uint32Array(48);
  d.set(Array.from(words).slice(0, 20));
  d[20] = 0x80000000;
  d[31] = 0x280;
  return d;
}

/** Target for nbits 0x1d00ffff (difficulty 1) as eight LE words. */
export function diff1Target(): Uint32Array {
  const t = new Uint32Array(8);
  t[6] = 0xffff0000;
  return t;
}

/** Display hash (big-endian hex) of a cpuminer hash (8 LE words). */
export function displayHash(hash: Uint32Array): string {
  return Buffer.from(new Uint8Array(hash.buffer, hash.byteOffset, 32)).reverse().toString('hex');
}
