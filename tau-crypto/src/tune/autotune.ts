// Picks the fastest way to hash an algorithm here: candidate backends come
// from capability detection, then each is measured in a real worker (WASM
// CPU flags are invisible, so measuring is the only reliable signal).
import { detect } from '../env/detect.ts';
import { listBackends } from '../backends/index.ts';
import { kernelSetup, type SetupOptions } from '../backends/setup.ts';
import { WorkerPool } from '../pool/pool.ts';
import type {
  AlgoSpec,
  BackendChoice,
  BackendMeasurement,
  BackendName,
  Capabilities,
  Kernel,
  ScanJob,
  TunePlan,
} from '../types.ts';
import { VARIANT_PREFS } from './variant-prefs.ts';

export interface TuneOptions extends SetupOptions {
  /** quick: measure only the likely-best candidates (browser default); thorough: all (Node default). */
  mode?: 'quick' | 'thorough';
  backend?: BackendChoice;
  threads?: number | 'auto';
  /** Use a GPU backend if one works (default true). */
  gpu?: boolean;
  warmupMs?: number;
  measureMs?: number;
  capabilities?: Capabilities;
}

/** cpuminer's benchmark header (all zero, nonce varies) with a difficulty-1 style target. */
export function benchmarkJob(): ScanJob {
  const data = new Uint32Array(48);
  data[20] = 0x80000000;
  data[31] = 0x280;
  const target = new Uint32Array(8);
  target[6] = 0xffff0000;
  return { seq: 0, data, target, start: 0, end: 0x100000000 };
}

/** Candidate CPU backends for an algorithm, best guess first. */
export function cpuCandidates(algo: AlgoSpec, caps: Capabilities, mode: 'quick' | 'thorough'): BackendName[] {
  const usable = listBackends().filter((f) => f.kind === 'cpu' && !f.unsupported(algo, caps));
  if (mode === 'thorough') return usable.map((f) => f.name);
  const names = new Set(usable.map((f) => f.name));
  const pref = `wasm-${VARIANT_PREFS[algo.name] ?? 'sse41'}` as BackendName;
  const quick = (['wasm-sha256-x8', 'wasm-sha256-x4', pref, 'wasm-sse41'] as BackendName[]).filter((n) => names.has(n));
  if (quick.length) return [...new Set(quick)];
  // No WASM SIMD: the hand-written sha256 kernels are the only option.
  return (['node-crypto', 'js'] as BackendName[]).filter((n) => names.has(n));
}

function defaultThreads(caps: Capabilities, gpu: boolean): number {
  const base = caps.runtime === 'node' ? caps.cores : Math.max(1, caps.cores - 1);
  return Math.max(1, base - (gpu ? 1 : 0));
}

async function measureCpu(
  backend: BackendName,
  algo: AlgoSpec,
  caps: Capabilities,
  opts: TuneOptions,
): Promise<BackendMeasurement> {
  let pool: WorkerPool | null = null;
  try {
    const setup = await kernelSetup(backend, algo, opts);
    pool = await WorkerPool.create(setup, 1, { inline: !caps.workers });
    const r = await pool.bench(benchmarkJob(), opts.warmupMs ?? 150, opts.measureMs ?? 400);
    return { backend, hps: r.hps, memoryBytes: r.memoryBytes };
  } catch (err) {
    return { backend, hps: 0, memoryBytes: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    pool?.terminate();
  }
}

/** Measures the GPU kernel on the main thread; returns the batch size used. */
export async function measureGpu(
  kernel: Kernel,
  targetMs = 50,
): Promise<{ hps: number; batch: number }> {
  const job = benchmarkJob();
  let batch = 1 << 18;
  for (;;) {
    const t0 = performance.now();
    await kernel.scan({ ...job, start: 0, end: batch });
    const ms = performance.now() - t0;
    if (ms >= targetMs || batch >= 1 << 30) break;
    batch = Math.min(1 << 30, batch * Math.max(2, Math.floor(targetMs / Math.max(ms, 1))));
  }
  let hashes = 0;
  const t0 = performance.now();
  for (let i = 0; i < 3; i++) hashes += (await kernel.scan({ ...job, start: i * batch, end: (i + 1) * batch })).hashesDone;
  return { hps: (hashes / (performance.now() - t0)) * 1000, batch };
}

export async function autotune(algo: AlgoSpec, opts: TuneOptions = {}): Promise<TunePlan> {
  const caps = opts.capabilities ?? (await detect({ gpu: opts.gpu !== false }));
  const mode = opts.mode ?? (caps.runtime === 'node' ? 'thorough' : 'quick');
  const measurements: BackendMeasurement[] = [];

  // GPU first: whether it's in use changes how many CPU threads to run.
  let gpu: TunePlan['gpu'] = null;
  const wantGpu = opts.gpu !== false && (opts.backend === 'auto' || opts.backend === undefined || opts.backend === 'webgpu');
  const gpuFactory = listBackends().find((f) => f.kind === 'gpu' && !f.unsupported(algo, caps));
  if (wantGpu && gpuFactory) {
    let kernel: Kernel | null = null;
    try {
      kernel = await gpuFactory.create({ backend: gpuFactory.name, algo });
      const m = await measureGpu(kernel);
      measurements.push({ backend: gpuFactory.name, hps: m.hps, memoryBytes: kernel.memoryBytes() });
      if (m.hps > 0) gpu = { backend: 'webgpu', batch: m.batch, hps: m.hps };
    } catch (err) {
      measurements.push({ backend: gpuFactory.name, hps: 0, memoryBytes: 0, error: err instanceof Error ? err.message : String(err) });
    } finally {
      kernel?.dispose();
    }
  }

  let cpu: TunePlan['cpu'] = null;
  if (opts.backend !== 'webgpu') {
    const candidates =
      opts.backend && opts.backend !== 'auto' ? [opts.backend] : cpuCandidates(algo, caps, mode);
    for (const b of candidates) measurements.push(await measureCpu(b, algo, caps, opts));
    const best = measurements
      .filter((m) => m.backend !== 'webgpu' && m.hps > 0)
      .sort((a, b) => b.hps - a.hps)[0];
    if (best) {
      let threads = typeof opts.threads === 'number' ? opts.threads : defaultThreads(caps, !!gpu);
      if (opts.threads === undefined || opts.threads === 'auto') {
        const budget = (caps.memoryBytes ?? 4 * 2 ** 30) * 0.7;
        threads = Math.max(1, Math.min(threads, Math.floor(budget / Math.max(best.memoryBytes, 1))));
      }
      cpu = { backend: best.backend, threads, hpsPerThread: best.hps };
    }
  }

  if (!cpu && !gpu) {
    const why = measurements.map((m) => `${m.backend}: ${m.error ?? 'no hashes'}`).join('; ');
    throw new Error(`no working backend for ${algo.name}${why ? ` (${why})` : ''}`);
  }
  const expectedHps = (cpu ? cpu.hpsPerThread * cpu.threads : 0) + (gpu ? gpu.hps : 0);
  return { algo, cpu, gpu, expectedHps, measurements, capabilities: caps };
}
