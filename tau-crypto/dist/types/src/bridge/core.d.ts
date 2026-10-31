export declare const MAX_MESSAGE_BYTES: number;
/** Lines queued behind a slow (async) interceptor before the connection is failed. */
export declare const MAX_PENDING_LINES = 1000;
/** Optional capabilities of this bridge, for callers that depend on them. */
export declare const BRIDGE_FEATURES: readonly string[];
/** One WebSocket connection, as seen by an interceptor. */
export interface BridgeConnection {
    /** Unique per bridge, increasing. */
    id: number;
    /** The client's address (and port, where known). */
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
 * Each method gets one line without its newline and returns (or resolves to)
 * the line to pass on, or null to drop it. Lines are handled one at a time in
 * order per direction, so a method may await (e.g. a database write) before a
 * line is forwarded. A throw or rejection closes the connection.
 */
export interface BridgeInterceptor {
    fromClient?(line: string): string | null | Promise<string | null>;
    fromPool?(line: string): string | null | Promise<string | null>;
    /** The connection has ended (called once). */
    onClose?(): void;
}
export interface BridgeBaseOptions {
    /** Pools that may be reached, as host:port. A connection's `target` must match one. */
    allow: string[];
    /** If set, the Origin header must be one of these (e.g. https://example.com). */
    origins?: string[];
    /** Simultaneous connections (default 256); further ones get HTTP 503. */
    maxConnections?: number;
    log?: (line: string) => void;
    /**
     * Called for each connection after the target and origin checks; the returned
     * interceptor sees (and may rewrite or drop) every stratum line in both
     * directions. Returning null refuses the connection with 403. Without it, the
     * bridge relays messages unchanged.
     */
    intercept?: (connection: BridgeConnection) => BridgeInterceptor | null;
}
/** host:port (or [v6]:port) with a lower-case host, or null. */
export declare function parseTarget(text: string | null | undefined): {
    host: string;
    port: number;
} | null;
/** host:port of a pool URL (stratum+tcp://host:port), as an `allow` entry. */
export declare function poolTarget(url: string): string;
export type Allowlist = Map<string, {
    host: string;
    port: number;
}>;
export declare function buildAllowlist(entries: string[]): Allowlist;
/** The pool a connection asks for (`?target=host:port&tls=0|1`), if allowed. */
export declare function requestedTarget(query: URLSearchParams, allow: Allowlist): {
    target: {
        host: string;
        port: number;
    };
    tls: boolean;
} | {
    status: number;
    why: string;
};
/**
 * Runs lines through an interceptor method one at a time, in order, and hands
 * non-null results to `deliver`. Errors (and multi-line results) go to `fail`
 * once; after close() everything is dropped.
 */
export declare class LinePipe {
    private readonly fn;
    private readonly deliver;
    private readonly fail;
    private queue;
    private running;
    private closed;
    constructor(fn: (line: string) => string | null | Promise<string | null>, deliver: (line: string) => void, fail: (err: Error) => void);
    push(line: string): void;
    close(): void;
    private error;
    private drain;
}
