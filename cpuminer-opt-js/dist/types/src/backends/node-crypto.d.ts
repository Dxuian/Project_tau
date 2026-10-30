import type { Kernel, KernelSetup, ScanJob, ScanOutcome } from '../types.ts';
import { type BackendFactory } from './registry.ts';
type Bytes = Uint8Array & {
    readUInt32LE(offset: number): number;
};
type HashFn = (data: Uint8Array) => Bytes;
export declare class NodeCryptoKernel implements Kernel {
    readonly backend: 'node-crypto';
    readonly granularity = 1;
    private readonly passes;
    private readonly sha256;
    private readonly header;
    private readonly view;
    private readonly hash;
    constructor(algo: string, sha256: HashFn);
    scan(job: ScanJob): ScanOutcome;
    memoryBytes(): number;
    dispose(): void;
}
export declare function createNodeCryptoKernel(setup: KernelSetup): Promise<NodeCryptoKernel>;
export declare const nodeCryptoBackend: BackendFactory;
export {};
