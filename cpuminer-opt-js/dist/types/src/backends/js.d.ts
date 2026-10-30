import type { Kernel, KernelSetup, ScanJob, ScanOutcome } from '../types.ts';
import { type BackendFactory } from './registry.ts';
export declare class JsSha256Kernel implements Kernel {
    readonly backend: 'js';
    readonly granularity = 1;
    private readonly passes;
    private readonly params;
    private readonly io;
    private readonly hash;
    constructor(algo: string);
    scan(job: ScanJob): ScanOutcome;
    memoryBytes(): number;
    dispose(): void;
}
export declare function createJsKernel(setup: KernelSetup): JsSha256Kernel;
export declare const jsBackend: BackendFactory;
