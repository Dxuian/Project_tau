import type { Transport, TransportFactory } from '../types.ts';
export interface NodeTransportOptions {
    /** Accept any TLS certificate, as upstream does. Default false: verify it. */
    tlsInsecure?: boolean;
    /** Default 30 s, as upstream (CURLOPT_CONNECTTIMEOUT). */
    connectTimeoutMs?: number;
}
export declare function nodeTransport(options?: NodeTransportOptions): TransportFactory;
/** One connection to a pool. onClose fires once if an open connection ends, but not after close(). */
export declare class NodeTransport implements Transport {
    onLine: ((line: string) => void) | null;
    onClose: ((error?: Error) => void) | null;
    private readonly url;
    private readonly options;
    private socket;
    private state;
    constructor(url: string, options?: NodeTransportOptions);
    connect(): Promise<void>;
    send(line: string): void;
    close(): void;
}
