// benchmark(): like `cpuminer --benchmark`. Autotunes (measuring every
// candidate backend), then optionally runs the chosen plan at full width.
import { resolveAlgo, type AlgoParams } from './algos.ts';
import { autotune, benchmarkJob, type TuneOptions } from './tune/autotune.ts';
import { kernelSetup } from './backends/setup.ts';
import { getBackend } from './backends/index.ts';
import { WorkerPool } from './pool/pool.ts';
import type { TunePlan } from './types.ts';

export interface BenchmarkOptions extends TuneOptions {
  algo: string;
  params?: AlgoParams;
  /** Run the chosen plan with all threads (and the GPU) for this long; 0 = measure only. */
  seconds?: number;
}

export interface BenchmarkResult {
  plan: TunePlan;
  /** Measured total over `seconds` with every thread (null if seconds was 0). */
  totalHps: number | null;
  cpuHps: number | null;
  gpuHps: number | null;
}

export async function benchmark(opts: BenchmarkOptions): Promise<BenchmarkResult> {
  const algo = resolveAlgo(opts.algo, opts.params);
  const plan = await autotune(algo, opts);
  const seconds = opts.seconds ?? 0;
  if (seconds <= 0) return { plan, totalHps: null, cpuHps: null, gpuHps: null };

  const ms = seconds * 1000;
  let cpuHashes = 0;
  let gpuHashes = 0;
  let pool: WorkerPool | null = null;
  const tasks: Promise<void>[] = [];

  if (plan.cpu) {
    const setup = await kernelSetup(plan.cpu.backend, algo, opts);
    pool = await WorkerPool.create(setup, plan.cpu.threads, { inline: !plan.capabilities.workers });
    const p = pool;
    const span = Math.floor(0x100000000 / plan.cpu.threads);
    p.on('progress', (e) => (cpuHashes += e.hashes));
    for (let i = 0; i < plan.cpu.threads; i++) {
      p.assign(i, 1, { ...benchmarkJob(), start: i * span, end: (i + 1) * span });
    }
  }
  const t0 = performance.now();
  if (plan.gpu) {
    const kernel = await getBackend('webgpu').create({ backend: 'webgpu', algo });
    const batch = plan.gpu.batch;
    tasks.push(
      (async () => {
        try {
          for (let n = 0; performance.now() - t0 < ms; n = (n + batch) % 0xf0000000) {
            gpuHashes += (await kernel.scan({ ...benchmarkJob(), start: n, end: n + batch })).hashesDone;
          }
        } finally {
          kernel.dispose();
        }
      })(),
    );
  }
  await new Promise((r) => setTimeout(r, ms));
  pool?.stop();
  await Promise.all(tasks);
  const elapsed = (performance.now() - t0) / 1000;
  pool?.terminate();
  const cpuHps = plan.cpu ? cpuHashes / elapsed : null;
  const gpuHps = plan.gpu ? gpuHashes / elapsed : null;
  return { plan, totalHps: (cpuHps ?? 0) + (gpuHps ?? 0), cpuHps, gpuHps };
}
