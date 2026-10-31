// Shared by the Node bridge (server.ts) and the Cloudflare Workers bridge
// (worker.ts): the allowlist, the interceptor contract and in-order line
// processing.
import { MAX_LINE_BYTES, formatHostPort } from '../src/stratum/client.ts';

export const MAX_MESSAGE_BYTES = MAX_LINE_BYTES;
/** Lines queued behind a slow (async) interceptor before the connection is failed. */
export const MAX_PENDING_LINES = 1000;

/** Optional capabilities of this bridge, for callers that depend on them. */
export const BRIDGE_FEATURES: readonly string[] = Object.freeze(['intercept', 'async-intercept', 'worker']);

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
export function parseTarget(text: string | null | undefined): { host: string; port: number } | null {
  const value = String(text ?? '').trim();
  const m = /^\[([0-9a-f:.]+)\]:(\d{1,5})$/i.exec(value) ?? /^([a-z0-9._-]+):(\d{1,5})$/i.exec(value);
  const port = m ? Number(m[2]) : 0;
  return m && port >= 1 && port <= 65535 ? { host: m[1].toLowerCase(), port } : null;
}

export type Allowlist = Map<string, { host: string; port: number }>;

export function buildAllowlist(entries: string[]): Allowlist {
  const allow: Allowlist = new Map();
  for (const entry of entries ?? []) {
    const target = parseTarget(entry);
    if (!target) throw new Error(`invalid allowed pool "${entry}": expected host:port`);
    allow.set(formatHostPort(target.host, target.port), target);
  }
  if (!allow.size) throw new Error('the bridge needs at least one allowed pool (host:port)');
  return allow;
}

/** The pool a connection asks for (`?target=host:port&tls=0|1`), if allowed. */
export function requestedTarget(
  query: URLSearchParams,
  allow: Allowlist,
): { target: { host: string; port: number }; tls: boolean } | { status: number; why: string } {
  // Only exact allowlist entries: the bridge must never become an open proxy.
  const requested = parseTarget(query.get('target'));
  const target = requested && allow.get(formatHostPort(requested.host, requested.port));
  if (!target) return { status: 403, why: 'target not allowed' };
  const tls = query.get('tls') ?? '0';
  if (tls !== '0' && tls !== '1') return { status: 400, why: 'tls must be 0 or 1' };
  return { target, tls: tls === '1' };
}

/**
 * Runs lines through an interceptor method one at a time, in order, and hands
 * non-null results to `deliver`. Errors (and multi-line results) go to `fail`
 * once; after close() everything is dropped.
 */
export class LinePipe {
  private readonly fn: (line: string) => string | null | Promise<string | null>;
  private readonly deliver: (line: string) => void;
  private readonly fail: (err: Error) => void;
  private queue: string[] = [];
  private running = false;
  private closed = false;

  constructor(
    fn: (line: string) => string | null | Promise<string | null>,
    deliver: (line: string) => void,
    fail: (err: Error) => void,
  ) {
    this.fn = fn;
    this.deliver = deliver;
    this.fail = fail;
  }

  push(line: string): void {
    if (this.closed) return;
    if (this.queue.length >= MAX_PENDING_LINES) return this.error(new Error('too many lines waiting for the interceptor'));
    this.queue.push(line);
    if (!this.running) void this.drain();
  }

  close(): void {
    this.closed = true;
    this.queue = [];
  }

  private error(err: Error): void {
    if (this.closed) return;
    this.close();
    this.fail(err);
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length && !this.closed) {
        const line = this.queue.shift() as string;
        let out: string | null;
        try {
          out = await this.fn(line);
        } catch (err) {
          return this.error(err instanceof Error ? err : new Error(String(err)));
        }
        if (this.closed) return;
        if (out === null || out === undefined) continue;
        if (typeof out !== 'string' || /[\r\n]/.test(out)) return this.error(new Error('interceptor returned more than one line'));
        this.deliver(out);
      }
    } finally {
      this.running = false;
    }
  }
}
