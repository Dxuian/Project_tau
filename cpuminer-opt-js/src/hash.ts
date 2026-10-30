// hash(): one cpuminer-opt hash of an 80-byte (or longer) block header.
import { resolveAlgo, type AlgoParams } from './algos.ts';
import { compileVariant } from './wasm/variants.ts';
import { Cmo } from './wasm/api.ts';

const instances = new Map<string, Promise<Cmo>>();

async function instanceFor(algo: string, params: AlgoParams): Promise<Cmo> {
  const spec = resolveAlgo(algo, params);
  if (spec.name === 'verthash') throw new Error('hash(): verthash needs its dataset; use a miner or benchmark instead');
  const key = JSON.stringify(spec);
  let p = instances.get(key);
  if (!p) {
    p = (async () => {
      const cmo = await Cmo.create(await compileVariant('sse41'));
      const rc = cmo.init(spec.id, { paramN: spec.paramN, paramR: spec.paramR, key: spec.key, threadInit: true });
      if (rc !== 0) throw new Error(`cpuminer-opt failed to initialise ${spec.name} (${rc})`);
      return cmo;
    })();
    p.catch(() => instances.delete(key));
    instances.set(key, p);
  }
  return p;
}

/**
 * Hashes a block header with cpuminer-opt's implementation of `algo` and
 * returns the 32-byte digest in cpuminer's byte order (reverse it for the
 * block-explorer display form). The nonce is header bytes 76..79.
 */
export async function hash(algo: string, header: Uint8Array, params: AlgoParams = {}): Promise<Uint8Array> {
  if (header.length < 80) throw new RangeError('header must be at least 80 bytes');
  const cmo = await instanceFor(algo, params);
  const data = new Uint32Array(48);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  for (let i = 0; i < Math.min(48, header.length >> 2); i++) data[i] = view.getUint32(i * 4, false);
  if (header.length === 80) {
    data[20] = 0x80000000;
    data[31] = 0x280;
  }
  const nonce = data[19];
  const direct = cmo.directHash(data, nonce);
  if (direct) return new Uint8Array(direct.buffer.slice(0));
  // With the maximum target a scanhash reports every nonce it hashes.
  cmo.setScanWork(data, new Uint32Array(8).fill(0xffffffff));
  cmo.scan(nonce, Math.min(nonce + 16, 0xffffffff));
  const ni = cmo.gateInfo().nonceIndex;
  const s = cmo.solutions().find((x) => x.data[ni] === nonce && !x.legacy);
  if (s) return new Uint8Array(s.hash.buffer.slice(0));
  // Older loops (blake, x11, quark...) skip large targets or don't expose hashes.
  throw new Error(`hash(): cpuminer-opt's ${algo} scanner doesn't expose individual hashes`);
}
