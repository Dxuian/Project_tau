// WebSocket <-> TCP bridge that lets browsers reach stratum pools. Each WebSocket
// opens one TCP (or TLS) connection to an allowlisted pool, never anywhere else;
// one text message is one stratum line. A minimal RFC 6455 server on node:http.
import { nodeBuiltin } from '../src/env/detect.ts';
import { LineDecoder, MAX_LINE_BYTES, formatHostPort } from '../src/stratum/client.ts';
import {
  LinePipe,
  MAX_MESSAGE_BYTES,
  buildAllowlist,
  parseTarget,
  requestedTarget,
  type BridgeBaseOptions,
  type BridgeConnection,
  type BridgeInterceptor,
} from './core.ts';

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

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const CONNECT_TIMEOUT_MS = 30_000;
const CLOSE_GRACE_MS = 2_000;
const KEEPALIVE_MS = 50_000;

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

// ------------------------------------------------------------ frames

class WsProtocolError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface WsMessage {
  opcode: number;
  payload: Uint8Array;
}

interface Frame extends WsMessage {
  fin: boolean;
  next: number;
}

/** Parses client frames (masked, as RFC 6455 requires) into messages and control frames. */
class FrameParser {
  private readonly maxBytes: number;
  private chunks: Uint8Array[] = [];
  private size = 0;
  private need = 2;
  private fragments: Uint8Array[] | null = null;
  private fragmentOpcode = 0;
  private fragmentBytes = 0;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  /** Throws WsProtocolError on invalid input. */
  push(chunk: Uint8Array): WsMessage[] {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size < this.need) return [];
    const buf = this.chunks.length === 1 ? this.chunks[0] : concat(this.chunks, this.size);
    this.chunks = [];
    this.size = 0;
    const messages: WsMessage[] = [];
    let offset = 0;
    for (;;) {
      const frame = this.frame(buf, offset);
      if (typeof frame === 'number') {
        this.need = frame;
        break;
      }
      offset = frame.next;
      this.assemble(frame, messages);
    }
    if (offset < buf.length) {
      const rest = new Uint8Array(buf.subarray(offset));
      this.chunks = [rest];
      this.size = rest.length;
    }
    return messages;
  }

  /** The frame at `offset`, or how many bytes from there it needs. */
  private frame(buf: Uint8Array, offset: number): Frame | number {
    const available = buf.length - offset;
    if (available < 2) return 2;
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    if (b0 & 0x70) throw new WsProtocolError(1002, 'reserved bits set');
    if (![OP_CONTINUATION, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG].includes(opcode)) {
      throw new WsProtocolError(1002, `unknown opcode ${opcode}`);
    }
    if (!(b1 & 0x80)) throw new WsProtocolError(1002, 'client frames must be masked');
    let length = b1 & 0x7f;
    let header = 2;
    if (length === 126) {
      header = 4;
      if (available < header) return header;
      length = (buf[offset + 2] << 8) | buf[offset + 3];
    } else if (length === 127) {
      header = 10;
      if (available < header) return header;
      const view = new DataView(buf.buffer, buf.byteOffset + offset + 2, 8);
      length = view.getUint32(0) * 2 ** 32 + view.getUint32(4);
    }
    if (opcode >= OP_CLOSE && (!fin || length > 125)) throw new WsProtocolError(1002, 'invalid control frame');
    if (length > this.maxBytes) throw new WsProtocolError(1009, `frame larger than ${this.maxBytes} bytes`);
    header += 4; // masking key
    if (available < header + length) return header + length;
    const start = offset + header;
    const mask = buf.subarray(start - 4, start);
    const payload = new Uint8Array(length);
    payload.set(buf.subarray(start, start + length));
    for (let i = 0; i < length; i++) payload[i] ^= mask[i & 3];
    return { fin, opcode, payload, next: start + length };
  }

  private assemble(frame: Frame, out: WsMessage[]): void {
    if (frame.opcode >= OP_CLOSE) {
      out.push({ opcode: frame.opcode, payload: frame.payload }); // may come between fragments
      return;
    }
    if (frame.opcode === OP_CONTINUATION) {
      if (!this.fragments) throw new WsProtocolError(1002, 'continuation without a message');
    } else {
      if (this.fragments) throw new WsProtocolError(1002, 'new message inside a fragmented one');
      if (frame.fin) {
        out.push({ opcode: frame.opcode, payload: frame.payload });
        return;
      }
      this.fragments = [];
      this.fragmentOpcode = frame.opcode;
      this.fragmentBytes = 0;
    }
    this.fragmentBytes += frame.payload.length;
    if (this.fragmentBytes > this.maxBytes) {
      throw new WsProtocolError(1009, `message larger than ${this.maxBytes} bytes`);
    }
    this.fragments.push(frame.payload);
    if (frame.fin) {
      out.push({ opcode: this.fragmentOpcode, payload: concat(this.fragments, this.fragmentBytes) });
      this.fragments = null;
    }
  }
}

/** An unmasked, unfragmented server frame. */
function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const n = payload.length;
  const header = n < 126 ? 2 : n < 65536 ? 4 : 10;
  const frame = new Uint8Array(header + n);
  frame[0] = 0x80 | opcode;
  if (n < 126) {
    frame[1] = n;
  } else if (n < 65536) {
    frame[1] = 126;
    frame[2] = n >>> 8;
    frame[3] = n & 0xff;
  } else {
    frame[1] = 127;
    const view = new DataView(frame.buffer);
    view.setUint32(2, Math.floor(n / 2 ** 32));
    view.setUint32(6, n >>> 0);
  }
  frame.set(payload, header);
  return frame;
}

function closePayload(code?: number, reason = ''): Uint8Array {
  if (code === undefined) return new Uint8Array(0);
  const text = utf8.encode(reason).subarray(0, 123);
  const payload = new Uint8Array(2 + text.length);
  payload[0] = code >>> 8;
  payload[1] = code & 0xff;
  payload.set(text, 2);
  return payload;
}

/** Codes an endpoint may put in a close frame (not 1005, 1006, 1015 or unassigned ones). */
function sendableCloseCode(code: number): boolean {
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999);
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A client message as one stratum line: trailing newlines normalized to one '\n'. */
function asLine(payload: Uint8Array): Uint8Array | null {
  let end = payload.length;
  while (end && (payload[end - 1] === 10 || payload[end - 1] === 13)) end--;
  if (!end) return null;
  const line = new Uint8Array(end + 1);
  line.set(payload.subarray(0, end));
  line[end] = 10;
  return line;
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    strictUtf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function unref(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

// ------------------------------------------------------------ server

export async function createBridge(options: BridgeOptions): Promise<Bridge> {
  const allow = buildAllowlist(options.allow);
  if (!options.server && options.port === undefined) throw new Error('the bridge needs a port (or a server to attach to)');
  const origins = options.origins?.length ? new Set(options.origins) : null;
  const maxConnections = options.maxConnections ?? 256;
  const log = options.log ?? (() => {});
  const [http, net, tls, crypto] = await Promise.all(
    ['http', 'net', 'tls', 'crypto'].map((name) => nodeBuiltin(name)),
  );
  const sockets = new Set<any>(); // client and pool sockets, destroyed by close()
  let active = 0;
  let nextId = 1;

  const track = (socket: any) => {
    sockets.add(socket);
    socket.on('error', () => {}); // failures show up as 'close'
    socket.on('close', () => sockets.delete(socket));
  };

  const ownServer = !options.server;
  const server =
    options.server ??
    http.createServer((_req: any, res: any) => {
      res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Upgrade: 'websocket' });
      res.end('tau-crypto bridge: connect with a WebSocket\n');
    });

  const onUpgrade = (req: any, socket: any, head: Uint8Array) => {
    track(socket);
    // http.Server sockets allow half-open connections: when the client ends, finish ours too.
    socket.on('end', () => {
      socket.end();
      unref(setTimeout(() => socket.destroy(), CLOSE_GRACE_MS));
    });
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    const refuse = (status: number, why: string, extra: string[] = []) => {
      log(`${peer} refused: ${status} ${why}`);
      const body = `${why}\n`;
      socket.end(
        [
          `HTTP/1.1 ${status} ${http.STATUS_CODES[status]}`,
          'Connection: close',
          'Content-Type: text/plain; charset=utf-8',
          `Content-Length: ${utf8.encode(body).length}`,
          ...extra,
          '',
          body,
        ].join('\r\n'),
      );
      unref(setTimeout(() => socket.destroy(), CLOSE_GRACE_MS));
    };

    const headers = req.headers;
    const upgrade = String(headers.upgrade ?? '').toLowerCase().split(',').map((s) => s.trim());
    if (req.method !== 'GET' || !upgrade.includes('websocket')) return refuse(400, 'expected a WebSocket upgrade');
    if (headers['sec-websocket-version'] !== '13') {
      return refuse(426, 'unsupported WebSocket version', ['Sec-WebSocket-Version: 13']);
    }
    const key = String(headers['sec-websocket-key'] ?? '').trim();
    if (!/^[A-Za-z0-9+/]{22}==$/.test(key)) return refuse(400, 'invalid Sec-WebSocket-Key');
    if (origins && !origins.has(String(headers.origin ?? ''))) return refuse(403, 'origin not allowed');
    let query: URLSearchParams;
    try {
      query = new URL(req.url ?? '/', 'http://bridge.invalid').searchParams;
    } catch {
      return refuse(400, 'invalid request URL');
    }
    const wanted = requestedTarget(query, allow);
    if ('status' in wanted) return refuse(wanted.status, wanted.why);
    const { target } = wanted;
    const tlsFlag = wanted.tls ? '1' : '0';
    if (active >= maxConnections) return refuse(503, 'too many connections');

    // The connection's reply/close work once accept() has run.
    const link: { reply: (line: string) => void; close: (reason?: string) => void } = {
      reply: () => {},
      close: () => socket.destroy(),
    };
    let interceptor: BridgeInterceptor | null = null;
    if (options.intercept) {
      const connection: BridgeConnection = {
        id: nextId++,
        peer,
        target: formatHostPort(target.host, target.port),
        tls: tlsFlag === '1',
        origin: headers.origin === undefined ? null : String(headers.origin),
        query,
        reply: (line) => link.reply(line),
        close: (reason) => link.close(reason),
      };
      try {
        interceptor = options.intercept(connection);
      } catch (err) {
        log(`${peer}: interceptor failed: ${(err as Error).message}`);
        return refuse(500, 'internal error');
      }
      if (!interceptor) return refuse(403, 'connection refused');
      const accepted = interceptor;
      socket.once('close', () => {
        try {
          accepted.onClose?.();
        } catch (err) {
          log(`${peer}: interceptor onClose failed: ${(err as Error).message}`);
        }
      });
    }

    active++;
    socket.once('close', () => active--);
    const label = `${formatHostPort(target.host, target.port)}${tlsFlag === '1' ? ' (TLS)' : ''}`;
    const useTls = tlsFlag === '1';
    const pool = useTls
      ? tls.connect({
          host: target.host,
          port: target.port,
          servername: net.isIP(target.host) ? undefined : target.host,
          rejectUnauthorized: !options.tlsInsecure,
        })
      : net.connect({ host: target.host, port: target.port });
    track(pool);
    let poolError: Error | undefined;
    pool.on('error', (err: Error) => {
      poolError ??= err;
    });
    // Answer the upgrade only once the pool is reachable, so the WebSocket opens iff the pool did.
    const timer = setTimeout(() => pool.destroy(new Error('timed out')), CONNECT_TIMEOUT_MS);
    const ready = useTls ? 'secureConnect' : 'connect';
    const onReady = () => {
      cleanup();
      if (socket.destroyed) pool.destroy();
      else accept(socket, head, key, pool, () => poolError, peer, label, interceptor, link);
    };
    const onPoolFailed = () => {
      cleanup();
      refuse(502, `could not connect to ${label}${poolError ? `: ${poolError.message}` : ''}`);
    };
    const onClientGone = () => {
      cleanup();
      pool.destroy();
    };
    const cleanup = () => {
      clearTimeout(timer);
      pool.off(ready, onReady);
      pool.off('close', onPoolFailed);
      socket.off('close', onClientGone);
    };
    pool.on(ready, onReady);
    pool.on('close', onPoolFailed);
    socket.on('close', onClientGone);
  };
  server.on('upgrade', onUpgrade);

  /** Completes the handshake and relays between the WebSocket and the pool. */
  function accept(
    socket: any,
    head: Uint8Array,
    key: string,
    pool: any,
    poolError: () => Error | undefined,
    peer: string,
    label: string,
    interceptor: BridgeInterceptor | null,
    link: { reply: (line: string) => void; close: (reason?: string) => void },
  ): void {
    const acceptKey = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '',
        '',
      ].join('\r\n'),
    );
    socket.setNoDelay(true);
    pool.setNoDelay(true);
    pool.setKeepAlive(true, KEEPALIVE_MS);
    log(`${peer} connected to ${label}`);

    const frames = new FrameParser(MAX_MESSAGE_BYTES);
    const lines = new LineDecoder(MAX_LINE_BYTES);
    let closeSent = false;
    let closeReceived = false;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    const sendFrame = (opcode: number, payload: Uint8Array): boolean =>
      closeSent || socket.destroyed ? true : socket.write(encodeFrame(opcode, payload));
    // Starts or answers the closing handshake; the TCP connection ends after the reply or a grace period.
    const closeWs = (code?: number, reason = '') => {
      if (closeSent || socket.destroyed) return;
      socket.write(encodeFrame(OP_CLOSE, closePayload(code, reason)));
      closeSent = true;
      closeTimer = setTimeout(() => socket.destroy(), CLOSE_GRACE_MS);
      unref(closeTimer);
    };
    const endPool = () => {
      if (pool.destroyed) return;
      pool.end(); // let the last lines reach the pool
      unref(setTimeout(() => pool.destroy(), CLOSE_GRACE_MS));
    };
    let fromPoolPipe: LinePipe | null = null;
    let fromClientPipe: LinePipe | null = null;
    // A protocol violation fails the connection: close frame, then TCP, no handshake (RFC 6455 7.1.7).
    const fail = (code: number, reason: string) => {
      log(`${peer}: ${reason}`);
      closeReceived = true; // ignore the rest
      fromPoolPipe?.close();
      fromClientPipe?.close();
      pool.destroy();
      closeWs(code, reason);
      socket.end();
    };
    link.reply = (line) => {
      if (!closeReceived) sendFrame(OP_TEXT, utf8.encode(line));
    };
    link.close = (reason = 'closed by the bridge') => {
      log(`${peer}: ${reason}`);
      closeReceived = true;
      fromClientPipe?.close();
      endPool();
      closeWs(1008, reason);
      socket.end();
    };

    // pool -> client: one text frame per line
    let poolPaused = false;
    const toClient = (line: string) => {
      if (!sendFrame(OP_TEXT, utf8.encode(line)) && !poolPaused) {
        poolPaused = true;
        pool.pause();
        socket.once('drain', () => {
          poolPaused = false;
          pool.resume();
        });
      }
    };
    pool.on('data', (chunk: Uint8Array) => {
      let received: string[];
      try {
        received = lines.push(chunk);
      } catch (err) {
        log(`${peer}: ${label} sent a ${(err as Error).message}`);
        pool.destroy();
        closeWs(1009, 'pool line too long');
        return;
      }
      for (const line of received) {
        if (fromPoolPipe) fromPoolPipe.push(line);
        else toClient(line);
      }
    });
    pool.on('close', () => {
      const error = poolError();
      log(`${peer}: ${label} closed${error ? ` (${error.message})` : ''}`);
      closeWs(error ? 1011 : 1000, error ? 'pool connection failed' : 'pool closed the connection');
    });

    // client -> pool: one line per text message
    let clientPaused = false;
    const toPool = (line: Uint8Array) => {
      if (!pool.destroyed && !pool.write(line) && !clientPaused) {
        clientPaused = true;
        socket.pause();
        pool.once('drain', () => {
          clientPaused = false;
          socket.resume();
        });
      }
    };
    if (interceptor) {
      const broken = (err: Error) => fail(1011, `interceptor error: ${err.message}`);
      const viaPool = interceptor.fromPool ? (line: string) => interceptor.fromPool!(line) : (line: string) => line;
      const viaClient = interceptor.fromClient ? (line: string) => interceptor.fromClient!(line) : (line: string) => line;
      fromPoolPipe = new LinePipe(viaPool, toClient, broken);
      fromClientPipe = new LinePipe(viaClient, (line) => toPool(utf8.encode(`${line}\n`)), broken);
    }
    const onData = (chunk: Uint8Array) => {
      if (closeReceived) return;
      let messages: WsMessage[];
      try {
        messages = frames.push(chunk);
      } catch (err) {
        fail(err instanceof WsProtocolError ? err.code : 1002, (err as Error).message);
        return;
      }
      for (const message of messages) {
        if (message.opcode === OP_TEXT || message.opcode === OP_BINARY) {
          if (message.opcode === OP_TEXT && !isUtf8(message.payload)) {
            fail(1007, 'invalid UTF-8 in a text message');
            return;
          }
          if (closeSent) continue;
          if (fromClientPipe) {
            // Every line of the message passes the interceptor on its own.
            let text: string;
            try {
              text = strictUtf8.decode(message.payload);
            } catch {
              fail(1007, 'invalid UTF-8 in a message');
              return;
            }
            for (const raw of text.split(/\r?\n/)) if (raw.trim()) fromClientPipe.push(raw);
            continue;
          }
          const line = asLine(message.payload);
          if (line) toPool(line);
        } else if (message.opcode === OP_PING) {
          sendFrame(OP_PONG, message.payload);
        } else if (message.opcode === OP_CLOSE) {
          closeReceived = true;
          const p = message.payload;
          const code = p.length >= 2 ? (p[0] << 8) | p[1] : 0;
          closeWs(sendableCloseCode(code) ? code : undefined); // echo the code
          socket.end();
          endPool();
          return;
        }
      }
    };
    socket.on('data', onData);
    socket.on('close', () => {
      if (closeTimer) clearTimeout(closeTimer);
      fromPoolPipe?.close();
      fromClientPipe?.close();
      endPool();
      log(`${peer} disconnected from ${label}`);
    });
    if (head?.length) onData(head);
  }

  if (ownServer) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, options.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  let closing: Promise<void> | null = null;
  return {
    port: server.address()?.port ?? 0,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.off('upgrade', onUpgrade);
        for (const socket of sockets) socket.destroy();
        if (!ownServer) return resolve(); // the app owns its server
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      return closing;
    },
  };
}

// --------------------------------------------------------------- CLI

export const BRIDGE_USAGE = `usage: tau-crypto bridge --listen [host:]port --allow host:port[,host:port...]
                          [--origin https://a,https://b] [--max-connections N] [--tls-insecure]

  --listen           where to accept WebSocket connections (all interfaces unless a host is given)
  --allow            pools that may be reached; browsers connect with ?target=host:port&tls=0|1
  --origin           only accept pages from these origins (checks the Origin header)
  --max-connections  simultaneous connections (default 256)
  --tls-insecure     accept any certificate from TLS pools`;

/** Parses bridge CLI arguments (with or without the leading "bridge"); null means --help. */
export function parseBridgeArgs(argv: string[]): BridgeOptions | null {
  const args = argv[0] === 'bridge' ? argv.slice(1) : argv.slice();
  const options: BridgeOptions = { port: -1, allow: [] };
  const list = (value: string) => value.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < args.length; i++) {
    let name = args[i];
    let inline: string | undefined;
    const eq = name.indexOf('=');
    if (name.startsWith('--') && eq > 0) {
      inline = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    const value = () => {
      const v = inline ?? args[++i];
      if (v === undefined || (inline === undefined && v.startsWith('--'))) {
        throw new Error(`${name} needs a value\n${BRIDGE_USAGE}`);
      }
      return v;
    };
    switch (name) {
      case '--listen': {
        const m = /^(?:\[([0-9a-f:.]+)\]:|([^:]*):)?(\d{1,5})$/i.exec(value().trim());
        const port = m ? Number(m[3]) : -1;
        if (!m || port > 65535) throw new Error(`invalid --listen value: expected [host:]port\n${BRIDGE_USAGE}`);
        const host = m[1] ?? m[2];
        options.port = port;
        if (host) options.host = host;
        else delete options.host;
        break;
      }
      case '--allow':
        for (const entry of list(value())) {
          if (!parseTarget(entry)) throw new Error(`invalid --allow entry "${entry}": expected host:port`);
          options.allow.push(entry);
        }
        break;
      case '--origin':
        (options.origins ??= []).push(...list(value()));
        break;
      case '--max-connections': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) throw new Error('--max-connections must be a positive integer');
        options.maxConnections = n;
        break;
      }
      case '--tls-insecure':
        if (inline !== undefined) throw new Error('--tls-insecure takes no value');
        options.tlsInsecure = true;
        break;
      case '-h':
      case '--help':
        return null;
      default:
        throw new Error(`unknown option ${name}\n${BRIDGE_USAGE}`);
    }
  }
  if (options.port === undefined || options.port < 0) throw new Error(`--listen is required\n${BRIDGE_USAGE}`);
  if (!options.allow.length) {
    throw new Error(`--allow is required: the bridge only connects to listed pools\n${BRIDGE_USAGE}`);
  }
  return options;
}

/** `tau-crypto bridge ...`: runs until SIGINT/SIGTERM. Throws on invalid arguments. */
export async function runBridgeCli(argv: string[]): Promise<void> {
  const options = parseBridgeArgs(argv);
  if (!options) {
    console.log(BRIDGE_USAGE);
    return;
  }
  const log = (line: string) => console.error(`${new Date().toISOString()} ${line}`);
  const bridge = await createBridge({ ...options, log });
  const where = options.host ? formatHostPort(options.host, bridge.port) : `port ${bridge.port}`;
  log(`bridge listening on ${where} for ${options.allow.join(', ')}`);
  if (options.origins) log(`accepting origins ${options.origins.join(', ')}`);
  const proc = (globalThis as { process?: any }).process;
  await new Promise<void>((resolve) => {
    const stop = (signal: string) => {
      proc.off('SIGINT', onInt);
      proc.off('SIGTERM', onTerm);
      log(`${signal}: closing the bridge`);
      bridge.close().then(resolve, resolve);
    };
    const onInt = () => stop('SIGINT');
    const onTerm = () => stop('SIGTERM');
    proc.on('SIGINT', onInt);
    proc.on('SIGTERM', onTerm);
  });
}
