import type { Transport, TransportFactory } from '../types.ts';
export interface WsTransportOptions {
    /** ws:// or wss:// URL of the bridge. */
    bridge: string;
    /** Default 30 s. */
    connectTimeoutMs?: number;
    /** WebSocket constructor; defaults to the global one. */
    WebSocket?: new (url: string) => any;
}
export declare function wsTransport(options: WsTransportOptions): TransportFactory;
/** The bridge URL for a pool: `${bridge}?target=host%3Aport&tls=0|1`. */
export declare function bridgeUrl(bridge: string, poolUrl: string): string;
/** One connection through the bridge. onClose fires once if an open connection ends, but not after close(). */
export declare class WsTransport implements Transport {
    onLine: ((line: string) => void) | null;
    onClose: ((error?: Error) => void) | null;
    private readonly url;
    private readonly options;
    private readonly decoder;
    private ws;
    private state;
    private abort;
    constructor(url: string, options: WsTransportOptions);
    connect(): Promise<void>;
    send(line: string): void;
    close(): void;
    private message;
    /** The connection ended on its own (or must end): close it and report once. */
    private ended;
}
