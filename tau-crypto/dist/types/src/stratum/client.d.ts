import type { ShareResult, StratumClient, StratumEvents, StratumOptions, TransportFactory } from '../types.ts';
export declare const DEFAULT_USER_AGENT = "tau-crypto/0.1.0";
/** Longest line accepted from a pool or the bridge; longer ones drop the connection. */
export declare const MAX_LINE_BYTES: number;
export type StratumScheme = 'stratum+tcp' | 'stratum+ssl' | 'stratum+tcps';
export interface StratumUrl {
    scheme: StratumScheme;
    /** Host name or IP address (IPv6 without brackets). */
    host: string;
    port: number;
    tls: boolean;
}
/**
 * Parses a pool URL: stratum+tcp://host:port, or stratum+ssl:// / stratum+tcps://
 * for TLS. A bare host:port means stratum+tcp. Credentials and paths are ignored.
 */
export declare function parseStratumUrl(url: string): StratumUrl;
/** host:port with IPv6 hosts in brackets (also the bridge's `target` syntax). */
export declare function formatHostPort(host: string, port: number): string;
export declare function formatStratumUrl(url: Pick<StratumUrl, 'scheme' | 'host' | 'port'>): string;
/** Splits a byte stream into lines on '\n'; a trailing '\r' and blank lines are dropped. */
export declare class LineDecoder {
    private readonly maxBytes;
    private readonly decoder;
    private parts;
    private size;
    constructor(maxBytes?: number);
    /** Lines completed by `chunk`. Throws a RangeError once a line exceeds the limit. */
    push(chunk: Uint8Array): string[];
    private append;
    private take;
}
export interface StratumTuning {
    /** A share without a verdict after this long resolves as rejected with reason 'timeout' (default 60 s). */
    shareTimeoutMs?: number;
    /** Limit for each subscribe/authorize reply (default 30 s, as upstream's subscribe). */
    requestTimeoutMs?: number;
    /** Stop waiting for the extranonce.subscribe reply after this long (default 3 s, as upstream). */
    extranonceTimeoutMs?: number;
    /** Connect timeout of the default transports (default 30 s, as upstream). */
    connectTimeoutMs?: number;
}
export type StratumClientOptions = StratumOptions & StratumTuning;
/**
 * The stratum client. Per connection the events run: `subscribed`, then any
 * `difficulty`/`job`/`extranonce` (methods that arrive before the subscribe
 * reply are held back until after it), `authorized`, and finally
 * `disconnected` once a subscribed connection ends (except after close()).
 */
export declare class StratumClientImpl implements StratumClient {
    private readonly factory;
    private readonly user;
    private readonly pass;
    private readonly agent;
    private readonly retryPauseMs;
    private readonly timeoutMs;
    private readonly shareTimeoutMs;
    private readonly requestTimeoutMs;
    private readonly extranonceTimeoutMs;
    private readonly events;
    /** The configured pool. Targets of client.reconnect last until a connection fails. */
    private readonly homeUrl;
    private url;
    private closed;
    private phase;
    /** Bumped whenever a connection starts or ends; callbacks of older ones compare and bail. */
    private gen;
    private transport;
    private sessionId;
    private retriedSubscribe;
    /** `subscribed` was emitted for the current connection. */
    private subscribed;
    private early;
    private extranoncePending;
    private readonly shares;
    private nextShareId;
    private firstConnect;
    private waiter;
    private silenceTimer;
    private requestTimer;
    private extranonceTimer;
    private retryTimer;
    constructor(options: StratumClientOptions & {
        transport: TransportFactory;
    });
    get connected(): boolean;
    on<K extends keyof StratumEvents>(event: K, listener: (value: StratumEvents[K]) => void): () => void;
    connect(): Promise<void>;
    close(): void;
    submit(request: string): Promise<ShareResult>;
    /** Starts a connection attempt to this.url. */
    private open;
    private opened;
    private subscribe;
    private request;
    private clearRequestTimer;
    /** Reconnects after this much silence, as upstream's stratum_socket_full(opt_timeout). */
    private resetSilence;
    /** Ends the current connection, failing its pending shares. */
    private drop;
    /** The connection attempt failed, or an established connection went away. */
    private lost;
    /** Fixed pause between attempts, no backoff (upstream opt_fail_pause). */
    private scheduleRetry;
    private receive;
    private response;
    private subscribeReply;
    private authorizeReply;
    /** Optional; the reply is matched by id whenever it comes, without holding anything up. */
    private extranonceSubscribe;
    private extranonceReply;
    /** Server requests and notifications (upstream stratum_handle_method). */
    private method;
    /** client.reconnect [host, port]: switch now, keeping the scheme. */
    private redirect;
    private send;
    private failShares;
    private emit;
    private log;
    /** Our own handlers never throw into a transport; failures become `error` events. */
    private guard;
}
