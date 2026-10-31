import { type BridgeBaseOptions } from './core.ts';
/** A TCP (or TLS) connection to a pool as web streams; `opened` settles once it is up. */
export interface PoolSocket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<unknown>;
    close(): unknown;
}
/** The server end of an accepted WebSocket. */
export interface ServerWebSocket {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: 'message' | 'close' | 'error', listener: (event: any) => void): void;
}
export interface FetchBridgeOptions extends BridgeBaseOptions {
    /** Opens the connection to an allowed pool; `tls` is the client's tls=1. */
    connect(target: {
        host: string;
        port: number;
        tls: boolean;
    }): PoolSocket;
    /**
     * Accepts the WebSocket upgrade of `request`: the server end, ready to send
     * and receive, and the response that completes the upgrade. Called only once
     * the pool connection is open.
     */
    upgrade(request: Request): {
        socket: ServerWebSocket;
        response: Response;
    };
    /** The client's address, for logs and the interceptor. Default 'unknown'. */
    peer?(request: Request): string | null | undefined;
    /** How long a pool may take to accept the connection. Default 30 s. */
    connectTimeoutMs?: number;
}
/** A `fetch(request)` handler that bridges WebSocket clients to allowlisted pools. */
export declare function createFetchBridge(options: FetchBridgeOptions): {
    fetch(request: Request): Promise<Response>;
};
