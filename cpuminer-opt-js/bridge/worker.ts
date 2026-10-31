// The bridge as a Cloudflare Worker: the same allowlist, origin check and
// interceptor contract as the Node bridge, on Workers' WebSocketPair and TCP
// sockets. `connect` (from 'cloudflare:sockets') is passed in, so this module
// runs and tests anywhere.
import { LineDecoder, MAX_LINE_BYTES, formatHostPort } from '../src/stratum/client.ts';
import {
  LinePipe,
  MAX_MESSAGE_BYTES,
  buildAllowlist,
  requestedTarget,
  type BridgeBaseOptions,
  type BridgeConnection,
  type BridgeInterceptor,
} from './core.ts';

/** The parts of a Workers TCP socket the bridge uses. */
export interface WorkerSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): unknown;
}

export type WorkerConnect = (
  address: { hostname: string; port: number },
  options?: { secureTransport?: 'off' | 'on'; allowHalfOpen?: boolean },
) => WorkerSocket;

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
  WebSocketPair?: new () => { 0: WorkerWebSocket; 1: WorkerWebSocket };
  /** Builds the 101 response; default `new Response(null, { status: 101, webSocket: client })`. */
  upgradeResponse?: (client: WorkerWebSocket) => Response;
  /** Default 30 s. */
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
export function createWorkerBridge(options: WorkerBridgeOptions): { fetch(request: Request): Promise<Response> } {
  const allow = buildAllowlist(options.allow);
  if (typeof options.connect !== 'function') throw new Error("pass connect from 'cloudflare:sockets'");
  const origins = options.origins?.length ? new Set(options.origins) : null;
  const maxConnections = options.maxConnections ?? 256;
  const log = options.log ?? (() => {});
  const timeoutMs = options.connectTimeoutMs ?? 30_000;
  let active = 0;
  let nextId = 1;

  return {
    async fetch(request) {
      if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
        return text(426, 'cpuminer-js bridge: connect with a WebSocket');
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
      const peer = request.headers.get('cf-connecting-ip') ?? 'unknown';
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

      // Answer the upgrade only once the pool is reachable, as the Node bridge does.
      let socket: WorkerSocket | undefined;
      try {
        socket = options.connect({ hostname: target.host, port: target.port }, { secureTransport: tls ? 'on' : 'off', allowHalfOpen: false });
        await withTimeout(socket.opened, timeoutMs);
      } catch (err) {
        try {
          socket?.close();
        } catch {
          // already failed
        }
        notifyClose();
        log(`${peer} refused: 502 could not connect to ${label}`);
        return text(502, `could not connect to ${label}: ${(err as Error).message}`);
      }
      const pool = socket;

      const Pair = options.WebSocketPair ?? (globalThis as { WebSocketPair?: WorkerBridgeOptions['WebSocketPair'] }).WebSocketPair;
      if (!Pair) throw new Error('WebSocketPair is not available (not a Workers runtime?)');
      const pair = new Pair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
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
        try {
          pool.close();
        } catch {
          // already closed
        }
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
      void (async () => {
        const reader = pool.readable.getReader();
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

      return options.upgradeResponse
        ? options.upgradeResponse(client)
        : new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: unknown });
    },
  };
}
