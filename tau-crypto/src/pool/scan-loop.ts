// The scan loop that runs a Kernel over assigned work in chunks. Shared by
// the worker entry and the inline (main-thread) executor.
import { getBackend } from '../backends/index.ts';
import type { Kernel, ScanJob } from '../types.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Yields to the event loop (so incoming messages are processed) with no clamping. */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ScanLoop {
  private kernel: Kernel | null = null;
  private current: { gen: number; job: ScanJob; cursor: number; chunk: number } | null = null;
  private throttle = 0;
  private running = false;
  private disposed = false;
  private readonly post: (msg: FromWorker) => void;

  constructor(post: (msg: FromWorker) => void) {
    this.post = post;
  }

  async handle(msg: ToWorker): Promise<void> {
    try {
      switch (msg.type) {
        case 'init': {
          this.kernel = await getBackend(msg.setup.backend).create(msg.setup);
          this.post({
            type: 'ready',
            backend: this.kernel.backend,
            memoryBytes: this.kernel.memoryBytes(),
            granularity: this.kernel.granularity,
          });
          break;
        }
        case 'work':
          this.current = { gen: msg.gen, job: msg.job, cursor: msg.job.start, chunk: this.align(msg.chunk) };
          void this.run();
          break;
        case 'chunk':
          if (this.current) this.current.chunk = this.align(msg.chunk);
          break;
        case 'throttle':
          this.throttle = Math.min(0.95, Math.max(0, msg.value));
          break;
        case 'stop':
          this.current = null;
          break;
        case 'bench':
          await this.bench(msg.job, msg.warmupMs, msg.ms);
          break;
        case 'dispose':
          this.current = null;
          this.disposed = true;
          this.kernel?.dispose();
          this.kernel = null;
          break;
      }
    } catch (err) {
      this.post({ type: 'error', message: errorText(err), fatal: msg.type === 'init' });
    }
  }

  private align(chunk: number): number {
    const g = this.kernel?.granularity ?? 1;
    return Math.max(g, Math.floor(chunk / g) * g);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.current && this.kernel && !this.disposed) {
        const cur = this.current;
        const start = cur.cursor;
        const end = Math.min(start + cur.chunk, cur.job.end);
        const t0 = now();
        const out = await this.kernel.scan({ ...cur.job, start, end });
        const ms = now() - t0;
        if (this.current !== cur) continue; // replaced while scanning; results are stale
        cur.cursor = end;
        this.post({ type: 'progress', gen: cur.gen, seq: cur.job.seq, hashes: out.hashesDone, ms, solutions: out.solutions, cursor: end });
        if (end >= cur.job.end) {
          this.post({ type: 'exhausted', gen: cur.gen, seq: cur.job.seq });
          if (this.current === cur) this.current = null;
        }
        if (this.throttle > 0) await sleep((ms * this.throttle) / (1 - this.throttle));
        else await yieldTask();
      }
    } catch (err) {
      this.current = null;
      this.post({ type: 'error', message: errorText(err), fatal: false });
    } finally {
      this.running = false;
    }
  }

  private async bench(job: ScanJob, warmupMs: number, ms: number): Promise<void> {
    if (!this.kernel) throw new Error('bench before init');
    const k = this.kernel;
    let chunk = Math.max(k.granularity, 256);
    let n = job.start;
    // Warm up (JIT tier-up) while growing the chunk to about 20 ms.
    for (const tEnd = now() + warmupMs; now() < tEnd; ) {
      const t0 = now();
      await k.scan({ ...job, start: n, end: n + chunk });
      n += chunk;
      if (now() - t0 < 20) chunk *= 2;
    }
    let hashes = 0;
    const t0 = now();
    while (now() - t0 < ms) {
      const out = await k.scan({ ...job, start: n, end: n + chunk });
      hashes += out.hashesDone;
      n += chunk;
      if (n > 0xf0000000) n = job.start;
    }
    this.post({ type: 'bench', hashes, ms: now() - t0, memoryBytes: k.memoryBytes() });
  }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
