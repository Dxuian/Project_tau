// WebSocket transport to a tau-crypto bridge (bridge/server.ts), for browsers
// and any runtime with a global WebSocket. One text message is one stratum line.
import type { Transport, TransportFactory } from '../types.ts';
import { MAX_LINE_BYTES, formatHostPort, parseStratumUrl } from './client.ts';

export interface WsTransportOptions {
  /** ws:// or wss:// URL of the bridge. */
  bridge: string;
  /** Default 30 s. */
  connectTimeoutMs?: number;
  /** WebSocket constructor; defaults to the global one. */
  WebSocket?: new (url: string) => any;
}

const CONNECT_TIMEOUT_MS = 30_000;

export function wsTransport(options: WsTransportOptions): TransportFactory {
  return (url) => new WsTransport(url, options);
}

/** The bridge URL for a pool: `${bridge}?target=host%3Aport&tls=0|1`. */
export function bridgeUrl(bridge: string, poolUrl: string): string {
  const { host, port, tls } = parseStratumUrl(poolUrl);
  const base = bridge.trim().replace(/#.*$/s, '');
  if (!/^(wss?|https?):\/\/[^/?]/i.test(base)) {
    throw new Error(`invalid bridge URL "${bridge}": expected ws:// or wss://`);
  }
  const target = encodeURIComponent(formatHostPort(host, port));
  return `${base}${base.includes('?') ? '&' : '?'}target=${target}&tls=${tls ? 1 : 0}`;
}

/** One connection through the bridge. onClose fires once if an open connection ends, but not after close(). */
export class WsTransport implements Transport {
  onLine: ((line: string) => void) | null = null;
  onClose: ((error?: Error) => void) | null = null;
  private readonly url: string;
  private readonly options: WsTransportOptions;
  private readonly decoder = new TextDecoder();
  private ws: any = null;
  private state: 'new' | 'connecting' | 'open' | 'closed' = 'new';
  private abort: ((error: Error) => void) | null = null;

  constructor(url: string, options: WsTransportOptions) {
    this.url = url;
    this.options = options;
  }

  connect(): Promise<void> {
    if (this.state !== 'new') return Promise.reject(new Error('transport already used'));
    this.state = 'connecting';
    return new Promise<void>((resolve, reject) => {
      const Ctor = this.options.WebSocket ?? (globalThis as { WebSocket?: new (url: string) => any }).WebSocket;
      if (typeof Ctor !== 'function') throw new Error('this runtime has no WebSocket');
      const ws = new Ctor(bridgeUrl(this.options.bridge, this.url));
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      const fail = (error: Error) => {
        clearTimeout(timer);
        this.abort = null;
        this.state = 'closed';
        this.ws = null;
        try {
          ws.close();
        } catch {
          // already closing
        }
        reject(error);
      };
      const ms = this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
      const timer = setTimeout(() => fail(new Error(`no answer from the bridge within ${ms / 1000} s`)), ms);
      this.abort = fail;
      ws.onopen = () => {
        clearTimeout(timer);
        this.abort = null;
        this.state = 'open';
        resolve();
      };
      ws.onmessage = (event: { data: unknown }) => this.message(event.data);
      ws.onerror = () => {}; // the close event follows, with a code
      ws.onclose = (event: { code: number; reason: string }) => {
        const why = `code ${event.code}${event.reason ? `: ${event.reason}` : ''}`;
        if (this.state === 'connecting') {
          // Browsers hide the HTTP status (403 not allowed, 502 pool unreachable...).
          fail(new Error(`could not reach the pool through the bridge (${why})`));
        } else if (this.state === 'open') {
          this.ended(event.code === 1000 ? undefined : new Error(`bridge connection closed (${why})`));
        }
      };
    });
  }

  send(line: string): void {
    if (this.state === 'open') this.ws.send(line);
  }

  close(): void {
    if (this.state === 'closed') return;
    if (this.abort) {
      this.abort(new Error('connection closed'));
      return;
    }
    this.state = 'closed';
    try {
      this.ws?.close(1000);
    } catch {
      // already closing
    }
    this.ws = null;
  }

  private message(data: unknown): void {
    if (this.state !== 'open') return;
    let text: string;
    if (typeof data === 'string') text = data;
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) text = this.decoder.decode(data);
    else return;
    if (text.length > MAX_LINE_BYTES) {
      this.ended(new Error(`message from the bridge longer than ${MAX_LINE_BYTES} bytes`));
      return;
    }
    // One line per message; split anyway in case a bridge batches them.
    for (const raw of text.split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!line.trim()) continue;
      if (this.state !== 'open') return;
      this.onLine?.(line);
    }
  }

  /** The connection ended on its own (or must end): close it and report once. */
  private ended(error?: Error): void {
    const ws = this.ws;
    this.state = 'closed';
    this.ws = null;
    try {
      ws?.close(1000);
    } catch {
      // already closing
    }
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.(error);
  }
}
