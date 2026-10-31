import { type BridgeBaseOptions } from './core.ts';
/** The parts of a Workers TCP socket the bridge uses. */
export interface WorkerSocket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<unknown>;
    close(): unknown;
}
export type WorkerConnect = (address: {
    hostname: string;
    port: number;
}, options?: {
    secureTransport?: 'off' | 'on';
    allowHalfOpen?: boolean;
}) => WorkerSocket;
/** The parts of a Workers (server-side) WebSocket the bridge uses. */
export interface WorkerWebSocket {
    accept(): void;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: 'message' | 'close' | 'error', listener: (event: any) => void): void;
}
export interface WorkerBridgeOptions extends BridgeBaseOptions {
    /** `connect` from 'cloudflare:sockets'. */
    connect: WorkerConnect;
    /** Default: the Workers global WebSocketPair. */
    WebSocketPair?: new () => {
        0: WorkerWebSocket;
        1: WorkerWebSocket;
    };
    /** Builds the 101 response; default `new Response(null, { status: 101, webSocket: client })`. */
    upgradeResponse?: (client: WorkerWebSocket) => Response;
    /** Default 30 s. */
    connectTimeoutMs?: number;
}
/** A `fetch(request)` handler that bridges WebSocket clients to allowlisted pools. */
export declare function createWorkerBridge(options: WorkerBridgeOptions): {
    fetch(request: Request): Promise<Response>;
};
