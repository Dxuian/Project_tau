import type { AlgoSpec, BackendName, Capabilities, Kernel, KernelSetup } from '../types.ts';
export interface BackendFactory {
    readonly name: BackendName;
    readonly kind: 'cpu' | 'gpu';
    /** Lower runs first in quick mode when nothing has been measured. */
    readonly priority: number;
    /** null if usable, otherwise the reason it isn't (shown in tune results). */
    unsupported(algo: AlgoSpec, caps: Capabilities): string | null;
    create(setup: KernelSetup): Promise<Kernel>;
}
export declare function registerBackend(factory: BackendFactory): void;
export declare function getBackend(name: BackendName): BackendFactory;
export declare function listBackends(): BackendFactory[];
/** Algorithms the hand-written sha256 kernels implement (js, node-crypto, wasm-sha256-*, webgpu). */
export declare const SHA256_FAMILY: Set<string>;
