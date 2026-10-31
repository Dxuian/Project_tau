// Stratum v1 client, independent of the transport: the subscribe/authorize
// handshake, server methods, share submission and automatic reconnects of
// cpuminer-opt (util.c stratum_*, cpu-miner.c stratum_thread). Unlike upstream,
// replies are matched by id and the credentials are JSON-escaped.
import { Emitter } from '../util/emitter.ts';
import type {
  ShareResult,
  StratumClient,
  StratumEvents,
  StratumOptions,
  Transport,
  TransportFactory,
} from '../types.ts';

export const DEFAULT_USER_AGENT = 'tau-crypto/0.1.0';
/** Longest line accepted from a pool or the bridge; longer ones drop the connection. */
export const MAX_LINE_BYTES = 1 << 20;

// -------------------------------------------------------------------- URLs

export type StratumScheme = 'stratum+tcp' | 'stratum+ssl' | 'stratum+tcps';

export interface StratumUrl {
  scheme: StratumScheme;
  /** Host name or IP address (IPv6 without brackets). */
  host: string;
  port: number;
  tls: boolean;
}

const SCHEMES = new Map<string, boolean>([
  ['stratum+tcp', false],
  ['stratum+ssl', true],
  ['stratum+tcps', true],
]);

/**
 * Parses a pool URL: stratum+tcp://host:port, or stratum+ssl:// / stratum+tcps://
 * for TLS. A bare host:port means stratum+tcp. Credentials and paths are ignored.
 */
export function parseStratumUrl(url: string): StratumUrl {
  const text = String(url).trim();
  const sep = text.indexOf('://');
  const scheme = sep < 0 ? 'stratum+tcp' : text.slice(0, sep).toLowerCase();
  const tls = SCHEMES.get(scheme);
  if (tls === undefined) {
    throw new Error(`unsupported pool URL "${url}": use stratum+tcp://, stratum+ssl:// or stratum+tcps://`);
  }
  let authority = (sep < 0 ? text : text.slice(sep + 3)).replace(/[/?#].*$/s, '');
  authority = authority.slice(authority.lastIndexOf('@') + 1);
  const m =
    /^\[([0-9a-f:.]+(?:%[\w.-]+)?)\]:(\d{1,5})$/i.exec(authority) ?? /^([\p{L}\p{N}._-]+):(\d{1,5})$/u.exec(authority);
  const port = m ? Number(m[2]) : 0;
  if (!m || port < 1 || port > 65535) throw new Error(`invalid pool URL "${url}": expected ${scheme}://host:port`);
  return { scheme: scheme as StratumScheme, host: m[1], port, tls };
}

/** host:port with IPv6 hosts in brackets (also the bridge's `target` syntax). */
export function formatHostPort(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export function formatStratumUrl(url: Pick<StratumUrl, 'scheme' | 'host' | 'port'>): string {
  return `${url.scheme}://${formatHostPort(url.host, url.port)}`;
}

// ------------------------------------------------------------------- lines

/** Splits a byte stream into lines on '\n'; a trailing '\r' and blank lines are dropped. */
export class LineDecoder {
  private readonly maxBytes: number;
  private readonly decoder = new TextDecoder();
  private parts: Uint8Array[] = [];
  private size = 0;

  constructor(maxBytes = MAX_LINE_BYTES) {
    this.maxBytes = maxBytes;
  }

  /** Lines completed by `chunk`. Throws a RangeError once a line exceeds the limit. */
  push(chunk: Uint8Array): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let nl = chunk.indexOf(10); nl >= 0; nl = chunk.indexOf(10, start)) {
      this.append(chunk.subarray(start, nl));
      const line = this.take();
      if (line.trim()) lines.push(line);
      start = nl + 1;
    }
    // Copy the tail so a large socket chunk isn't kept alive by a partial line.
    if (start < chunk.length) this.append(new Uint8Array(chunk.subarray(start)));
    return lines;
  }

  private append(bytes: Uint8Array): void {
    if (this.size + bytes.length > this.maxBytes) {
      this.parts = [];
      this.size = 0;
      throw new RangeError(`line longer than ${this.maxBytes} bytes`);
    }
    if (!bytes.length) return;
    this.parts.push(bytes);
    this.size += bytes.length;
  }

  private take(): string {
    let bytes = this.parts.length === 1 ? this.parts[0] : new Uint8Array(this.size);
    if (this.parts.length > 1) {
      let offset = 0;
      for (const part of this.parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
    }
    this.parts = [];
    this.size = 0;
    if (bytes.length && bytes[bytes.length - 1] === 13) bytes = bytes.subarray(0, bytes.length - 1);
    return bytes.length ? this.decoder.decode(bytes) : '';
  }
}

// ------------------------------------------------------------------ client

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

type Timer = ReturnType<typeof setTimeout>;
type Phase = 'idle' | 'connecting' | 'subscribing' | 'authorizing' | 'ready' | 'waiting';
// Emitter needs an object type; interfaces have no index signature.
type EventMap = { [K in keyof StratumEvents]: StratumEvents[K] };

/** A JSON-RPC request, notification or reply. */
interface Message {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingShare {
  resolve: (result: ShareResult) => void;
  timer: Timer;
}

const MAX_DELAY_MS = 2 ** 31 - 1; // setTimeout's limit
const MAX_EARLY = 256; // server methods buffered while subscribing

/**
 * The stratum client. Per connection the events run: `subscribed`, then any
 * `difficulty`/`job`/`extranonce` (methods that arrive before the subscribe
 * reply are held back until after it), `authorized`, and finally
 * `disconnected` once a subscribed connection ends (except after close()).
 */
export class StratumClientImpl implements StratumClient {
  private readonly factory: TransportFactory;
  private readonly user: string;
  private readonly pass: string;
  private readonly agent: string;
  private readonly retryPauseMs: number;
  private readonly timeoutMs: number;
  private readonly shareTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly extranonceTimeoutMs: number;
  private readonly events = new Emitter<EventMap>();
  /** The configured pool. Targets of client.reconnect last until a connection fails. */
  private readonly homeUrl: string;
  private url: string;

  private closed = false;
  private phase: Phase = 'idle';
  /** Bumped whenever a connection starts or ends; callbacks of older ones compare and bail. */
  private gen = 0;
  private transport: Transport | null = null;
  private sessionId: string | null = null;
  private retriedSubscribe = false;
  /** `subscribed` was emitted for the current connection. */
  private subscribed = false;
  private early: Message[] = [];
  private extranoncePending = false;
  private readonly shares = new Map<number, PendingShare>();
  private nextShareId = 4; // ids 1-3 are subscribe, authorize and extranonce.subscribe
  private firstConnect: Promise<void> | null = null;
  private waiter: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private silenceTimer: Timer | null = null;
  private requestTimer: Timer | null = null;
  private extranonceTimer: Timer | null = null;
  private retryTimer: Timer | null = null;

  constructor(options: StratumClientOptions & { transport: TransportFactory }) {
    this.homeUrl = this.url = formatStratumUrl(parseStratumUrl(options.url));
    this.factory = options.transport;
    this.user = String(options.user ?? '');
    this.pass = String(options.pass ?? '');
    this.agent = options.userAgent || DEFAULT_USER_AGENT;
    this.retryPauseMs = delay(options.retryPauseMs, 10_000, true);
    this.timeoutMs = delay(options.timeoutMs, 300_000);
    this.shareTimeoutMs = delay(options.shareTimeoutMs, 60_000);
    this.requestTimeoutMs = delay(options.requestTimeoutMs, 30_000);
    this.extranonceTimeoutMs = delay(options.extranonceTimeoutMs, 3_000);
  }

  get connected(): boolean {
    return this.phase === 'ready';
  }

  on<K extends keyof StratumEvents>(event: K, listener: (value: StratumEvents[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('stratum client is closed'));
    if (this.firstConnect) return this.firstConnect;
    const connecting = new Promise<void>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
    this.firstConnect = connecting;
    this.open(); // may already have failed (and cleared firstConnect) when it returns
    return connecting;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true; // silences every event from here on
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.drop();
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(new Error('stratum client closed'));
    this.events.removeAll();
  }

  submit(request: string): Promise<ShareResult> {
    let message: Message;
    try {
      message = JSON.parse(request);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('not an object');
    } catch {
      this.emit('error', new Error(`invalid share request: ${clip(String(request))}`));
      return Promise.resolve(rejected('invalid request'));
    }
    if (this.closed) return Promise.resolve(rejected('closed'));
    // Pools handle requests in order, so a share may follow mining.authorize before its reply.
    if (this.phase !== 'authorizing' && this.phase !== 'ready') return Promise.resolve(rejected('disconnected'));
    const id = this.nextShareId++;
    message.id = id;
    return new Promise<ShareResult>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.shares.delete(id)) return;
        this.log(`no verdict for share ${id} within ${seconds(this.shareTimeoutMs)}`);
        resolve(rejected('timeout'));
      }, this.shareTimeoutMs);
      this.shares.set(id, { resolve, timer });
      this.send(message);
    });
  }

  // ------------------------------------------------------------ connection

  /** Starts a connection attempt to this.url. */
  private open(): void {
    const gen = ++this.gen;
    const url = this.url;
    this.phase = 'connecting';
    this.subscribed = false;
    this.retriedSubscribe = false;
    this.early = [];
    this.log(`connecting to ${url}`);
    let opened: Promise<void>;
    try {
      const transport = this.factory(url);
      transport.onLine = (line) => {
        if (gen === this.gen) this.guard(() => this.receive(line));
      };
      transport.onClose = (error) => {
        if (gen === this.gen) this.guard(() => this.lost(error ?? new Error('connection closed by the pool')));
      };
      this.transport = transport;
      opened = Promise.resolve(transport.connect());
    } catch (err) {
      opened = Promise.reject(err);
    }
    opened.then(
      () => {
        if (gen === this.gen) this.guard(() => this.opened());
      },
      (err) => {
        if (gen === this.gen) this.guard(() => this.lost(asError(err)));
      },
    );
  }

  private opened(): void {
    this.phase = 'subscribing';
    this.log(`connected to ${this.url}`);
    this.resetSilence();
    this.subscribe();
  }

  private subscribe(): void {
    // Resume the previous session if there was one; the retry sends no parameters (as upstream).
    const params = this.retriedSubscribe ? [] : this.sessionId ? [this.agent, this.sessionId] : [this.agent];
    this.request(1, 'mining.subscribe', params);
  }

  private request(id: number, method: string, params: unknown[]): void {
    const gen = this.gen;
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = setTimeout(() => {
      this.requestTimer = null;
      if (gen === this.gen) {
        this.guard(() => this.lost(new Error(`no reply to ${method} within ${seconds(this.requestTimeoutMs)}`)));
      }
    }, this.requestTimeoutMs);
    this.send({ id, method, params });
  }

  private clearRequestTimer(): void {
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = null;
  }

  /** Reconnects after this much silence, as upstream's stratum_socket_full(opt_timeout). */
  private resetSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    const gen = this.gen;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (gen === this.gen) {
        this.guard(() => this.lost(new Error(`no data from the pool for ${seconds(this.timeoutMs)}`)));
      }
    }, this.timeoutMs);
  }

  /** Ends the current connection, failing its pending shares. */
  private drop(error?: Error): void {
    this.gen++;
    const transport = this.transport;
    this.transport = null;
    if (transport) {
      transport.onLine = null;
      transport.onClose = null;
      try {
        transport.close();
      } catch {
        // already gone
      }
    }
    for (const timer of [this.silenceTimer, this.requestTimer, this.extranonceTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.silenceTimer = this.requestTimer = this.extranonceTimer = null;
    this.extranoncePending = false;
    this.early = [];
    this.phase = 'idle';
    this.failShares(this.closed ? 'closed' : 'disconnected');
    if (this.subscribed) {
      this.subscribed = false;
      this.emit('disconnected', error ? { error } : {});
    }
  }

  /** The connection attempt failed, or an established connection went away. */
  private lost(error: Error): void {
    const url = this.url;
    const established = this.phase === 'ready';
    this.drop(error);
    if (this.closed) return;
    if (this.waiter) {
      // The first connect leaves retrying to the caller.
      const waiter = this.waiter;
      this.waiter = null;
      this.firstConnect = null;
      this.url = this.homeUrl;
      this.log(`connection to ${url} failed: ${error.message}`);
      waiter.reject(error);
      return;
    }
    this.log(`connection to ${url} ${established ? 'lost' : 'failed'}: ${error.message}`);
    if (this.url !== this.homeUrl) {
      this.url = this.homeUrl;
      this.log(`switching back to ${this.homeUrl}`);
    }
    this.scheduleRetry();
  }

  /** Fixed pause between attempts, no backoff (upstream opt_fail_pause). */
  private scheduleRetry(): void {
    const delayMs = this.retryPauseMs;
    this.phase = 'waiting';
    this.log(`retrying in ${seconds(delayMs)}`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed || this.phase !== 'waiting') return;
      this.emit('reconnecting', { url: this.url, delayMs });
      if (!this.closed && this.phase === 'waiting') this.open();
    }, delayMs);
  }

  // -------------------------------------------------------------- messages

  private receive(line: string): void {
    this.resetSilence();
    const text = line.trim();
    if (!text) return;
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      this.log(`ignoring invalid JSON from the pool: ${clip(text)}`);
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this.log(`ignoring unexpected message from the pool: ${clip(text)}`);
      return;
    }
    const m = message as Message;
    if (typeof m.method !== 'string') {
      this.response(m);
    } else if (this.phase === 'connecting' || this.phase === 'subscribing') {
      // Jobs and difficulty need the subscription; replay them right after it.
      if (this.early.length < MAX_EARLY) this.early.push(m);
      else this.log(`dropping ${m.method} received before the subscribe reply`);
    } else {
      this.method(m);
    }
  }

  private response(m: Message): void {
    const id = typeof m.id === 'number' ? m.id : typeof m.id === 'string' && /^\d+$/.test(m.id) ? Number(m.id) : null;
    const share = id === null ? undefined : this.shares.get(id);
    if (share) {
      this.shares.delete(id!);
      clearTimeout(share.timer);
      share.resolve(verdict(m));
    } else if (id === 1 && this.phase === 'subscribing') {
      this.subscribeReply(m);
    } else if (id === 2 && this.phase === 'authorizing') {
      this.authorizeReply(m);
    } else if (id === 3 && this.extranoncePending) {
      this.extranonceReply(m);
    } else {
      this.log(`ignoring unexpected reply: ${clip(JSON.stringify(m))}`);
    }
  }

  private subscribeReply(m: Message): void {
    this.clearRequestTimer();
    const result = hasError(m.error) ? null : parseSubscribeResult(m.result);
    if (!result) {
      const why = hasError(m.error)
        ? errorText(m.error)
        : `unexpected result ${clip(JSON.stringify(m.result ?? null))}`;
      if (this.retriedSubscribe) {
        this.lost(new Error(`mining.subscribe failed: ${why}`));
      } else {
        this.retriedSubscribe = true;
        this.log(`mining.subscribe failed (${why}), retrying without parameters`);
        this.subscribe();
      }
      return;
    }
    const gen = this.gen;
    this.sessionId = result.sessionId;
    this.phase = 'authorizing';
    this.request(2, 'mining.authorize', [this.user, this.pass]);
    if (gen !== this.gen) return; // the send failed
    this.subscribed = true;
    const session = result.sessionId === null ? '' : `, session ${result.sessionId}`;
    this.log(`subscribed: extranonce1 ${result.xnonce1}, extranonce2 size ${result.xnonce2Size}${session}`);
    this.emit('subscribed', result);
    for (const early of this.early.splice(0)) {
      if (gen !== this.gen) break;
      this.method(early);
    }
  }

  private authorizeReply(m: Message): void {
    this.clearRequestTimer();
    if (m.result === undefined || m.result === false || hasError(m.error)) {
      this.lost(new Error(`authorization failed${hasError(m.error) ? `: ${errorText(m.error)}` : ''}`));
      return;
    }
    const gen = this.gen;
    this.phase = 'ready';
    this.log('authorized');
    this.emit('authorized', { user: this.user });
    if (gen !== this.gen) return;
    this.extranonceSubscribe();
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.resolve();
  }

  /** Optional; the reply is matched by id whenever it comes, without holding anything up. */
  private extranonceSubscribe(): void {
    const gen = this.gen;
    this.extranoncePending = true;
    this.extranonceTimer = setTimeout(() => {
      this.extranonceTimer = null;
      if (gen !== this.gen || !this.extranoncePending) return;
      this.extranoncePending = false;
      this.log(`no reply to mining.extranonce.subscribe within ${seconds(this.extranonceTimeoutMs)}, carrying on`);
    }, this.extranonceTimeoutMs);
    this.send({ id: 3, method: 'mining.extranonce.subscribe', params: [] });
  }

  private extranonceReply(m: Message): void {
    this.extranoncePending = false;
    if (this.extranonceTimer) clearTimeout(this.extranonceTimer);
    this.extranonceTimer = null;
    if (m.result === true && !hasError(m.error)) this.log('subscribed to extranonce changes');
    else this.log(`pool declined mining.extranonce.subscribe${hasError(m.error) ? ` (${errorText(m.error)})` : ''}`);
  }

  /** Server requests and notifications (upstream stratum_handle_method). */
  private method(m: Message): void {
    const name = m.method as string;
    const params = Array.isArray(m.params) ? m.params : [];
    const id = m.id ?? null;
    switch (name.toLowerCase()) {
      case 'mining.notify':
        if (Array.isArray(m.params)) this.emit('job', m.params);
        else this.log('ignoring mining.notify without params');
        break;
      case 'mining.set_difficulty': {
        const diff = params[0];
        if (typeof diff === 'number' && Number.isFinite(diff) && diff > 0) this.emit('difficulty', diff);
        else this.log(`ignoring mining.set_difficulty ${clip(JSON.stringify(m.params ?? null))}`);
        break;
      }
      case 'mining.set_extranonce': {
        const extranonce = parseExtranonce(params[0], params[1]);
        if (extranonce) {
          this.log(`extranonce1 ${extranonce.xnonce1}, extranonce2 size ${extranonce.xnonce2Size}`);
          this.emit('extranonce', extranonce);
        } else {
          this.log(`ignoring mining.set_extranonce ${clip(JSON.stringify(m.params ?? null))}`);
        }
        break;
      }
      case 'client.reconnect':
        this.redirect(params);
        break;
      case 'client.get_version':
        if (id !== null) this.send({ id, result: this.agent, error: null });
        break;
      case 'client.show_message':
        if (params[0] != null) {
          const text = typeof params[0] === 'string' ? params[0] : JSON.stringify(params[0]);
          this.log(`message from the pool: ${text}`);
          this.emit('message', text);
        }
        if (id !== null) this.send({ id, result: true, error: null });
        break;
      case 'mining.ping':
        if (id !== null) this.send({ id, result: 'pong', error: null });
        break;
      default:
        this.log(`unknown stratum method ${clip(name)}`);
        if (id !== null) this.send({ id, result: false, error: { code: 38, message: 'unknown method' } });
    }
  }

  /** client.reconnect [host, port]: switch now, keeping the scheme. */
  private redirect(params: unknown[]): void {
    if (!params.length) {
      this.log('ignoring client.reconnect without a target');
      return;
    }
    const [host, rawPort] = params;
    // The port may come as a number or a string (upstream atoi).
    const port = typeof rawPort === 'string' && /^\s*\d+\s*$/.test(rawPort) ? Number(rawPort) : rawPort;
    let url: string;
    try {
      if (typeof host !== 'string' || typeof port !== 'number' || !Number.isInteger(port)) throw new TypeError();
      const { scheme } = parseStratumUrl(this.url);
      const target = formatStratumUrl({ scheme, host: host.trim().replace(/^\[(.*)\]$/, '$1'), port });
      url = formatStratumUrl(parseStratumUrl(target)); // validates host and port
    } catch {
      this.log(`ignoring client.reconnect ${clip(JSON.stringify(params))}`);
      return;
    }
    this.log(`pool requested reconnection to ${url}`);
    this.drop();
    if (this.closed) return;
    this.url = url;
    this.emit('reconnecting', { url, delayMs: 0 });
    if (!this.closed && this.phase === 'idle') this.open();
  }

  // --------------------------------------------------------------- helpers

  private send(message: object): void {
    const transport = this.transport;
    if (!transport) return;
    try {
      transport.send(JSON.stringify(message));
    } catch (err) {
      this.lost(asError(err));
    }
  }

  private failShares(reason: string): void {
    for (const share of this.shares.values()) {
      clearTimeout(share.timer);
      share.resolve(rejected(reason));
    }
    this.shares.clear();
  }

  private emit<K extends keyof StratumEvents>(event: K, value: StratumEvents[K]): void {
    if (!this.closed) this.events.emit(event, value);
  }

  private log(text: string): void {
    this.emit('log', text);
  }

  /** Our own handlers never throw into a transport; failures become `error` events. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.emit('error', asError(err));
    }
  }
}

// ------------------------------------------------------------------ parsing

function parseExtranonce(xnonce1: unknown, size: unknown): { xnonce1: string; xnonce2Size: number } | null {
  if (typeof xnonce1 !== 'string' || !/^(?:[0-9a-f]{2})*$/i.test(xnonce1)) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 2 || size > 16) return null;
  return { xnonce1, xnonce2Size: size };
}

/** [subscriptions, extranonce1, extranonce2_size]; the session id is the mining.notify subscription's. */
function parseSubscribeResult(result: unknown): StratumEvents['subscribed'] | null {
  if (!Array.isArray(result)) return null;
  const extranonce = parseExtranonce(result[1], result[2]);
  return extranonce && { ...extranonce, sessionId: sessionIdOf(result[0]) };
}

function sessionIdOf(subscriptions: unknown): string | null {
  if (!Array.isArray(subscriptions)) return null;
  // Either a list of [method, id] pairs or a single pair.
  const pairs = typeof subscriptions[0] === 'string' ? [subscriptions] : subscriptions;
  for (const pair of pairs) {
    if (!Array.isArray(pair)) break;
    if (typeof pair[0] === 'string' && pair[0].toLowerCase() === 'mining.notify') {
      return typeof pair[1] === 'string' ? pair[1] : null;
    }
  }
  return null;
}

const hasError = (error: unknown): boolean => error !== null && error !== undefined && error !== false;

/** Pool error as text: [code, message, ...] gives message, {message} gives message. */
function errorText(error: unknown): string | null {
  if (!hasError(error)) return null;
  if (Array.isArray(error)) return error[1] != null ? String(error[1]) : JSON.stringify(error);
  if (typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    return message != null ? String(message) : JSON.stringify(error);
  }
  return String(error);
}

function verdict(m: Message): ShareResult {
  const accepted = m.result === true;
  const reason = errorText(m.error);
  return { accepted, reason, stale: !accepted && reason !== null && /job/i.test(reason) };
}

function rejected(reason: string): ShareResult {
  return { accepted: false, reason, stale: false };
}

function delay(value: number | undefined, fallback: number, zeroOk = false): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || (value === 0 && !zeroOk)) return fallback;
  return Math.min(value, MAX_DELAY_MS);
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function seconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(3))} s`;
}
