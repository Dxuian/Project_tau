import { type SetupOptions } from '../backends/setup.ts';
import type { AlgoSpec, BackendChoice, BackendName, Capabilities, Kernel, ScanJob, TunePlan } from '../types.ts';
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
export declare function benchmarkJob(): ScanJob;
/** Candidate CPU backends for an algorithm, best guess first. */
export declare function cpuCandidates(algo: AlgoSpec, caps: Capabilities, mode: 'quick' | 'thorough'): BackendName[];
/** Measures the GPU kernel on the main thread; returns the batch size used. */
export declare function measureGpu(kernel: Kernel, targetMs?: number): Promise<{
    hps: number;
    batch: number;
}>;
export declare function autotune(algo: AlgoSpec, opts?: TuneOptions): Promise<TunePlan>;
