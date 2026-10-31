import type { AlgoSpec, BackendName, KernelSetup } from '../types.ts';
export interface SetupOptions {
    /** verthash.dat location (Node); generated there if missing. */
    verthashFile?: string;
    log?: (msg: string) => void;
}
export declare function kernelSetup(backend: BackendName, algo: AlgoSpec, opts?: SetupOptions): Promise<KernelSetup>;
/** Returns the path of a verified verthash.dat, generating it if missing (minutes). */
export declare function ensureVerthashFile(opts?: SetupOptions): Promise<string>;
