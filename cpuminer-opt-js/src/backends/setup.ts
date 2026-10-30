// Main-thread helpers that turn a backend choice into a KernelSetup: compile
// the WASM variant once, and make sure a verthash dataset exists (Node).
import { compileVariant } from '../wasm/variants.ts';
import { Cmo } from '../wasm/api.ts';
import { nodeBuiltin } from '../env/detect.ts';
import { variantFor, VERTHASH_SIZE } from './wasm.ts';
import type { AlgoSpec, BackendName, KernelSetup } from '../types.ts';

// SHA-256 of a correct verthash.dat (algo/verthash/verthash-gate.c).
const VERTHASH_SHA256 = '48aa21d7afededb63976d48a8ff8ec29d5b02563af4a1110b056cd43e83155a5';

export interface SetupOptions {
  /** verthash.dat location (Node); generated there if missing. */
  verthashFile?: string;
  log?: (msg: string) => void;
}

export async function kernelSetup(backend: BackendName, algo: AlgoSpec, opts: SetupOptions = {}): Promise<KernelSetup> {
  const setup: KernelSetup = { backend, algo };
  const variant = variantFor(backend);
  if (variant) setup.module = await compileVariant(variant);
  if (algo.name === 'verthash') setup.verthash = { file: await ensureVerthashFile(opts) };
  return setup;
}

const pending = new Map<string, Promise<string>>();

/** Returns the path of a verified verthash.dat, generating it if missing (minutes). */
export function ensureVerthashFile(opts: SetupOptions = {}): Promise<string> {
  const file = opts.verthashFile ?? 'verthash.dat';
  let p = pending.get(file);
  if (!p) {
    p = createIfMissing(file, opts.log ?? (() => {}));
    p.catch(() => pending.delete(file));
    pending.set(file, p);
  }
  return p;
}

async function createIfMissing(file: string, log: (msg: string) => void): Promise<string> {
  const fs = await nodeBuiltin('fs');
  const crypto = await nodeBuiltin('crypto');
  if (fs.existsSync(file) && fs.statSync(file).size === VERTHASH_SIZE) return file;

  log(`generating verthash dataset ${file} (1.28 GB, several minutes)...`);
  const cmo = await Cmo.create(await compileVariant('sse41'));
  const ptr = cmo.malloc(VERTHASH_SIZE);
  cmo.bytes(ptr, VERTHASH_SIZE).fill(0);
  const rc = cmo.generateVerthash(ptr, VERTHASH_SIZE);
  if (rc !== 0) throw new Error(`verthash dataset generation failed (${rc})`);
  const data = cmo.bytes(ptr, VERTHASH_SIZE);
  const digest = crypto.createHash('sha256').update(data).digest('hex');
  if (digest !== VERTHASH_SHA256) throw new Error(`generated verthash dataset has the wrong SHA-256 (${digest})`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
  log(`verthash dataset written to ${file}`);
  return file;
}
