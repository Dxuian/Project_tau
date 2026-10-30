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
}
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
