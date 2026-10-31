import { type AlgoParams } from './algos.ts';
import { type TuneOptions } from './tune/autotune.ts';
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
export declare function benchmark(opts: BenchmarkOptions): Promise<BenchmarkResult>;
