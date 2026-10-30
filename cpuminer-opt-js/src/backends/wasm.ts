// WASM backends: the compiled cpuminer-opt variants (every algorithm), and
// the hand-tuned sha256d/t/q kernel that ships inside the same modules.
// Kernels are created in workers from a compiled Module posted by the main
// thread (setup.module), so this file never pulls in the embedded bytes.
import { Cmo } from '../wasm/api.ts';
import { nodeBuiltin } from '../env/detect.ts';
import { registerBackend, SHA256_FAMILY, type BackendFactory } from './registry.ts';
import type { AlgoSpec, BackendName, Capabilities, FoundSolution, Kernel, KernelSetup, ScanJob, ScanOutcome } from '../types.ts';

const MAX_NONCE = 0xffffffff;
const SHA256_KIND: Record<string, number> = { sha256d: 2, sha256t: 3, sha256q: 4 };

/** Expected size of verthash.dat. */
export const VERTHASH_SIZE = 1283457024;

/** Copies verthash.dat into the instance's memory (Node). */
async function loadVerthash(cmo: Cmo, file: string): Promise<void> {
  const fs = await nodeBuiltin('fs');
  const size = fs.statSync(file).size;
  if (size !== VERTHASH_SIZE) throw new Error(`${file} is ${size} bytes, expected ${VERTHASH_SIZE}`);
  const ptr = cmo.allocVerthash(size);
  const fd = fs.openSync(file, 'r');
  try {
    for (let off = 0; off < size; ) {
      const len = Math.min(1 << 26, size - off);
      const n = fs.readSync(fd, cmo.bytes(ptr + off, len), 0, len, off);
      if (n <= 0) throw new Error(`short read of ${file}`);
      off += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  cmo.setVerthash(ptr, size);
}

class WasmKernel implements Kernel {
  readonly backend: BackendName;
  readonly granularity = 16;
  private cmo: Cmo;
  private fast: { kind: number; lanes: number } | null;

  constructor(backend: BackendName, cmo: Cmo, fast: { kind: number; lanes: number } | null) {
    this.backend = backend;
    this.cmo = cmo;
    this.fast = fast;
  }

  scan(job: ScanJob): ScanOutcome {
    this.cmo.setScanWork(job.data, job.target);
    const hashesDone = this.fast
      ? this.cmo.call('cmo_sha256_fast_scan', this.fast.kind, this.fast.lanes, job.start >>> 0, job.end)
      : this.cmo.scan(job.start, Math.min(job.end, MAX_NONCE));
    const solutions: FoundSolution[] = this.cmo.solutions().map((s) => ({
      seq: job.seq,
      data: s.data,
      hash: s.hash,
      shareDiff: s.shareDiff,
    }));
    return { hashesDone, solutions };
  }

  memoryBytes(): number {
    return this.cmo.memory.buffer.byteLength;
  }

  dispose(): void {}
}

async function createKernel(setup: KernelSetup, fastLanes: number | null): Promise<Kernel> {
  if (!setup.module) throw new Error(`${setup.backend}: no compiled module supplied`);
  const cmo = await Cmo.create(setup.module);
  const algo = setup.algo;
  if (algo.name === 'verthash') {
    if (!setup.verthash) throw new Error('verthash needs a dataset file (verthashFile option)');
    await loadVerthash(cmo, setup.verthash.file);
  }
  const rc = cmo.init(algo.id, { paramN: algo.paramN, paramR: algo.paramR, key: algo.key, threadInit: true });
  if (rc !== 0) {
    const log = cmo.drainLog().join(' | ');
    throw new Error(`cpuminer-opt failed to initialise ${algo.name} (${rc})${log ? `: ${log}` : ''}`);
  }
  const fast = fastLanes ? { kind: SHA256_KIND[algo.name], lanes: fastLanes } : null;
  return new WasmKernel(setup.backend, cmo, fast);
}

function wasmUnsupported(algo: AlgoSpec, caps: Capabilities): string | null {
  if (!caps.wasm.available) return 'WebAssembly is unavailable (or blocked by a Content Security Policy)';
  if (!caps.wasm.simd128) return 'needs WebAssembly SIMD (Chrome 91+, Firefox 89+, Safari 16.4+, Node 16.4+)';
  if (algo.name === 'verthash' && caps.runtime !== 'node') return 'verthash needs Node (1.28 GB dataset per worker)';
  if (algo.name === 'bmw') return 'bmw is not registered by cpuminer-opt v26.1';
  return null;
}

const variantPriority: Record<string, number> = { avx2: 20, sse42: 21, sse41: 22 };

for (const v of ['avx2', 'sse42', 'sse41'] as const) {
  registerBackend({
    name: `wasm-${v}` as BackendName,
    kind: 'cpu',
    priority: variantPriority[v],
    unsupported: wasmUnsupported,
    create: (setup) => createKernel(setup, null),
  } satisfies BackendFactory);
}

for (const lanes of [8, 4]) {
  registerBackend({
    name: `wasm-sha256-x${lanes}` as BackendName,
    kind: 'cpu',
    priority: lanes === 8 ? 10 : 11,
    unsupported: (algo, caps) =>
      !SHA256_FAMILY.has(algo.name) ? 'only sha256d, sha256t and sha256q' : wasmUnsupported(algo, caps),
    create: (setup) => createKernel(setup, lanes),
  } satisfies BackendFactory);
}

/** Which compiled variant a WASM backend runs on (the sha256 kernels use sse41). */
export function variantFor(backend: BackendName): 'sse41' | 'sse42' | 'avx2' | null {
  if (backend === 'wasm-avx2') return 'avx2';
  if (backend === 'wasm-sse42') return 'sse42';
  if (backend === 'wasm-sse41' || backend.startsWith('wasm-sha256')) return 'sse41';
  return null;
}
