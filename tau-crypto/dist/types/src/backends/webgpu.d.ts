import type { Kernel, KernelSetup, ScanJob, ScanOutcome } from '../types.ts';
import { type BackendFactory } from './registry.ts';
/** Invocations per workgroup (one nonce each); tune per GPU. */
export declare const WORKGROUP_SIZE = 256;
/** Candidates one dispatch can report; more make it re-scan in halves. */
export declare const CANDIDATE_CAP = 64;
/** Nonces per dispatch. */
export declare const DISPATCH_NONCES: number;
/** Dispatches per queue submission (one readback each). */
export declare const DISPATCHES_PER_SUBMIT = 16;
export interface WebGpuKernelOptions {
    /** Device to use instead of requesting one; it is not destroyed by dispose(). */
    device?: GPUDevice;
    workgroupSize?: number;
    dispatchNonces?: number;
    dispatchesPerSubmit?: number;
    candidateCap?: number;
    /** Lower cap on workgroups per grid dimension than the device's (tests). */
    maxWorkgroupsPerDimension?: number;
}
/** WGSL for `passes` nested SHA-256s (2, 3 or 4) of the header with each invocation's nonce. */
export declare function shaderSource(passes: number, workgroupSize: number, cap: number): string;
export declare class WebGpuSha256Kernel implements Kernel {
    readonly backend: 'webgpu';
    readonly granularity: number;
    readonly device: GPUDevice;
    readonly adapterInfo: {
        vendor: string;
        architecture: string;
        description: string;
    };
    /** Work done so far: queue submissions, dispatches, 2D-grid dispatches, overflow re-scans, candidates. */
    readonly stats: {
        submissions: number;
        dispatches: number;
        grids2d: number;
        rescans: number;
        candidates: number;
    };
    private readonly passes;
    private readonly ownsDevice;
    private readonly pipeline;
    private readonly bindGroup;
    private readonly uniform;
    private readonly found;
    private readonly readback;
    private readonly params;
    private readonly slotWords;
    private readonly cap;
    private readonly dispatchNonces;
    private readonly perSubmit;
    private readonly maxGroups;
    private readonly hash;
    private tail;
    private readonly lost;
    private lostReason;
    private uncaptured;
    private disposed;
    private constructor();
    static create(setup: KernelSetup, options?: WebGpuKernelOptions): Promise<WebGpuSha256Kernel>;
    private static build;
    scan(job: ScanJob): Promise<ScanOutcome>;
    memoryBytes(): number;
    dispose(): void;
    private usable;
    private run;
    /** Writes the per-work part of every dispatch slot. */
    private setWork;
    private scanRanges;
    /** Runs up to perSubmit ranges in one submission and reads their candidates. */
    private dispatch;
}
export declare function createWebGpuKernel(setup: KernelSetup, options?: WebGpuKernelOptions): Promise<WebGpuSha256Kernel>;
export declare const webgpuBackend: BackendFactory;
