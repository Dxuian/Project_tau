// Scriptable mock stratum pool for tests: a TCP (or TLS) server on 127.0.0.1
// with a random port, speaking newline-delimited JSON-RPC. Never touches the
// network beyond loopback.
//
//   const pool = await MockPool.start();          // or start({ tls, port, extranonce1, extranonce2Size, sessionId })
//   pool.url                                       // 'stratum+tcp://127.0.0.1:<port>' ('stratum+ssl://' with tls)
//   pool.target                                    // '127.0.0.1:<port>', for a bridge's allow list
//   pool.received                                  // every message from every client: { conn, msg, line }
//   pool.messages('mining.submit')                 // the parsed messages with that method, in order
//   pool.current                                   // the latest open MockConnection
//   await pool.waitForMethod('mining.authorize')   // first message with that method (or the n-th: (m, 2))
//   await pool.waitFor((r) => r.msg.id === 7)      // first received message matching a predicate
//   await pool.waitForConnection(2)                // the n-th accepted connection (1-based)
//   pool.notify(EXAMPLE_JOB)                       // to the latest connection; likewise setDifficulty(d),
//                                                  // setExtranonce(xn1, size), reconnect(host, port), send(msg)
//   await pool.request('client.get_version')       // server request; resolves with the client's reply
//   pool.handle('mining.submit', (msg, conn) => ({ result: false, error: [23, 'Low difficulty share', null] }))
//                                                  // a handler returns { result, error }, a raw line, or null
//   conn.reply(id, result, error); conn.write(raw); conn.drop(); await conn.closed
//   pool.dropAll(); await pool.close();
//
// Default replies: mining.subscribe -> [[["mining.set_difficulty","d1"],["mining.notify","s1"]],"f8002c90",4];
// mining.authorize, mining.extranonce.subscribe and mining.submit -> true. Other methods get no reply.
import { createServer, type Server, type Socket } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';

export interface Received {
  conn: MockConnection;
  /** Parsed JSON, or null if the line wasn't JSON. */
  msg: any;
  line: string;
}

/** A handler's answer: { result, error } (missing ones are null), a raw line, or null/undefined for none. */
export type Reply = { result?: unknown; error?: unknown } | string | null | undefined;
export type Handler = (msg: any, conn: MockConnection) => Reply;

export interface MockPoolOptions {
  /** Port to listen on (default: a free one). */
  port?: number;
  /** Serve TLS with a self-signed certificate for 127.0.0.1/localhost (clients need tlsInsecure). */
  tls?: boolean;
  /** Default 'f8002c90'. */
  extranonce1?: string;
  /** Default 4. */
  extranonce2Size?: number;
  /** mining.notify subscription id in the subscribe result; null leaves it out. Default 's1'. */
  sessionId?: string | null;
}

/** mining.notify params of the Stratum V1 documentation's example job. */
export const EXAMPLE_JOB: unknown[] = [
  'bf',
  '4d16b6f85af6e2198f44ae2a6de67f78487ae5611b77c6c0440b921e00000000',
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff20020862062f503253482f04b8864e5008',
  '072f736c7573682f000000000100f2052a010000001976a914d23fcdf86f7e756a64a7a9688ef9903327048ed988ac00000000',
  [],
  '00000002',
  '1c2ac4af',
  '504e86b9',
  false,
];

// Self-signed test certificate (CN "cpuminer-opt-js test pool", SAN IP:127.0.0.1 and
// DNS:localhost, valid 2000-2100). Test use only.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgndq1dLAFVbVt81VH
78+jdkEMSgJFsgU4vkeROUrNInehRANCAASgMfSeVskW++O+MOWp87f0hVJcEDx/
+wJ2QJZjn2us438tEqhSoW2hukRxgvdmWHvsnY5WRLhZtvIVndPFONhL
-----END PRIVATE KEY-----
`;
export const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBhzCCAS2gAwIBAgIBATAKBggqhkjOPQQDAjAkMSIwIAYDVQQDDBljcHVtaW5l
ci1vcHQtanMgdGVzdCBwb29sMCAXDTAwMDEwMTAwMDAwMFoYDzIxMDAwMTAxMDAw
MDAwWjAkMSIwIAYDVQQDDBljcHVtaW5lci1vcHQtanMgdGVzdCBwb29sMFkwEwYH
KoZIzj0CAQYIKoZIzj0DAQcDQgAEoDH0nlbJFvvjvjDlqfO39IVSXBA8f/sCdkCW
Y59rrON/LRKoUqFtobpEcYL3Zlh77J2OVkS4WbbyFZ3TxTjYS6NOMEwwGgYDVR0R
BBMwEYcEfwAAAYIJbG9jYWxob3N0MA8GA1UdEwEB/wQFMAMBAf8wHQYDVR0OBBYE
FF2ZufVSzde0llhbpBHDmBTpUS1OMAoGCCqGSM49BAMCA0gAMEUCIQCTT+L4j3i+
af03s/oD7vcG4adLJi/bWk2nk0XK0lcLcgIgPGaefW1xt7GCGxGyhKKSE8e4PduE
5EnvSunEX5wi61c=
-----END CERTIFICATE-----
`;

const WAIT_MS = 3000;

interface Waiter<T> {
  test: (value: T) => boolean;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Resolves with the first item of `existing` or a later `offer()` that passes `test`. */
function waitIn<T>(
  existing: T[],
  waiters: Set<Waiter<T>>,
  test: (v: T) => boolean,
  ms: number,
  what: string,
): Promise<T> {
  const hit = existing.find(test);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise<T>((resolve, reject) => {
    const waiter: Waiter<T> = {
      test,
      resolve,
      reject,
      timer: setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`mock pool: timed out after ${ms} ms waiting for ${what}`));
      }, ms),
    };
    waiters.add(waiter);
  });
}

function offer<T>(waiters: Set<Waiter<T>>, value: T): void {
  for (const waiter of waiters) {
    if (!waiter.test(value)) continue;
    waiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }
}

export class MockConnection {
  readonly pool: MockPool;
  /** 1-based, in accept order. */
  readonly index: number;
  readonly socket: Socket;
  /** Messages from this connection (parsed JSON; null for non-JSON lines). */
  readonly received: any[] = [];
  /** Resolves when the socket has closed. */
  readonly closed: Promise<void>;
  isClosed = false;
  private nextId = 1000;

  constructor(pool: MockPool, index: number, socket: Socket) {
    this.pool = pool;
    this.index = index;
    this.socket = socket;
    this.closed = new Promise<void>((resolve) => {
      socket.on('close', () => {
        this.isClosed = true;
        resolve();
      });
    });
  }

  /** Sends one message (an object is JSON-encoded) followed by '\n'. */
  send(msg: object | string): void {
    this.write(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`);
  }

  /** Writes raw data, no newline added. */
  write(data: string | Uint8Array): void {
    if (!this.socket.destroyed) this.socket.write(data);
  }

  reply(id: unknown, result: unknown, error: unknown = null): void {
    this.send({ id, result, error });
  }

  notify(params: unknown[] = EXAMPLE_JOB): void {
    this.send({ id: null, method: 'mining.notify', params });
  }

  setDifficulty(diff: unknown): void {
    this.send({ id: null, method: 'mining.set_difficulty', params: [diff] });
  }

  setExtranonce(xnonce1: string, size: number): void {
    this.send({ id: null, method: 'mining.set_extranonce', params: [xnonce1, size] });
  }

  reconnect(host: string, port: number | string): void {
    this.send({ id: null, method: 'client.reconnect', params: [host, port] });
  }

  /** Sends a request to the client and resolves with its reply (the message with that id and no method). */
  request(method: string, params: unknown[] = [], id: unknown = this.nextId++): Promise<any> {
    const reply = this.pool.waitFor(
      (r) => r.conn === this && r.msg?.id === id && r.msg.method === undefined,
      WAIT_MS,
      `the reply to ${method}`,
    );
    this.send({ id, method, params });
    return reply.then((r) => r.msg);
  }

  drop(): void {
    this.socket.destroy();
  }
}

export class MockPool {
  readonly host = '127.0.0.1';
  readonly port: number;
  readonly tls: boolean;
  extranonce1: string;
  extranonce2Size: number;
  sessionId: string | null;
  readonly connections: MockConnection[] = [];
  readonly received: Received[] = [];
  /** Replies by method; replace entries (or use handle()) to script the pool. */
  readonly handlers: Record<string, Handler> = {
    'mining.subscribe': () => ({ result: this.subscribeResult() }),
    'mining.authorize': () => ({ result: true }),
    'mining.extranonce.subscribe': () => ({ result: true }),
    'mining.submit': () => ({ result: true }),
  };
  private readonly server: Server;
  private readonly messageWaiters = new Set<Waiter<Received>>();
  private readonly connectionWaiters = new Set<Waiter<MockConnection>>();

  private constructor(server: Server, port: number, options: MockPoolOptions) {
    this.server = server;
    this.port = port;
    this.tls = options.tls ?? false;
    this.extranonce1 = options.extranonce1 ?? 'f8002c90';
    this.extranonce2Size = options.extranonce2Size ?? 4;
    this.sessionId = options.sessionId === undefined ? 's1' : options.sessionId;
  }

  static async start(options: MockPoolOptions = {}): Promise<MockPool> {
    let pool: MockPool | null = null;
    const onSocket = (socket: Socket) => pool?.accept(socket);
    const server = options.tls
      ? createTlsServer({ key: TEST_KEY, cert: TEST_CERT }, onSocket)
      : createServer(onSocket);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('mock pool: no address');
    pool = new MockPool(server, address.port, options);
    return pool;
  }

  get url(): string {
    return `${this.tls ? 'stratum+ssl' : 'stratum+tcp'}://${this.host}:${this.port}`;
  }

  /** host:port, as the bridge's allowlist wants it. */
  get target(): string {
    return `${this.host}:${this.port}`;
  }

  /** The most recent connection that is still open. */
  get current(): MockConnection {
    const conn = this.connections.findLast((c) => !c.isClosed);
    if (!conn) throw new Error('mock pool: no open connection');
    return conn;
  }

  subscribeResult(sessionId: string | null = this.sessionId): unknown[] {
    const subscriptions = sessionId === null ? [] : [['mining.set_difficulty', 'd1'], ['mining.notify', sessionId]];
    return [subscriptions, this.extranonce1, this.extranonce2Size];
  }

  handle(method: string, handler: Handler): this {
    this.handlers[method] = handler;
    return this;
  }

  // Shortcuts to the current connection.
  send(msg: object | string): void {
    this.current.send(msg);
  }
  notify(params: unknown[] = EXAMPLE_JOB): void {
    this.current.notify(params);
  }
  setDifficulty(diff: unknown): void {
    this.current.setDifficulty(diff);
  }
  setExtranonce(xnonce1: string, size: number): void {
    this.current.setExtranonce(xnonce1, size);
  }
  reconnect(host: string, port: number | string): void {
    this.current.reconnect(host, port);
  }
  request(method: string, params: unknown[] = [], id?: unknown): Promise<any> {
    return id === undefined ? this.current.request(method, params) : this.current.request(method, params, id);
  }

  /** Messages received with this method, in order. */
  messages(method: string): any[] {
    return this.received.filter((r) => r.msg?.method === method).map((r) => r.msg);
  }

  waitFor(test: (r: Received) => boolean, timeoutMs = WAIT_MS, what = 'a message'): Promise<Received> {
    return waitIn(this.received, this.messageWaiters, test, timeoutMs, what);
  }

  /** The n-th (1-based) message with this method, across all connections. */
  async waitForMethod(method: string, n = 1, timeoutMs = WAIT_MS): Promise<any> {
    let seen = 0;
    const r = await this.waitFor((x) => x.msg?.method === method && ++seen === n, timeoutMs, `${method} #${n}`);
    return r.msg;
  }

  waitForConnection(n = 1, timeoutMs = WAIT_MS): Promise<MockConnection> {
    return waitIn(this.connections, this.connectionWaiters, (c) => c.index === n, timeoutMs, `connection #${n}`);
  }

  dropAll(): void {
    for (const conn of this.connections) conn.drop();
  }

  async close(): Promise<void> {
    for (const waiters of [this.messageWaiters, this.connectionWaiters] as Set<Waiter<any>>[]) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('mock pool closed'));
      }
      waiters.clear();
    }
    this.dropAll();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    const conn = new MockConnection(this, this.connections.length + 1, socket);
    this.connections.push(conn);
    socket.on('error', () => {});
    socket.setNoDelay(true);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.trim()) this.receive(conn, line);
      }
    });
    offer(this.connectionWaiters, conn);
  }

  private receive(conn: MockConnection, line: string): void {
    let msg: any = null;
    try {
      msg = JSON.parse(line);
    } catch {
      // recorded as null
    }
    const record: Received = { conn, msg, line };
    this.received.push(record);
    conn.received.push(msg);
    const handler = typeof msg?.method === 'string' ? this.handlers[msg.method] : undefined;
    const reply = handler?.(msg, conn);
    if (typeof reply === 'string') conn.send(reply);
    else if (reply) conn.send({ id: msg.id ?? null, result: reply.result ?? null, error: reply.error ?? null });
    offer(this.messageWaiters, record);
  }
}
