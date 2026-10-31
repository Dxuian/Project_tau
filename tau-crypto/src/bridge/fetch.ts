// The bridge as a web-standard `fetch(request)` handler, for runtimes that hand
// WebSocket upgrades to the server as Requests and open TCP sockets as web
// streams. The runtime's own pieces are parameters (`connect` opens the pool
// connection, `upgrade` accepts the WebSocket), so this module holds no
// platform code and runs and tests anywhere. Same allowlist, origin check and
// interceptor contract as the Node bridge.
import { LineDecoder, MAX_LINE_BYTES, formatHostPort } from '../stratum/client.ts';
import {
  LinePipe,
  MAX_MESSAGE_BYTES,
  buildAllowlist,
  requestedTarget,
  type BridgeBaseOptions,
  type BridgeConnection,
  type BridgeInterceptor,
} from './core.ts';

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
  connect(target: { host: string; port: number; tls: boolean }): PoolSocket;
  /**
   * Accepts the WebSocket upgrade of `request`: the server end, ready to send
   * and receive, and the response that completes the upgrade. Called only once
   * the pool connection is open.
   */
  upgrade(request: Request): { socket: ServerWebSocket; response: Response };
  /** The client's address, for logs and the interceptor. Default 'unknown'. */
  peer?(request: Request): string | null | undefined;
  /** How long a pool may take to accept the connection. Default 30 s. */
  connectTimeoutMs?: number;
}

const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function text(status: number, body: string): Response {
  return new Response(`${body}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A `fetch(request)` handler that bridges WebSocket clients to allowlisted pools. */
export function createFetchBridge(options: FetchBridgeOptions): { fetch(request: Request): Promise<Response> } {
  const allow = buildAllowlist(options.allow);
  if (typeof options.connect !== 'function') throw new Error('the fetch bridge needs connect(target)');
  if (typeof options.upgrade !== 'function') throw new Error('the fetch bridge needs upgrade(request)');
  const origins = options.origins?.length ? new Set(options.origins) : null;
  const maxConnections = options.maxConnections ?? 256;
  const log = options.log ?? (() => {});
  const timeoutMs = options.connectTimeoutMs ?? 30_000;
  let active = 0;
  let nextId = 1;

  return {
    async fetch(request) {
      if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
        return text(426, 'tau-crypto bridge: connect with a WebSocket');
      }
      const origin = request.headers.get('origin');
      if (origins && !origins.has(origin ?? '')) return text(403, 'origin not allowed');
      let query: URLSearchParams;
      try {
        query = new URL(request.url).searchParams;
      } catch {
        return text(400, 'invalid request URL');
      }
      const wanted = requestedTarget(query, allow);
      if ('status' in wanted) return text(wanted.status, wanted.why);
      if (active >= maxConnections) return text(503, 'too many connections');
      const { target, tls } = wanted;
      const peer = options.peer?.(request) || 'unknown';
      const label = `${formatHostPort(target.host, target.port)}${tls ? ' (TLS)' : ''}`;

      const link = { reply: (_line: string) => {}, close: (_reason?: string) => {} };
      let interceptor: BridgeInterceptor | null = null;
      if (options.intercept) {
        const connection: BridgeConnection = {
          id: nextId++,
          peer,
          target: formatHostPort(target.host, target.port),
          tls,
          origin,
          query,
          reply: (line) => link.reply(line),
          close: (reason) => link.close(reason),
        };
        try {
          interceptor = options.intercept(connection);
        } catch (err) {
          log(`${peer}: interceptor failed: ${(err as Error).message}`);
          return text(500, 'internal error');
        }
        if (!interceptor) return text(403, 'connection refused');
      }
      const notifyClose = () => {
        try {
          interceptor?.onClose?.();
        } catch (err) {
          log(`${peer}: interceptor onClose failed: ${(err as Error).message}`);
        }
      };
      const closePool = (socket: PoolSocket | undefined) => {
        try {
          socket?.close();
        } catch {
          // already closed
        }
      };

      // Answer the upgrade only once the pool is reachable, as the Node bridge does.
      let pool: PoolSocket | undefined;
      try {
        pool = options.connect({ host: target.host, port: target.port, tls });
        await withTimeout(pool.opened, timeoutMs);
      } catch (err) {
        closePool(pool);
        notifyClose();
        log(`${peer} refused: 502 could not connect to ${label}`);
        return text(502, `could not connect to ${label}: ${(err as Error).message}`);
      }

      let upgraded: { socket: ServerWebSocket; response: Response };
      try {
        upgraded = options.upgrade(request);
      } catch (err) {
        closePool(pool);
        notifyClose();
        log(`${peer}: upgrade failed: ${(err as Error).message}`);
        return text(500, 'internal error');
      }
      const server = upgraded.socket;
      active++;
      log(`${peer} connected to ${label}`);

      const writer = pool.writable.getWriter();
      let closed = false;
      let fromPool: LinePipe | null = null;
      let fromClient: LinePipe | null = null;
      const finish = (code: number, reason: string) => {
        if (closed) return;
        closed = true;
        active--;
        fromPool?.close();
        fromClient?.close();
        try {
          server.close(code, reason);
        } catch {
          // already closed
        }
        writer.close().catch(() => {});
        closePool(pool);
        log(`${peer} disconnected from ${label} (${reason})`);
        notifyClose();
      };
      const toClient = (line: string) => {
        if (closed) return;
        try {
          server.send(line);
        } catch {
          finish(1011, 'websocket send failed');
        }
      };
      const toPool = (line: string) => {
        if (closed) return;
        writer.write(encoder.encode(`${line}\n`)).catch(() => finish(1011, 'pool connection failed'));
      };
      link.reply = toClient;
      link.close = (reason = 'closed by the bridge') => finish(1008, reason);
      if (interceptor) {
        const broken = (err: Error) => {
          log(`${peer}: interceptor error: ${err.message}`);
          finish(1011, 'interceptor error');
        };
        const icp = interceptor;
        fromPool = new LinePipe(icp.fromPool ? (l) => icp.fromPool!(l) : (l) => l, toClient, broken);
        fromClient = new LinePipe(icp.fromClient ? (l) => icp.fromClient!(l) : (l) => l, toPool, broken);
      }

      server.addEventListener('message', (event) => {
        if (closed) return;
        let message: string;
        if (typeof event.data === 'string') message = event.data;
        else {
          try {
            message = strictUtf8.decode(event.data);
          } catch {
            return finish(1007, 'invalid UTF-8 in a message');
          }
        }
        if (message.length > MAX_MESSAGE_BYTES || encoder.encode(message).length > MAX_MESSAGE_BYTES) {
          return finish(1009, 'message too large');
        }
        // Every line of the message on its own.
        for (const raw of message.split(/\r?\n/)) {
          if (!raw.trim()) continue;
          if (fromClient) fromClient.push(raw);
          else toPool(raw);
        }
      });
      server.addEventListener('close', () => finish(1000, 'client closed the connection'));
      server.addEventListener('error', () => finish(1011, 'websocket error'));

      // pool -> client: one message per line
      const source = pool;
      void (async () => {
        const reader = source.readable.getReader();
        const lines = new LineDecoder(MAX_LINE_BYTES);
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || closed) break;
            let received: string[];
            try {
              received = lines.push(value);
            } catch {
              return finish(1009, 'pool line too long');
            }
            for (const line of received) {
              if (fromPool) fromPool.push(line);
              else toClient(line);
            }
          }
          finish(1000, 'pool closed the connection');
        } catch {
          finish(1011, 'pool connection failed');
        }
      })();

      return upgraded.response;
    },
  };
}
