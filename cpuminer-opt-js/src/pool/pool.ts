// Scan workers on the main-thread side: spawns Node worker_threads or Web
// Workers (from the embedded bundle, so no extra files are needed), or runs
// the same scan loop inline when workers aren't available.
import { detectRuntime, nodeBuiltin } from '../env/detect.ts';
import { Emitter } from '../util/emitter.ts';
import type { BackendName, FoundSolution, KernelSetup, ScanJob } from '../types.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import { ScanLoop } from './scan-loop.ts';
import { WORKER_SOURCE } from './worker-source.ts';

interface Channel {
  post(msg: ToWorker): void;
  onMessage(cb: (msg: FromWorker) => void): void;
  terminate(): void;
}

let blobUrl: string | null = null;

async function spawnChannel(inline: boolean): Promise<Channel> {
  if (inline) {
    let listener: (m: FromWorker) => void = () => {};
    const loop = new ScanLoop((m) => queueMicrotask(() => listener(m)));
    return {
      post: (m) => void loop.handle(m),
      onMessage: (cb) => (listener = cb),
      terminate: () => void loop.handle({ type: 'dispose' }),
    };
  }
  if (detectRuntime() === 'node') {
    const { Worker } = await nodeBuiltin('worker_threads');
    const w = WORKER_SOURCE
      ? new Worker(WORKER_SOURCE, { eval: true })
      : new Worker(new URL('./worker-entry.ts', import.meta.url));
    w.unref?.();
    return {
      post: (m) => w.postMessage(m),
      onMessage: (cb) => w.on('message', cb),
      terminate: () => void w.terminate(),
    };
  }
  if (!WORKER_SOURCE) throw new Error('browser workers need the built library (dist/)');
  blobUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  const w = new Worker(blobUrl);
  return {
    post: (m) => w.postMessage(m),
    onMessage: (cb) => (w.onmessage = (e: MessageEvent<FromWorker>) => cb(e.data)),
    terminate: () => w.terminate(),
  };
}

export interface PoolEvents extends Record<string, unknown> {
  progress: { worker: number; gen: number; seq: number; hashes: number; ms: number; solutions: FoundSolution[] };
  exhausted: { worker: number; gen: number; seq: number };
  error: { worker: number; message: string };
}

export interface PoolOptions {
  /** Run the scan loop on the main thread instead of in workers. */
  inline?: boolean;
  /** Target wall time per scan chunk (default 100 ms). */
  chunkMs?: number;
  throttle?: number;
}

/** A set of identical scan workers, all initialised with the same KernelSetup. */
export class WorkerPool extends Emitter<PoolEvents> {
  readonly size: number;
  readonly backend: BackendName;
  readonly inline: boolean;
  private channels: Channel[] = [];
  private chunks: number[] = [];
  private granularity = 1;
  private memory = 0;
  private chunkMs: number;
  /** One-shot waiters per worker for 'ready' and 'bench' replies. */
  private waiters = new Map<number, { type: 'ready' | 'bench'; resolve: (m: FromWorker) => void; reject: (e: Error) => void }>();

  private constructor(size: number, backend: BackendName, inline: boolean, chunkMs: number) {
    super();
    this.size = size;
    this.backend = backend;
    this.inline = inline;
    this.chunkMs = chunkMs;
  }

  static async create(setup: KernelSetup, size: number, opts: PoolOptions = {}): Promise<WorkerPool> {
    const pool = new WorkerPool(size, setup.backend, !!opts.inline, opts.chunkMs ?? 100);
    try {
      await Promise.all(Array.from({ length: size }, (_, i) => pool.start(i, setup)));
    } catch (err) {
      pool.terminate();
      throw err;
    }
    if (opts.throttle) pool.setThrottle(opts.throttle);
    return pool;
  }

  private async start(i: number, setup: KernelSetup): Promise<void> {
    const ch = await spawnChannel(this.inline);
    this.channels[i] = ch;
    this.chunks[i] = 4096;
    ch.onMessage((m) => this.route(i, m));
    const m = await this.request(i, 'ready', { type: 'init', setup });
    if (m.type === 'ready') {
      this.granularity = m.granularity;
      this.memory = Math.max(this.memory, m.memoryBytes);
    }
  }

  private request(worker: number, type: 'ready' | 'bench', msg: ToWorker): Promise<FromWorker> {
    return new Promise((resolve, reject) => {
      this.waiters.set(worker, { type, resolve, reject });
      this.channels[worker].post(msg);
    });
  }

  private route(worker: number, m: FromWorker): void {
    const w = this.waiters.get(worker);
    if (w && (m.type === w.type || (m.type === 'error' && (w.type === 'bench' || m.fatal)))) {
      this.waiters.delete(worker);
      if (m.type === 'error') w.reject(new Error(m.message));
      else w.resolve(m);
      return;
    }
    this.dispatch(worker, m);
  }

  private dispatch(worker: number, m: FromWorker): void {
    switch (m.type) {
      case 'progress': {
        // Aim each chunk at chunkMs so new jobs and stops apply quickly.
        if (m.ms > 0 && m.hashes > 0) {
          const ideal = (m.hashes / m.ms) * this.chunkMs;
          const next = Math.max(this.granularity, Math.min(ideal, 1 << 28));
          if (Math.abs(next - this.chunks[worker]) / this.chunks[worker] > 0.25) {
            this.chunks[worker] = Math.round(next);
            this.channels[worker]?.post({ type: 'chunk', chunk: this.chunks[worker] });
          }
        }
        this.emit('progress', { worker, gen: m.gen, seq: m.seq, hashes: m.hashes, ms: m.ms, solutions: m.solutions });
        break;
      }
      case 'exhausted':
        this.emit('exhausted', { worker, gen: m.gen, seq: m.seq });
        break;
      case 'error':
        this.emit('error', { worker, message: m.message });
        break;
      default:
        break;
    }
  }

  /** Largest memory footprint reported by a worker (bytes). */
  memoryBytes(): number {
    return this.memory;
  }

  assign(worker: number, gen: number, job: ScanJob): void {
    this.channels[worker]?.post({ type: 'work', gen, job, chunk: this.chunks[worker] });
  }

  stop(): void {
    for (const ch of this.channels) ch?.post({ type: 'stop' });
  }

  setThrottle(value: number): void {
    for (const ch of this.channels) ch?.post({ type: 'throttle', value });
  }

  /** One measurement on worker 0: hashes per second and memory. */
  async bench(job: ScanJob, warmupMs: number, ms: number): Promise<{ hps: number; memoryBytes: number }> {
    const m = await this.request(0, 'bench', { type: 'bench', job, warmupMs, ms });
    if (m.type !== 'bench') throw new Error('unexpected bench reply');
    this.memory = Math.max(this.memory, m.memoryBytes);
    return { hps: m.ms > 0 ? (m.hashes / m.ms) * 1000 : 0, memoryBytes: m.memoryBytes };
  }

  terminate(): void {
    for (const w of this.waiters.values()) w.reject(new Error('pool terminated'));
    this.waiters.clear();
    for (const ch of this.channels) {
      try {
        ch?.post({ type: 'dispose' });
        ch?.terminate();
      } catch {
        // already gone
      }
    }
    this.channels = [];
    this.removeAll();
  }
}
