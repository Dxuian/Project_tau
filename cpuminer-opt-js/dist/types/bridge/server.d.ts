export interface BridgeOptions {
    /** Port to listen on; 0 picks a free one. */
    port: number;
    /** Address to bind; default all interfaces. */
    host?: string;
    /** Pools that may be reached, as host:port. A connection's `target` must match one. */
    allow: string[];
    /** If set, the Origin header must be one of these (e.g. https://example.com). */
    origins?: string[];
    /** Simultaneous connections (default 256); further ones get HTTP 503. */
    maxConnections?: number;
    /** Accept any certificate from pools reached with tls=1. Default false. */
    tlsInsecure?: boolean;
    log?: (line: string) => void;
    /**
     * Called for each connection after the target and origin checks; the returned
     * interceptor sees (and may rewrite or drop) every stratum line in both
     * directions. Returning null refuses the connection with 403. Without it, the
     * bridge relays messages unchanged.
     */
    intercept?: (connection: BridgeConnection) => BridgeInterceptor | null;
}
/** One WebSocket connection, as seen by an interceptor. */
export interface BridgeConnection {
    /** Unique per bridge, increasing. */
    id: number;
    /** The client's address and port. */
    peer: string;
    /** The pool, as host:port. */
    target: string;
    tls: boolean;
    origin: string | null;
    /** Query parameters of the WebSocket URL. */
    query: URLSearchParams;
    /** Sends one line to the client (ignored before it is connected or once it is closing). */
    reply(line: string): void;
    /** Closes the WebSocket (code 1008) and the pool connection. */
    close(reason?: string): void;
}
/**
 * Each method gets one line without its newline and returns the line to pass on,
 * or null to drop it. A throw closes the connection.
 */
export interface BridgeInterceptor {
    fromClient?(line: string): string | null;
    fromPool?(line: string): string | null;
    /** The connection has ended (called once). */
    onClose?(): void;
}
/** Optional capabilities of this bridge, for callers that depend on them. */
export declare const BRIDGE_FEATURES: readonly string[];
export interface Bridge {
    /** The port actually bound. */
    port: number;
    /** Stops listening and closes every connection. */
    close(): Promise<void>;
}
export declare function createBridge(options: BridgeOptions): Promise<Bridge>;
export declare const BRIDGE_USAGE = "usage: cpuminer-js bridge --listen [host:]port --allow host:port[,host:port...]\n                          [--origin https://a,https://b] [--max-connections N] [--tls-insecure]\n\n  --listen           where to accept WebSocket connections (all interfaces unless a host is given)\n  --allow            pools that may be reached; browsers connect with ?target=host:port&tls=0|1\n  --origin           only accept pages from these origins (checks the Origin header)\n  --max-connections  simultaneous connections (default 256)\n  --tls-insecure     accept any certificate from TLS pools";
/** Parses bridge CLI arguments (with or without the leading "bridge"); null means --help. */
export declare function parseBridgeArgs(argv: string[]): BridgeOptions | null;
/** `cpuminer-js bridge ...`: runs until SIGINT/SIGTERM. Throws on invalid arguments. */
export declare function runBridgeCli(argv: string[]): Promise<void>;
