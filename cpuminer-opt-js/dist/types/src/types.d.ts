export type RuntimeName = 'node' | 'browser' | 'worker' | 'deno' | 'bun' | 'unknown';
export interface GpuInfo {
    vendor: string;
    architecture: string;
    description: string;
    maxComputeWorkgroupSizeX: number;
    maxComputeInvocationsPerWorkgroup: number;
    maxStorageBufferBindingSize: number;
}
export interface Capabilities {
    runtime: RuntimeName;
    /** Logical CPU cores available to this process / page. */
    cores: number;
    /** Memory budget in bytes (container limit, total RAM or deviceMemory), or null if unknown. */
    memoryBytes: number | null;
    wasm: {
        /** WebAssembly exists and may be compiled here (CSP can forbid it). */
        available: boolean;
        simd128: boolean;
        relaxedSimd: boolean;
    };
    /** Workers can be created (worker_threads, or Web Workers from Blob URLs). */
    workers: boolean;
    /** WebGPU adapter details, or null if unavailable. */
    webgpu: GpuInfo | null;
    /** Node's native crypto module (OpenSSL) is available. */
    nodeCrypto: boolean;
    crossOriginIsolated: boolean;
}
/** Compiled cpuminer-opt variants. */
export type WasmVariant = 'sse41' | 'sse42' | 'avx2';
export type BackendName = 'wasm-sse41' | 'wasm-sse42' | 'wasm-avx2' | 'wasm-sha256-x4' | 'wasm-sha256-x8' | 'webgpu' | 'node-crypto' | 'js';
/** A resolved algorithm (name/alias -> cpuminer-opt id and parameters). */
export interface AlgoSpec {
    /** Canonical cpuminer-opt name, e.g. "sha256d" or "scrypt". */
    name: string;
    /** cpuminer-opt `enum algos` value. */
    id: number;
    /** --param-n (also N of "scrypt:N"), 0 = algorithm default. */
    paramN: number;
    /** --param-r, 0 = algorithm default. */
    paramR: number;
    /** --param-key, or null. */
    key: string | null;
}
/** One unit of hashing: nonces [start, end) of a work's data. */
export interface ScanJob {
    /** Work sequence number from the work instance (cmo_gen_work). */
    seq: number;
    /** cpuminer work data, 48 words (BE32 of header bytes; nonce at gate nonce index). */
    data: Uint32Array;
    /** Target as 8 little-endian words, word 7 most significant. */
    target: Uint32Array;
    start: number;
    /** Exclusive end, at most 2^32. */
    end: number;
}
export interface FoundSolution {
    seq: number;
    /** Full work data at the solution (48 words), nonce included. */
    data: Uint32Array;
    /** Hash as 8 little-endian words, word 7 most significant. */
    hash: Uint32Array;
    shareDiff: number;
}
export interface ScanOutcome {
    hashesDone: number;
    solutions: FoundSolution[];
}
/** A backend bound to one algorithm, running in a worker or on the main thread. */
export interface Kernel {
    readonly backend: BackendName;
    /** Nonces per scan call it handles efficiently (lane count multiple). */
    readonly granularity: number;
    scan(job: ScanJob): ScanOutcome | Promise<ScanOutcome>;
    /** Bytes of memory this kernel holds (WASM linear memory, GPU buffers...). */
    memoryBytes(): number;
    dispose(): void;
}
/** Where a verthash dataset comes from (Node only). */
export interface VerthashSource {
    /** Path of verthash.dat; generated there if missing. */
    file: string;
}
export interface KernelSetup {
    backend: BackendName;
    algo: AlgoSpec;
    /** Compiled module for WASM backends. */
    module?: WebAssembly.Module;
    verthash?: VerthashSource;
}
/** A line-oriented duplex connection to a stratum pool (or to the bridge). */
export interface Transport {
    /** Opens the connection; rejects if it can't be established. */
    connect(): Promise<void>;
    /** Sends one JSON-RPC message (the transport appends the newline). */
    send(line: string): void;
    close(): void;
    /** Called once per received line (without the newline). */
    onLine: ((line: string) => void) | null;
    /** Called once when the connection ends, with an error if it failed. Not called after a local close(). */
    onClose: ((error?: Error) => void) | null;
}
export type TransportFactory = (url: string) => Transport;
export interface ShareResult {
    accepted: boolean;
    /** Pool's reject reason, if any. */
    reason: string | null;
    /** Rejected as stale (reason mentions the job). */
    stale: boolean;
}
export interface StratumEvents {
    subscribed: {
        xnonce1: string;
        xnonce2Size: number;
        sessionId: string | null;
    };
    authorized: {
        user: string;
    };
    difficulty: number;
    /** mining.notify params, verbatim. */
    job: unknown[];
    extranonce: {
        xnonce1: string;
        xnonce2Size: number;
    };
    message: string;
    disconnected: {
        error?: Error;
    };
    reconnecting: {
        url: string;
        delayMs: number;
    };
    error: Error;
    log: string;
}
export interface StratumOptions {
    url: string;
    user: string;
    pass: string;
    /** Builds the transport for a URL. Defaults: Node TCP/TLS, or WebSocket to `bridge` in browsers. */
    transport?: TransportFactory;
    /** ws(s):// URL of a cpuminer-js bridge (browsers). */
    bridge?: string;
    userAgent?: string;
    /** Pause between reconnect attempts (default 10 s, as upstream). */
    retryPauseMs?: number;
    /** Reconnect after this much silence (default 300 s, as upstream). */
    timeoutMs?: number;
    /** Accept any TLS certificate for stratum+ssl (upstream behaviour). Default false. */
    tlsInsecure?: boolean;
    /** Resolve a share as rejected ('timeout') after this long without a reply (default 60 s). */
    shareTimeoutMs?: number;
    /** Give up on subscribe/authorize replies after this long (default 30 s, as upstream). */
    requestTimeoutMs?: number;
    /** Wait this long for the mining.extranonce.subscribe reply (default 3 s, as upstream). */
    extranonceTimeoutMs?: number;
    /** TCP/TLS (or bridge) connect timeout (default 30 s, as upstream). */
    connectTimeoutMs?: number;
}
export interface StratumClient {
    /** Connects, subscribes and authorizes; afterwards reconnects automatically until close(). */
    connect(): Promise<void>;
    close(): void;
    /** Sends a mining.submit request (JSON from the work instance); resolves with the pool's verdict. */
    submit(request: string): Promise<ShareResult>;
    on<K extends keyof StratumEvents>(event: K, listener: (value: StratumEvents[K]) => void): () => void;
    readonly connected: boolean;
}
export interface BackendMeasurement {
    backend: BackendName;
    /** Hashes per second on one worker (or the whole GPU). */
    hps: number;
    /** Instance memory in bytes after init + scan. */
    memoryBytes: number;
    error?: string;
}
export interface TunePlan {
    algo: AlgoSpec;
    cpu: {
        backend: BackendName;
        threads: number;
        hpsPerThread: number;
    } | null;
    gpu: {
        backend: 'webgpu';
        batch: number;
        hps: number;
    } | null;
    expectedHps: number;
    measurements: BackendMeasurement[];
    capabilities: Capabilities;
}
export type BackendChoice = 'auto' | BackendName;
