import { type RawExports } from './loader.ts';
export declare const ABI_VERSION = 1;
export declare const MAX_SOLUTIONS = 64;
export declare const DATA_WORDS = 48;
export interface GateInfo {
    ntimeIndex: number;
    nbitsIndex: number;
    nonceIndex: number;
    workCmpSize: number;
    workDataSize: number;
    targetFactor: number;
}
export interface Solution {
    /** Full work data at the time of the solution (48 words), nonce included. */
    data: Uint32Array;
    /** Hash as eight little-endian words, word 7 most significant (zeros if legacy). */
    hash: Uint32Array;
    shareDiff: number;
    /** Found by a legacy scanhash that reports the nonce but not the hash. */
    legacy: boolean;
}
export interface InitOptions {
    paramN?: number;
    paramR?: number;
    key?: string | null;
    /** Allocate per-thread scratchpads (scan instances). */
    threadInit?: boolean;
}
export declare class Cmo {
    readonly raw: RawExports;
    private fns;
    private encoder;
    private decoder;
    private scanData;
    private scanTarget;
    private constructor();
    static create(module: WebAssembly.Module, onOutput?: (line: string) => void): Promise<Cmo>;
    get memory(): WebAssembly.Memory;
    call(name: string, ...args: number[]): number;
    malloc(size: number): number;
    free(ptr: number): void;
    bytes(ptr: number, len: number): Uint8Array;
    u32(ptr: number, words: number): Uint32Array;
    cstring(ptr: number): string;
    withCString<T>(s: string | null | undefined, fn: (ptr: number) => T): T;
    private withScratch;
    algoCount(): number;
    algoName(id: number): string | null;
    /** Resolves a name or alias ("scrypt:N" included). */
    resolve(name: string): {
        id: number;
        paramN: number;
    } | null;
    /** Returns 0, -1 (registration failed) or -2 (thread init failed). */
    init(id: number, opts?: InitOptions): number;
    gateInfo(): GateInfo;
    /** Pending applog output from the C side (and clears it). */
    drainLog(): string[];
    setUser(user: string): void;
    subscribed(xnonce1: string, xnonce2Size: number): boolean;
    setExtranonce(xnonce1: string, xnonce2Size: number): boolean;
    setDifficulty(diff: number): void;
    /** mining.notify params (the JSON array). */
    notify(params: unknown[]): boolean;
    /** Builds work from the current job and advances extranonce2. 0 = no job. */
    genWork(): number;
    workData(seq: number): Uint32Array;
    workTarget(seq: number): Uint32Array;
    workTargetDiff(seq: number): number;
    workJobId(seq: number): string;
    workHeight(seq: number): number;
    netDiff(): number;
    /** mining.submit JSON for a solution of work `seq` (null if the work is gone). */
    buildSubmit(seq: number, data: Uint32Array): string | null;
    setScanWork(data: Uint32Array, target: Uint32Array): void;
    /** Scans nonces [start, end); returns hashes done. */
    scan(start: number, end: number): number;
    solutionCount(): number;
    solutions(): Solution[];
    validHash(hash: Uint32Array, target: Uint32Array): boolean;
    /** Direct single-nonce hash for algorithms with a direct entry point (quark); null otherwise. */
    directHash(data: Uint32Array, nonce: number): Uint32Array | null;
    /** The deterministic 48-word input shared with the native golden harness. */
    fixtureData(): Uint32Array;
    diffToTarget(diff: number): Uint32Array;
    /** Allocates `size` bytes in this instance for the verthash dataset. */
    allocVerthash(size: number): number;
    setVerthash(ptr: number, size: number): void;
    generateVerthash(ptr: number, size: number): number;
}
