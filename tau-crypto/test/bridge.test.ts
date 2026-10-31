// Bridge tests: Node's WebSocket and a raw RFC 6455 client -> bridge -> mock pool,
// all on 127.0.0.1.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { EXAMPLE_JOB, MockPool } from './mock-pool.ts';
import {
  createBridge,
  parseBridgeArgs,
  runBridgeCli,
  type Bridge,
  type BridgeConnection,
  type BridgeOptions,
} from '../src/bridge/node.ts';
import { createStratumClient } from '../src/stratum/index.ts';
import type { StratumClient } from '../src/types.ts';

const SUBMIT = '{"method": "mining.submit", "params": ["user", "bf", "00000000", "504e86b9", "9962e301"], "id":4}';
const OP = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await sleep(5);
  }
}

async function setup(t: TestContext, options: Partial<BridgeOptions> = {}, tls = false) {
  const pool = await MockPool.start({ tls });
  t.after(() => pool.close());
  const logs: string[] = [];
  const bridge = await createBridge({
    port: 0,
    host: '127.0.0.1',
    allow: [pool.target],
    log: (line) => logs.push(line),
    ...options,
  });
  t.after(() => bridge.close());
  return { pool, bridge, logs, base: `ws://127.0.0.1:${bridge.port}` };
}

const targetPath = (target: string, tls = 0) => `/?target=${encodeURIComponent(target)}&tls=${tls}`;

function stratum(t: TestContext, url: string, bridge: string): StratumClient {
  const c = createStratumClient({ url, user: 'worker', pass: 'x', bridge, retryPauseMs: 20 });
  t.after(() => c.close());
  return c;
}

// ------------------------------------------------------- raw WebSocket client

interface ServerFrame {
  fin: boolean;
  opcode: number;
  /** 7-bit length field: <126, 126 (16-bit) or 127 (64-bit). */
  lengthCode: number;
  payload: Buffer;
}

/** A hand-rolled client, to send exactly the frames a test needs. */
class RawWs {
  readonly socket: Socket;
  readonly response: Promise<{ status: number; headers: Record<string, string> }>;
  readonly closed: Promise<void>;
  private buffer = Buffer.alloc(0);
  private status = 0;
  private frames: ServerFrame[] = [];
  private wake: (() => void) | null = null;
  private onResponse!: (r: { status: number; headers: Record<string, string> }) => void;

  private constructor(socket: Socket) {
    this.socket = socket;
    this.response = new Promise((resolve) => (this.onResponse = resolve));
    this.closed = new Promise((resolve) => socket.on('close', () => resolve()));
    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => this.data(chunk));
  }

  /** Sends an upgrade request; header values of null drop the default header. */
  static async open(port: number, path: string, headers: Record<string, string | null> = {}): Promise<RawWs> {
    const socket = connect(port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    const all: Record<string, string | null> = {
      Host: `127.0.0.1:${port}`,
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      'Sec-WebSocket-Version': '13',
      ...headers,
    };
    const lines = Object.entries(all).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`);
    const ws = new RawWs(socket);
    socket.write(`GET ${path} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    return ws;
  }

  static async upgraded(port: number, path: string): Promise<RawWs> {
    const ws = await RawWs.open(port, path);
    assert.equal((await ws.response).status, 101);
    return ws;
  }

  send(opcode: number, data: string | Uint8Array, { fin = true, mask = true } = {}): void {
    const payload = Buffer.from(typeof data === 'string' ? Buffer.from(data) : data);
    this.socket.write(Buffer.concat([RawWs.header(opcode, payload.length, fin, mask, payload), payload]));
  }

  /** A frame header claiming `length` bytes, sent without the payload. */
  sendHeader(opcode: number, length: number): void {
    this.socket.write(RawWs.header(opcode, length, true, true, Buffer.alloc(0)));
  }

  /** The next frame (that passes `test`) from the server. */
  async next(test: (f: ServerFrame) => boolean = () => true, ms = 3000): Promise<ServerFrame> {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.frames.findIndex(test);
      if (i >= 0) return this.frames.splice(0, i + 1).pop()!;
      if (Date.now() > end) throw new Error('no such frame from the bridge');
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, 20);
      });
    }
  }

  async closeCode(): Promise<number> {
    const frame = await this.next((f) => f.opcode === OP.close);
    return frame.payload.readUInt16BE(0);
  }

  // Masks `payload` in place (it is a copy).
  private static header(opcode: number, length: number, fin: boolean, mask: boolean, payload: Buffer): Buffer {
    const size = length < 126 ? 2 : length < 65536 ? 4 : 10;
    const header = Buffer.alloc(size + (mask ? 4 : 0));
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = (mask ? 0x80 : 0) | (length < 126 ? length : length < 65536 ? 126 : 127);
    if (size === 4) header.writeUInt16BE(length, 2);
    if (size === 10) header.writeBigUInt64BE(BigInt(length), 2);
    if (mask) {
      const key = randomBytes(4);
      key.copy(header, size);
      for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
    }
    return header;
  }

  private data(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.status) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const [statusLine, ...rest] = this.buffer.subarray(0, end).toString('latin1').split('\r\n');
      this.status = Number(statusLine.split(' ')[1]);
      const headers: Record<string, string> = {};
      for (const line of rest) {
        const colon = line.indexOf(':');
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      this.buffer = this.buffer.subarray(end + 4);
      this.onResponse({ status: this.status, headers });
    }
    if (this.status !== 101) return;
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) break;
      assert.equal(b[1] & 0x80, 0, 'server frames are not masked');
      let length = b[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (b.length < 4) break;
        length = b.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (b.length < 10) break;
        length = Number(b.readBigUInt64BE(2));
        offset = 10;
      }
      if (b.length < offset + length) break;
      this.frames.push({
        fin: (b[0] & 0x80) !== 0,
        opcode: b[0] & 0x0f,
        lengthCode: b[1] & 0x7f,
        payload: b.subarray(offset, offset + length),
      });
      this.buffer = b.subarray(offset + length);
    }
    this.wake?.();
  }
}

// ---------------------------------------------------------------- the flow

test("a stratum client reaches the pool through the bridge with Node's WebSocket", async (t) => {
  const { pool, logs, base } = await setup(t);
  const c = stratum(t, pool.url, base);
  const jobs: unknown[][] = [];
  const diffs: number[] = [];
  c.on('job', (job) => jobs.push(job));
  c.on('difficulty', (d) => diffs.push(d));
  const subscribed = new Promise((resolve) => c.on('subscribed', resolve));
  await c.connect();
  assert.deepEqual(await subscribed, { xnonce1: 'f8002c90', xnonce2Size: 4, sessionId: 's1' });
  assert.ok(logs.some((l) => l.includes(`connected to ${pool.target}`)), 'went through the bridge');
  assert.deepEqual(pool.messages('mining.authorize')[0].params, ['worker', 'x']);
  pool.setDifficulty(2);
  pool.notify(EXAMPLE_JOB);
  await until(() => jobs.length === 1);
  assert.deepEqual(diffs, [2]);
  assert.deepEqual(jobs[0], EXAMPLE_JOB);
  assert.deepEqual(await c.submit(SUBMIT), { accepted: true, reason: null, stale: false });
  pool.handle('mining.submit', () => ({ result: false, error: [21, 'Job not found', null] }));
  assert.deepEqual(await c.submit(SUBMIT), { accepted: false, reason: 'Job not found', stale: true });
  assert.deepEqual(await pool.request('mining.ping', [], 77), { id: 77, result: 'pong', error: null });
  // One WebSocket message per line, so the pool sees exactly the client's lines.
  assert.deepEqual(
    pool.received.map((r) => r.msg.method ?? r.msg.id),
    ['mining.subscribe', 'mining.authorize', 'mining.extranonce.subscribe', 'mining.submit', 'mining.submit', 77],
  );
});

test('the client reconnects through the bridge after the pool drops it', async (t) => {
  const { pool, base } = await setup(t);
  const c = stratum(t, pool.url, base);
  await c.connect();
  await pool.waitForMethod('mining.extranonce.subscribe');
  const disconnected = new Promise((resolve) => c.on('disconnected', resolve));
  pool.dropAll();
  await disconnected;
  await pool.waitForMethod('mining.authorize', 2);
  await until(() => c.connected);
  assert.deepEqual(pool.messages('mining.subscribe')[1].params.slice(1), ['s1']);
});

test('reaches TLS pools with tls=1', async (t) => {
  const { pool, base } = await setup(t, { tlsInsecure: true }, true);
  const c = stratum(t, pool.url, base);
  await c.connect();
  assert.deepEqual(await c.submit(SUBMIT), { accepted: true, reason: null, stale: false });
});

test('an unreachable or unverifiable pool fails the WebSocket handshake with 502', async (t) => {
  const { pool, bridge, base } = await setup(t, {}, true); // TLS pool, certificate not trusted
  const raw = await RawWs.open(bridge.port, targetPath(pool.target, 1));
  assert.equal((await raw.response).status, 502);
  const c = stratum(t, pool.url, base);
  await assert.rejects(c.connect(), /could not reach the pool through the bridge/);
});

// ------------------------------------------------------------- refusals

test('refuses targets that are not allowlisted with 403', async (t) => {
  const { pool, bridge, base } = await setup(t);
  const refused = [
    '/',
    '/?target=',
    targetPath('127.0.0.1:1'),
    targetPath(`localhost:${pool.port}`),
    targetPath(`${pool.target}0`),
    targetPath(`${pool.target}/x`),
    `/?target=${pool.host}`,
  ];
  for (const path of refused) {
    const raw = await RawWs.open(bridge.port, path);
    assert.equal((await raw.response).status, 403, path);
    await raw.closed;
  }
  const c = stratum(t, 'stratum+tcp://127.0.0.1:1', base);
  await assert.rejects(c.connect(), /could not reach the pool through the bridge/);
  assert.equal(pool.connections.length, 0, 'nothing reached the pool');
});

test('refuses a missing or disallowed Origin with 403 when origins are set', async (t) => {
  const { pool, bridge } = await setup(t, { origins: ['https://good.example'] });
  const path = targetPath(pool.target);
  for (const origin of ['https://evil.example', 'https://good.example.evil', null]) {
    const raw = await RawWs.open(bridge.port, path, { Origin: origin });
    assert.equal((await raw.response).status, 403, String(origin));
  }
  const raw = await RawWs.open(bridge.port, path, { Origin: 'https://good.example' });
  assert.equal((await raw.response).status, 101);
  await pool.waitForConnection(1);
});

test('answers 503 beyond maxConnections', async (t) => {
  const { pool, bridge } = await setup(t, { maxConnections: 1 });
  const path = targetPath(pool.target);
  const first = await RawWs.upgraded(bridge.port, path);
  const second = await RawWs.open(bridge.port, path);
  assert.equal((await second.response).status, 503);
  first.socket.destroy();
  await (await pool.waitForConnection(1)).closed;
  await RawWs.upgraded(bridge.port, path);
  await pool.waitForConnection(2);
});

test('rejects invalid handshakes', async (t) => {
  const { pool, bridge } = await setup(t);
  const path = targetPath(pool.target);
  const plain = await RawWs.open(bridge.port, path, { Upgrade: null, Connection: null, 'Sec-WebSocket-Key': null });
  assert.equal((await plain.response).status, 426);
  const version = await RawWs.open(bridge.port, path, { 'Sec-WebSocket-Version': '8' });
  const response = await version.response;
  assert.equal(response.status, 426);
  assert.equal(response.headers['sec-websocket-version'], '13');
  for (const key of [null, 'too-short', '!!!!!!!!!!!!!!!!!!!!!!==']) {
    const raw = await RawWs.open(bridge.port, path, { 'Sec-WebSocket-Key': key });
    assert.equal((await raw.response).status, 400, String(key));
  }
  const tls = await RawWs.open(bridge.port, `/?target=${encodeURIComponent(pool.target)}&tls=yes`);
  assert.equal((await tls.response).status, 400);
  assert.equal(pool.connections.length, 0);
});

test('createBridge validates its allowlist', async () => {
  await assert.rejects(createBridge({ port: 0, allow: [] }), /at least one allowed pool/);
  await assert.rejects(createBridge({ port: 0, allow: ['pool.example.com'] }), /expected host:port/);
  await assert.rejects(createBridge({ port: 0, allow: ['pool.example.com:99999'] }), /expected host:port/);
});

// ---------------------------------------------------------------- frames

test('accepts the handshake per RFC 6455', async (t) => {
  const { pool, bridge } = await setup(t);
  // The example key and accept value from RFC 6455 section 1.3.
  const raw = await RawWs.open(bridge.port, targetPath(pool.target), { 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' });
  const { status, headers } = await raw.response;
  assert.equal(status, 101);
  assert.equal(headers['sec-websocket-accept'], 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  assert.equal(headers.upgrade.toLowerCase(), 'websocket');
  assert.equal(headers.connection.toLowerCase(), 'upgrade');
});

test('relays fragmented and large messages both ways and answers pings', async (t) => {
  const { pool, bridge } = await setup(t);
  const raw = await RawWs.upgraded(bridge.port, targetPath(pool.target));
  const conn = await pool.waitForConnection(1);

  // A text message in three fragments, with a ping between them.
  const fragmented = JSON.stringify({ id: 50, method: 'test.fragmented', params: ['abc'] });
  raw.send(OP.text, fragmented.slice(0, 10), { fin: false });
  raw.send(OP.ping, 'are you there');
  raw.send(OP.continuation, fragmented.slice(10, 20), { fin: false });
  raw.send(OP.continuation, fragmented.slice(20));
  const pong = await raw.next((f) => f.opcode === OP.pong);
  assert.equal(pong.payload.toString(), 'are you there');
  assert.deepEqual(await pool.waitForMethod('test.fragmented'), JSON.parse(fragmented));

  // 16- and 64-bit lengths, a binary message, and a message ending in a newline.
  raw.send(OP.text, JSON.stringify({ id: 51, method: 'test.mid', params: ['m'.repeat(1000)] }));
  raw.send(OP.text, JSON.stringify({ id: 52, method: 'test.big', params: ['b'.repeat(700_000)] }));
  raw.send(OP.binary, JSON.stringify({ id: 53, method: 'test.binary', params: [] }));
  raw.send(OP.text, `${JSON.stringify({ id: 54, method: 'test.newline', params: [] })}\r\n`);
  assert.equal((await pool.waitForMethod('test.mid')).params[0].length, 1000);
  assert.equal((await pool.waitForMethod('test.big')).params[0].length, 700_000);
  await pool.waitForMethod('test.newline');
  assert.deepEqual(conn.received.map((m) => m?.id), [50, 51, 52, 53, 54], 'one line per message');

  // Pool to client: one text frame per line, whatever the TCP chunking.
  conn.write('{"n":1}\n{"n":2}\r\n\n{"n":');
  await sleep(10);
  conn.write('3}\n');
  conn.send({ id: null, method: 'test.down', params: ['d'.repeat(200_000)] });
  const texts: ServerFrame[] = [];
  for (let i = 0; i < 4; i++) texts.push(await raw.next((f) => f.opcode === OP.text));
  assert.deepEqual(texts.slice(0, 3).map((f) => f.payload.toString()), ['{"n":1}', '{"n":2}', '{"n":3}']);
  assert.ok(texts.every((f) => f.fin));
  assert.equal(texts[3].lengthCode, 127);
  assert.equal(JSON.parse(texts[3].payload.toString()).params[0].length, 200_000);
});

test('closes with 1009 on frames or messages over 1 MiB', async (t) => {
  const { pool, bridge } = await setup(t);
  const path = targetPath(pool.target);

  const big = await RawWs.upgraded(bridge.port, path);
  const bigConn = await pool.waitForConnection(1);
  big.sendHeader(OP.text, 2 * 1024 * 1024);
  assert.equal(await big.closeCode(), 1009);
  await bigConn.closed;
  await big.closed;

  const fragments = await RawWs.upgraded(bridge.port, path);
  const fragmentsConn = await pool.waitForConnection(2);
  fragments.send(OP.text, 'x'.repeat(600_000), { fin: false });
  fragments.send(OP.continuation, 'x'.repeat(600_000));
  assert.equal(await fragments.closeCode(), 1009);
  await fragmentsConn.closed;

  // A line over 1 MiB from the pool.
  const down = await RawWs.upgraded(bridge.port, path);
  const downConn = await pool.waitForConnection(3);
  downConn.write('y'.repeat(1024 * 1024 + 1));
  assert.equal(await down.closeCode(), 1009);
  await downConn.closed;
});

test('closes with 1002 on unmasked or malformed frames and 1007 on invalid UTF-8', async (t) => {
  const { pool, bridge } = await setup(t);
  const path = targetPath(pool.target);
  const cases: [string, (ws: RawWs) => void, number][] = [
    ['unmasked', (ws) => ws.send(OP.text, '{}', { mask: false }), 1002],
    ['unknown opcode', (ws) => ws.send(3, 'x'), 1002],
    ['fragmented ping', (ws) => ws.send(OP.ping, 'x', { fin: false }), 1002],
    ['continuation first', (ws) => ws.send(OP.continuation, 'x'), 1002],
    ['text inside a fragmented message', (ws) => (ws.send(OP.text, 'a', { fin: false }), ws.send(OP.text, 'b')), 1002],
    ['invalid UTF-8', (ws) => ws.send(OP.text, new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])), 1007],
  ];
  let n = 0;
  for (const [name, send, code] of cases) {
    const ws = await RawWs.upgraded(bridge.port, path);
    const conn = await pool.waitForConnection(++n);
    send(ws);
    assert.equal(await ws.closeCode(), code, name);
    await conn.closed;
    assert.deepEqual(conn.received, [], `${name}: nothing forwarded`);
  }
});

// ---------------------------------------------------------------- closing

test("closing the pool side closes the WebSocket, and closing the WebSocket closes the pool's", async (t) => {
  const { pool, bridge, base } = await setup(t);
  const url = `${base}${targetPath(pool.target)}`;
  const open = (ws: WebSocket) =>
    new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket failed'));
    });

  const first = new WebSocket(url);
  await open(first);
  const received: string[] = [];
  first.onmessage = (event) => received.push(String(event.data));
  const firstConn = await pool.waitForConnection(1);
  firstConn.send({ id: null, method: 'mining.set_difficulty', params: [3] });
  await until(() => received.length === 1);
  assert.deepEqual(JSON.parse(received[0]), { id: null, method: 'mining.set_difficulty', params: [3] });
  const closed = new Promise<CloseEvent>((resolve) => (first.onclose = resolve));
  firstConn.drop();
  const event = await closed;
  assert.equal(event.code, 1000);
  assert.equal(event.wasClean, true);

  const second = new WebSocket(url);
  await open(second);
  const secondConn = await pool.waitForConnection(2);
  second.send('{"id":9,"method":"test.last","params":[]}');
  second.close(1000);
  await secondConn.closed;
  assert.deepEqual(secondConn.received, [{ id: 9, method: 'test.last', params: [] }], 'flushed before closing');

  // A client that just disappears (no close frame) takes its pool connection with it.
  const raw = await RawWs.upgraded(bridge.port, targetPath(pool.target));
  const rawConn = await pool.waitForConnection(3);
  raw.socket.destroy();
  await rawConn.closed;
});

test('answers a client close frame with a close frame', async (t) => {
  const { pool, bridge } = await setup(t);
  const raw = await RawWs.upgraded(bridge.port, targetPath(pool.target));
  const conn = await pool.waitForConnection(1);
  const payload = Buffer.from([0x0f, 0xa0]); // 4000
  raw.send(OP.close, payload);
  assert.equal(await raw.closeCode(), 4000);
  await raw.closed;
  await conn.closed;
});

test('close() ends every connection', async (t) => {
  const pool = await MockPool.start();
  t.after(() => pool.close());
  const bridge: Bridge = await createBridge({ port: 0, host: '127.0.0.1', allow: [pool.target] });
  const raw = await RawWs.upgraded(bridge.port, targetPath(pool.target));
  const conn = await pool.waitForConnection(1);
  await bridge.close();
  await raw.closed;
  await conn.closed;
  await bridge.close(); // idempotent
});

// -------------------------------------------------------------------- CLI

// ---------------------------------------------------------------- intercept

test('intercept: rewrites, drops and answers lines in both directions', async (t) => {
  let info: BridgeConnection | undefined;
  let closes = 0;
  const { pool, bridge } = await setup(t, {
    intercept: (c) => {
      info = c;
      return {
        fromClient(line) {
          const msg = JSON.parse(line);
          if (msg.method === 'mining.authorize') {
            msg.params[0] = 'owner';
            return JSON.stringify(msg);
          }
          if (msg.method === 'blocked') {
            c.reply(JSON.stringify({ id: msg.id, result: null, error: [20, 'not allowed', null] }));
            return null;
          }
          return line;
        },
        fromPool: (line) => (line.includes('mining.set_difficulty') ? null : line),
        onClose: () => closes++,
      };
    },
  });
  const ws = await RawWs.upgraded(bridge.port, `${targetPath(pool.target)}&client=abc`);
  assert.equal(info?.query.get('client'), 'abc');
  assert.equal(info?.target, pool.target);
  assert.equal(info?.tls, false);
  // Two lines in one message: each goes through the interceptor on its own.
  ws.send(
    OP.text,
    '{"id":1,"method":"mining.subscribe","params":[]}\n{"id":2,"method":"mining.authorize","params":["visitor","x"]}',
  );
  await pool.waitForMethod('mining.authorize');
  assert.deepEqual(pool.messages('mining.authorize')[0].params, ['owner', 'x']);
  ws.send(OP.text, '{"id":3,"method":"blocked","params":[]}');
  const reply = await ws.next((f) => f.payload.toString().includes('not allowed'));
  assert.deepEqual(JSON.parse(reply.payload.toString()), { id: 3, result: null, error: [20, 'not allowed', null] });
  assert.equal(pool.messages('blocked').length, 0);
  pool.setDifficulty(5);
  pool.notify(EXAMPLE_JOB);
  const texts: string[] = [];
  await ws.next((f) => {
    texts.push(f.payload.toString());
    return f.payload.toString().includes('mining.notify');
  });
  assert.ok(!texts.some((x) => x.includes('mining.set_difficulty')), 'the pool line was dropped');
  ws.send(OP.close, Buffer.from([0x03, 0xe8]));
  await ws.closed;
  await until(() => closes === 1);
});

test('intercept: null refuses with 403, a throw with 500, a throwing filter closes with 1011', async (t) => {
  let mode: 'null' | 'throw' | 'filter' = 'null';
  let closes = 0;
  const { pool, bridge } = await setup(t, {
    intercept: () => {
      if (mode === 'null') return null;
      if (mode === 'throw') throw new Error('boom');
      return {
        fromClient: () => {
          throw new Error('bad line');
        },
        onClose: () => closes++,
      };
    },
  });
  assert.equal((await (await RawWs.open(bridge.port, targetPath(pool.target))).response).status, 403);
  mode = 'throw';
  assert.equal((await (await RawWs.open(bridge.port, targetPath(pool.target))).response).status, 500);
  mode = 'filter';
  const ws = await RawWs.upgraded(bridge.port, targetPath(pool.target));
  ws.send(OP.text, '{"id":1,"method":"mining.subscribe","params":[]}');
  assert.equal(await ws.closeCode(), 1011);
  await ws.closed;
  await until(() => closes === 1);
  assert.equal(pool.messages('mining.subscribe').length, 0);
});

test('intercept: close() ends the connection with 1008 and a multi-line result fails it', async (t) => {
  let conn: BridgeConnection | undefined;
  const { pool, bridge } = await setup(t, {
    intercept: (c) => {
      conn = c;
      return { fromClient: (line) => (line.includes('two') ? 'a\nb' : line) };
    },
  });
  const ws = await RawWs.upgraded(bridge.port, targetPath(pool.target));
  conn!.close('bye');
  assert.equal(await ws.closeCode(), 1008);
  await ws.closed;
  const ws2 = await RawWs.upgraded(bridge.port, targetPath(pool.target));
  ws2.send(OP.text, '{"id":1,"method":"two"}');
  assert.equal(await ws2.closeCode(), 1011);
  assert.equal(pool.messages('two').length, 0);
});

test('intercept: async methods keep each direction in order', async (t) => {
  const { pool, bridge } = await setup(t, {
    intercept: () => ({
      async fromClient(line) {
        const msg = JSON.parse(line);
        await sleep(msg.id === 1 ? 30 : 1); // the first line is the slowest
        if (msg.method === 'mining.authorize') msg.params[0] = 'owner';
        return JSON.stringify(msg);
      },
      fromPool: async (line) => (line.includes('mining.set_difficulty') ? null : line),
    }),
  });
  const ws = await RawWs.upgraded(bridge.port, targetPath(pool.target));
  ws.send(OP.text, '{"id":1,"method":"mining.subscribe","params":[]}');
  ws.send(OP.text, '{"id":2,"method":"mining.authorize","params":["visitor","x"]}');
  await pool.waitForMethod('mining.authorize');
  assert.deepEqual(pool.received.map((r) => r.msg.id), [1, 2]);
  assert.deepEqual(pool.messages('mining.authorize')[0].params, ['owner', 'x']);
  pool.setDifficulty(5);
  pool.notify(EXAMPLE_JOB);
  const texts: string[] = [];
  await ws.next((f) => {
    texts.push(f.payload.toString());
    return f.payload.toString().includes('mining.notify');
  });
  assert.ok(!texts.some((x) => x.includes('mining.set_difficulty')));
});

test('attaches to an existing http server, which keeps its own routes', async (t) => {
  const pool = await MockPool.start();
  t.after(() => pool.close());
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end('app route');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const bridge = await createBridge({ server, allow: [pool.target] });
  const port = (server.address() as { port: number }).port;
  assert.equal(bridge.port, port);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/payout`)).text(), 'app route');
  const c = stratum(t, pool.url, `ws://127.0.0.1:${port}`);
  await c.connect();
  assert.deepEqual(pool.messages('mining.authorize')[0].params, ['worker', 'x']);
  c.close();
  await bridge.close(); // detaches; the app's server keeps serving
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/x`)).text(), 'app route');
});

test('parseBridgeArgs reads the CLI options', () => {
  assert.deepEqual(
    parseBridgeArgs([
      'bridge',
      '--listen',
      '8080',
      '--allow',
      'pool.example.com:3333,10.0.0.1:443',
      '--allow=other.example:1',
      '--origin',
      'https://a.example,https://b.example',
      '--max-connections',
      '10',
      '--tls-insecure',
    ]),
    {
      port: 8080,
      allow: ['pool.example.com:3333', '10.0.0.1:443', 'other.example:1'],
      origins: ['https://a.example', 'https://b.example'],
      maxConnections: 10,
      tlsInsecure: true,
    },
  );
  assert.deepEqual(parseBridgeArgs(['--listen=127.0.0.1:9000', '--allow', 'p:1']), {
    port: 9000,
    host: '127.0.0.1',
    allow: ['p:1'],
  });
  assert.deepEqual(parseBridgeArgs(['--listen', '[::1]:9000', '--allow', 'p:1']), { port: 9000, host: '::1', allow: ['p:1'] });
  assert.equal(parseBridgeArgs(['--help']), null);
  assert.throws(() => parseBridgeArgs(['--allow', 'p:1']), /--listen is required/);
  assert.throws(() => parseBridgeArgs(['--listen', '8080']), /--allow is required/);
  assert.throws(() => parseBridgeArgs(['--listen', '8080', '--allow', 'nope']), /invalid --allow entry "nope"/);
  assert.throws(() => parseBridgeArgs(['--listen', 'x', '--allow', 'p:1']), /invalid --listen/);
  assert.throws(() => parseBridgeArgs(['--listen', '8080', '--allow']), /--allow needs a value/);
  assert.throws(() => parseBridgeArgs(['--listen', '8080', '--allow', 'p:1', '--max-connections', '0']), /positive integer/);
  assert.throws(() => parseBridgeArgs(['--listen', '8080', '--allow', 'p:1', '--open-proxy']), /unknown option --open-proxy/);
});

test('runBridgeCli rejects invalid arguments', async () => {
  await assert.rejects(runBridgeCli(['bridge', '--listen', '0']), /--allow is required/);
});
