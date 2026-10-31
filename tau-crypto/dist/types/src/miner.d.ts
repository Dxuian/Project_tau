import { type AlgoParams } from './algos.ts';
import { type TuneOptions } from './tune/autotune.ts';
import { Emitter } from './util/emitter.ts';
import type { AlgoSpec, BackendName, StratumClient, TransportFactory, TunePlan } from './types.ts';
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
    nonceRange?: {
        start: number;
        end: number;
    };
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
    job: {
        jobId: string;
        difficulty: number;
        height: number;
    };
    hashrate: {
        hps: number;
        cpuHps: number;
        gpuHps: number;
    };
    share: ShareEvent;
    error: Error;
    log: string;
}
export declare class Miner extends Emitter<MinerEvents> {
    readonly options: MinerOptions;
    readonly algo: AlgoSpec;
    private state;
    private plan;
    private work;
    private pool;
    private gpu;
    private client;
    private gen;
    private haveJob;
    private userPaused;
    private hiddenPaused;
    private startedAt;
    private totals;
    private window;
    private rate;
    private timer;
    private gpuJob;
    private gpuLoop;
    private job;
    private offVisibility;
    constructor(options: MinerOptions);
    private setState;
    private log;
    start(): Promise<void>;
    private bindClient;
    private onJob;
    /** Fresh work (its own extranonce2) for every worker and the GPU. Returns one seq. */
    private assignAll;
    private nextJob;
    private assignWorker;
    private onExhausted;
    private onProgress;
    private runGpu;
    /** Re-checks a solution from a hand-written kernel with cpuminer-opt's own code. */
    private verified;
    private submit;
    private tick;
    private halt;
    private watchVisibility;
    private pauseInternal;
    private resumeInternal;
    pause(): void;
    resume(): void;
    setThrottle(value: number): void;
    /** Changes the CPU thread count (restarts the workers). */
    setThreads(threads: number): Promise<void>;
    stop(): Promise<void>;
    stats(): MinerStats;
}
/** Creates a miner. Nothing connects or hashes until `start()` is called. */
export declare function createMiner(options: MinerOptions): Promise<Miner>;
