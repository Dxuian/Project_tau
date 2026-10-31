import { type BridgeBaseOptions } from './core.ts';
export { BRIDGE_FEATURES } from './core.ts';
export type { BridgeConnection, BridgeInterceptor } from './core.ts';
export interface BridgeOptions extends BridgeBaseOptions {
    /** Port to listen on; 0 picks a free one. Not used with `server`. */
    port?: number;
    /** Address to bind; default all interfaces. */
    host?: string;
    /** Accept any certificate from pools reached with tls=1. Default false. */
    tlsInsecure?: boolean;
    /**
     * An existing node:http (or https) server to handle WebSocket upgrades on,
     * instead of listening on `port`: the app keeps its own routes on it.
     */
    server?: any;
}
export interface Bridge {
    /** The port actually bound. */
    port: number;
    /** Stops listening and closes every connection. */
    close(): Promise<void>;
}
export declare function createBridge(options: BridgeOptions): Promise<Bridge>;
export declare const BRIDGE_USAGE = "usage: tau-crypto bridge --listen [host:]port --allow host:port[,host:port...]\n                          [--origin https://a,https://b] [--max-connections N] [--tls-insecure]\n\n  --listen           where to accept WebSocket connections (all interfaces unless a host is given)\n  --allow            pools that may be reached; browsers connect with ?target=host:port&tls=0|1\n  --origin           only accept pages from these origins (checks the Origin header)\n  --max-connections  simultaneous connections (default 256)\n  --tls-insecure     accept any certificate from TLS pools";
/** Parses bridge CLI arguments (with or without the leading "bridge"); null means --help. */
export declare function parseBridgeArgs(argv: string[]): BridgeOptions | null;
/** `tau-crypto bridge ...`: runs until SIGINT/SIGTERM. Throws on invalid arguments. */
export declare function runBridgeCli(argv: string[]): Promise<void>;
