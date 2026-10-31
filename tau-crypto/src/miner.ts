// The miner: stratum client -> work instance (cpuminer-opt's own job/work code
// in WASM) -> worker pool (+ GPU), with shares submitted back to the pool.
// Nothing runs until start() is called.
import { resolveAlgo, type AlgoParams } from './algos.ts';
import { autotune, type TuneOptions } from './tune/autotune.ts';
import { kernelSetup } from './backends/setup.ts';
import { getBackend, SHA256_FAMILY, variantFor } from './backends/index.ts';
import { WorkerPool } from './pool/pool.ts';
import { compileVariant } from './wasm/variants.ts';
import { Cmo } from './wasm/api.ts';
import { createStratumClient } from './stratum/index.ts';
import { detectRuntime } from './env/detect.ts';
import { Emitter } from './util/emitter.ts';
import type {
  AlgoSpec,
  BackendName,
  FoundSolution,
  Kernel,
  ScanJob,
  StratumClient,
  TransportFactory,
  TunePlan,
} from './types.ts';

const FULL_RANGE = 0x100000000;

export interface MinerOptions extends TuneOptions {
  algo: string;
  params?: AlgoParams;
  /** stratum+tcp://host:port or stratum+ssl://host:port */
  url: string;
  /** Pool username; for solo.ckpool.org this is your payout address. */
  user: string;
  pass?: string;
  /** ws(s):// URL of a tau-crypto bridge (required in browsers). */
  bridge?: string;
  transport?: TransportFactory;
  tlsInsecure?: boolean;
  userAgent?: string;
  /** Fraction of time to idle, 0 (none) to 0.95. */
  throttle?: number;
  /** Browsers: pause while the page is hidden (default true). */
  pauseWhenHidden?: boolean;
  /** Restrict every worker to this nonce window (testing and debugging). */
  nonceRange?: { start: number; end: number };
  /** Use this stratum client instead of creating one (testing). */
  stratum?: StratumClient;
}

export type MinerState = 'idle' | 'starting' | 'running' | 'paused' | 'stopped';

export interface MinerStats {
  state: MinerState;
  algo: string;
  backend: BackendName | null;
  threads: number;
  gpu: boolean;
  /** Hashes per second (exponentially weighted over ~10 s). */
  hashrate: number;
  totalHashes: number;
  accepted: number;
  rejected: number;
  stale: number;
  uptimeMs: number;
  jobId: string | null;
  difficulty: number | null;
  height: number | null;
}

export interface ShareEvent {
  accepted: boolean;
  stale: boolean;
  reason: string | null;
  shareDiff: number;
  jobId: string;
}

export interface MinerEvents extends Record<string, unknown> {
  state: MinerState;
  tune: TunePlan;
  job: { jobId: string; difficulty: number; height: number };
  hashrate: { hps: number; cpuHps: number; gpuHps: number };
  share: ShareEvent;
  error: Error;
  log: string;
}

export class Miner extends Emitter<MinerEvents> {
  readonly options: MinerOptions;
  readonly algo: AlgoSpec;
  private state: MinerState = 'idle';
  private plan: TunePlan | null = null;
  private work: Cmo | null = null;
  private pool: WorkerPool | null = null;
  private gpu: Kernel | null = null;
  private client: StratumClient | null = null;
  private gen = 0;
  private haveJob = false;
  private userPaused = false;
  private hiddenPaused = false;
  private startedAt = 0;
  private totals = { hashes: 0, accepted: 0, rejected: 0, stale: 0 };
  private window = { cpu: 0, gpu: 0, t: 0 };
  private rate = { cpu: 0, gpu: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private gpuJob: ScanJob | null = null;
  private gpuLoop: Promise<void> | null = null;
  private job: { jobId: string; difficulty: number; height: number } | null = null;
  private offVisibility: (() => void) | null = null;

  constructor(options: MinerOptions) {
    super();
    if (!options.url) throw new Error('url is required');
    if (!options.user) throw new Error('user is required (for solo.ckpool.org: your payout address)');
    this.options = options;
    this.algo = resolveAlgo(options.algo, options.params);
  }

  private setState(s: MinerState): void {
    this.state = s;
    this.emit('state', s);
  }

  private log(msg: string): void {
    this.emit('log', msg);
  }

  async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped') return;
    this.setState('starting');
    try {
      const plan = await autotune(this.algo, { ...this.options, log: (m) => this.log(m) });
      this.plan = plan;
      this.emit('tune', plan);
      this.log(
        `tuned ${this.algo.name}: ${plan.cpu ? `${plan.cpu.backend} x${plan.cpu.threads}` : 'no CPU'}` +
          `${plan.gpu ? ' + webgpu' : ''}, ~${(plan.expectedHps / 1e6).toFixed(2)} MH/s`,
      );

      // Work instance: cpuminer-opt's job parsing and work construction.
      const variant = (plan.cpu && variantFor(plan.cpu.backend)) || 'sse41';
      const work = await Cmo.create(await compileVariant(variant));
      const rc = work.init(this.algo.id, { paramN: this.algo.paramN, paramR: this.algo.paramR, key: this.algo.key });
      if (rc !== 0) throw new Error(`cpuminer-opt failed to initialise ${this.algo.name} (${rc})`);
      work.setUser(this.options.user);
      this.work = work;

      if (plan.cpu) {
        const setup = await kernelSetup(plan.cpu.backend, this.algo, this.options);
        this.pool = await WorkerPool.create(setup, plan.cpu.threads, {
          inline: !plan.capabilities.workers,
          throttle: this.options.throttle,
        });
        this.pool.on('progress', (e) => this.onProgress(e.gen, e.hashes, e.solutions, plan.cpu!.backend));
        this.pool.on('exhausted', (e) => this.onExhausted(e.worker, e.gen));
        this.pool.on('error', (e) => this.emit('error', new Error(`worker ${e.worker}: ${e.message}`)));
      }
      if (plan.gpu) this.gpu = await getBackend('webgpu').create({ backend: 'webgpu', algo: this.algo });

      this.client = this.options.stratum ?? createStratumClient({
        url: this.options.url,
        user: this.options.user,
        pass: this.options.pass ?? 'x',
        bridge: this.options.bridge,
        transport: this.options.transport,
        userAgent: this.options.userAgent,
        tlsInsecure: this.options.tlsInsecure,
      });
      this.bindClient(this.client);
      this.startedAt = Date.now();
      this.window.t = Date.now();
      this.timer = setInterval(() => this.tick(), 2000);
      (this.timer as { unref?: () => void }).unref?.();
      this.watchVisibility();
      this.setState('running');
      await this.client.connect();
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  private bindClient(c: StratumClient): void {
    c.on('subscribed', ({ xnonce1, xnonce2Size }) => {
      if (!this.work?.subscribed(xnonce1, xnonce2Size)) this.emit('error', new Error('invalid extranonce from pool'));
    });
    c.on('difficulty', (d) => this.work?.setDifficulty(d));
    c.on('extranonce', ({ xnonce1, xnonce2Size }) => this.work?.setExtranonce(xnonce1, xnonce2Size));
    c.on('job', (params) => this.onJob(params));
    c.on('message', (m) => this.log(`pool: ${m}`));
    c.on('log', (m) => this.log(m));
    c.on('error', (e) => this.emit('error', e));
    c.on('disconnected', () => {
      // Like upstream (stratum_down): stop hashing until a fresh job arrives.
      this.haveJob = false;
      this.halt();
    });
  }

  private onJob(params: unknown[]): void {
    const work = this.work;
    if (!work) return;
    if (!work.notify(params)) {
      // The previous job stays in effect (upstream flagged a new job anyway).
      this.emit('error', new Error(`ignored invalid job from pool: ${work.drainLog().join(' | ')}`));
      return;
    }
    for (const line of work.drainLog()) this.log(line);
    this.haveJob = true;
    this.gen++;
    const seq = this.assignAll();
    if (seq) {
      this.job = { jobId: work.workJobId(seq), difficulty: work.workTargetDiff(seq), height: work.workHeight(seq) };
      this.emit('job', this.job);
    }
  }

  /** Fresh work (its own extranonce2) for every worker and the GPU. Returns one seq. */
  private assignAll(): number {
    if (!this.haveJob || this.state !== 'running') return 0;
    let seq = 0;
    if (this.pool) for (let i = 0; i < this.pool.size; i++) seq = this.assignWorker(i) || seq;
    if (this.gpu) {
      const job = this.nextJob();
      if (job) {
        seq ||= job.seq;
        this.gpuJob = job;
        this.gpuLoop ??= this.runGpu();
      }
    }
    return seq;
  }

  private nextJob(): ScanJob | null {
    const work = this.work!;
    const seq = work.genWork();
    if (!seq) return null;
    const range = this.options.nonceRange;
    return {
      seq,
      data: work.workData(seq),
      target: work.workTarget(seq),
      start: range?.start ?? 0,
      end: range?.end ?? FULL_RANGE,
    };
  }

  private assignWorker(i: number): number {
    const job = this.nextJob();
    if (!job || !this.pool) return 0;
    this.pool.assign(i, this.gen, job);
    return job.seq;
  }

  private onExhausted(worker: number, gen: number): void {
    // Nonce space done: move this worker to the next extranonce2.
    if (gen === this.gen && this.state === 'running' && this.haveJob) this.assignWorker(worker);
  }

  private onProgress(gen: number, hashes: number, solutions: FoundSolution[], backend: BackendName | 'webgpu'): void {
    this.totals.hashes += hashes;
    if (backend === 'webgpu') this.window.gpu += hashes;
    else this.window.cpu += hashes;
    for (const s of solutions) void this.submit(s, backend, gen);
  }

  private async runGpu(): Promise<void> {
    const kernel = this.gpu!;
    const batch = this.plan?.gpu?.batch ?? 1 << 22;
    try {
      while (this.state === 'running' && this.gpuJob) {
        const job = this.gpuJob;
        const gen = this.gen;
        const start = job.start;
        const end = Math.min(start + batch, job.end);
        const out = await kernel.scan({ ...job, start, end });
        if (this.gpuJob === job) {
          job.start = end;
          if (end >= job.end) this.gpuJob = this.nextJob();
        }
        this.onProgress(gen, out.hashesDone, out.solutions, 'webgpu');
      }
    } catch (err) {
      this.emit('error', new Error(`webgpu: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      this.gpuLoop = null;
    }
  }

  /** Re-checks a solution from a hand-written kernel with cpuminer-opt's own code. */
  private verified(s: FoundSolution): boolean {
    const work = this.work!;
    const target = work.workTarget(s.seq);
    work.setScanWork(s.data, target);
    const nonce = s.data[19];
    work.scan(nonce, Math.min(nonce + 16, 0xffffffff));
    return work.solutions().some((x) => x.data[19] === nonce && x.hash.every((w, i) => w === s.hash[i]));
  }

  private async submit(s: FoundSolution, backend: BackendName | 'webgpu', gen: number): Promise<void> {
    const work = this.work;
    const client = this.client;
    if (!work || !client) return;
    const custom = SHA256_FAMILY.has(this.algo.name) && !['wasm-sse41', 'wasm-sse42', 'wasm-avx2'].includes(backend);
    try {
      if (custom && !this.verified(s)) {
        this.emit('error', new Error(`${backend} produced a solution that cpuminer-opt rejects; dropped`));
        return;
      }
    } catch {
      return; // work already gone from the ring: stale
    }
    const request = work.buildSubmit(s.seq, s.data);
    if (!request) return;
    const jobId = work.workJobId(s.seq);
    if (gen !== this.gen) this.log(`submitting share for an older job (${jobId})`);
    try {
      const verdict = await client.submit(request);
      if (verdict.accepted) this.totals.accepted++;
      else if (verdict.stale) this.totals.stale++;
      else this.totals.rejected++;
      this.emit('share', { ...verdict, shareDiff: s.shareDiff, jobId });
    } catch (err) {
      this.totals.rejected++;
      this.emit('share', { accepted: false, stale: false, reason: String(err), shareDiff: s.shareDiff, jobId });
    }
  }

  private tick(): void {
    const now = Date.now();
    const dt = (now - this.window.t) / 1000;
    if (dt <= 0) return;
    const a = 1 - Math.exp(-dt / 10);
    this.rate.cpu += a * (this.window.cpu / dt - this.rate.cpu);
    this.rate.gpu += a * (this.window.gpu / dt - this.rate.gpu);
    this.window = { cpu: 0, gpu: 0, t: now };
    this.emit('hashrate', { hps: this.rate.cpu + this.rate.gpu, cpuHps: this.rate.cpu, gpuHps: this.rate.gpu });
  }

  private halt(): void {
    this.pool?.stop();
    this.gpuJob = null;
  }

  private watchVisibility(): void {
    if (detectRuntime() !== 'browser' || this.options.pauseWhenHidden === false) return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const onChange = () => {
      this.hiddenPaused = doc.visibilityState === 'hidden';
      if (this.hiddenPaused) this.pauseInternal();
      else if (!this.userPaused) this.resumeInternal();
    };
    doc.addEventListener('visibilitychange', onChange);
    this.offVisibility = () => doc.removeEventListener('visibilitychange', onChange);
  }

  private pauseInternal(): void {
    if (this.state !== 'running') return;
    this.halt();
    this.setState('paused');
  }

  private resumeInternal(): void {
    if (this.state !== 'paused') return;
    this.setState('running');
    this.gen++;
    this.assignAll();
  }

  pause(): void {
    this.userPaused = true;
    this.pauseInternal();
  }

  resume(): void {
    this.userPaused = false;
    if (!this.hiddenPaused) this.resumeInternal();
  }

  setThrottle(value: number): void {
    this.options.throttle = value;
    this.pool?.setThrottle(value);
  }

  /** Changes the CPU thread count (restarts the workers). */
  async setThreads(threads: number): Promise<void> {
    if (!this.plan?.cpu || !this.pool) return;
    const old = this.pool;
    const setup = await kernelSetup(this.plan.cpu.backend, this.algo, this.options);
    const pool = await WorkerPool.create(setup, Math.max(1, threads), {
      inline: old.inline,
      throttle: this.options.throttle,
    });
    const backend = this.plan.cpu.backend;
    pool.on('progress', (e) => this.onProgress(e.gen, e.hashes, e.solutions, backend));
    pool.on('exhausted', (e) => this.onExhausted(e.worker, e.gen));
    pool.on('error', (e) => this.emit('error', new Error(`worker ${e.worker}: ${e.message}`)));
    this.pool = pool;
    this.plan.cpu.threads = pool.size;
    old.terminate();
    if (this.state === 'running') {
      this.gen++;
      this.assignAll();
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    this.setState('stopped');
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.offVisibility?.();
    this.client?.close();
    this.pool?.terminate();
    this.pool = null;
    this.gpuJob = null;
    await this.gpuLoop;
    this.gpu?.dispose();
    this.gpu = null;
  }

  stats(): MinerStats {
    return {
      state: this.state,
      algo: this.algo.name,
      backend: this.plan?.cpu?.backend ?? (this.plan?.gpu ? 'webgpu' : null),
      threads: this.plan?.cpu?.threads ?? 0,
      gpu: !!this.plan?.gpu,
      hashrate: this.rate.cpu + this.rate.gpu,
      totalHashes: this.totals.hashes,
      accepted: this.totals.accepted,
      rejected: this.totals.rejected,
      stale: this.totals.stale,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      jobId: this.job?.jobId ?? null,
      difficulty: this.job?.difficulty ?? null,
      height: this.job?.height ?? null,
    };
  }
}

/** Creates a miner. Nothing connects or hashes until `start()` is called. */
export async function createMiner(options: MinerOptions): Promise<Miner> {
  return new Miner(options);
}
