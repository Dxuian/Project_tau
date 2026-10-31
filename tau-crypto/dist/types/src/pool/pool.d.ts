import { Emitter } from '../util/emitter.ts';
import type { BackendName, FoundSolution, KernelSetup, ScanJob } from '../types.ts';
export interface PoolEvents extends Record<string, unknown> {
    progress: {
        worker: number;
        gen: number;
        seq: number;
        hashes: number;
        ms: number;
        solutions: FoundSolution[];
    };
    exhausted: {
        worker: number;
        gen: number;
        seq: number;
    };
    error: {
        worker: number;
        message: string;
    };
}
export interface PoolOptions {
    /** Run the scan loop on the main thread instead of in workers. */
    inline?: boolean;
    /** Target wall time per scan chunk (default 100 ms). */
    chunkMs?: number;
    throttle?: number;
}
/** A set of identical scan workers, all initialised with the same KernelSetup. */
export declare class WorkerPool extends Emitter<PoolEvents> {
    readonly size: number;
    readonly backend: BackendName;
    readonly inline: boolean;
    private channels;
    private chunks;
    private granularity;
    private memory;
    private chunkMs;
    /** One-shot waiters per worker for 'ready' and 'bench' replies. */
    private waiters;
    private constructor();
    static create(setup: KernelSetup, size: number, opts?: PoolOptions): Promise<WorkerPool>;
    private start;
    private request;
    private route;
    private dispatch;
    /** Largest memory footprint reported by a worker (bytes). */
    memoryBytes(): number;
    assign(worker: number, gen: number, job: ScanJob): void;
    stop(): void;
    setThrottle(value: number): void;
    /** One measurement on worker 0: hashes per second and memory. */
    bench(job: ScanJob, warmupMs: number, ms: number): Promise<{
        hps: number;
        memoryBytes: number;
    }>;
    terminate(): void;
}
