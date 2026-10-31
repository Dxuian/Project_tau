// The Cloudflare Workers bridge (bridge/worker.ts) with the Workers runtime
// pieces faked: WebSocketPair in memory, connect() over node:net to the mock pool.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { connect as netConnect } from 'node:net';
import { Readable, Writable } from 'node:stream';
import { EXAMPLE_JOB, MockPool } from './mock-pool.ts';
import { createWorkerBridge, type WorkerBridgeOptions, type WorkerSocket } from '../bridge/worker.ts';
import { createStratumClient } from '../src/stratum/index.ts';
import { wsTransport } from '../src/stratum/transport-ws.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await sleep(5);
  }
}

/** One end of an in-memory WebSocketPair (Workers API on the server end, browser-style handlers too). */
class FakeEnd {
  peer!: FakeEnd;
  closed = false;
  closeEvent: { code: number; reason: string } | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  private listeners = new Map<string, ((e: any) => void)[]>();
  accept() {}
  addEventListener(type: string, fn: (e: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, event: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    if (type === 'message') this.onmessage?.(event);
    if (type === 'close') this.onclose?.(event);
  }
  send(data: string) {
    if (this.closed) throw new Error('closed');
    const peer = this.peer;
    setImmediate(() => !peer.closed && peer.emit('message', { data }));
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    const peer = this.peer;
    setImmediate(() => {
      if (peer.closed) return;
      peer.closed = true;
      peer.closeEvent = { code, reason };
      peer.emit('close', { code, reason });
    });
  }
}

class FakePair {
  0: FakeEnd;
  1: FakeEnd;
  constructor() {
    const a = new FakeEnd();
    const b = new FakeEnd();
    a.peer = b;
    b.peer = a;
    this[0] = a;
    this[1] = b;
  }
}

/** Workers' connect() over node:net. */
function tcpConnect({ hostname, port }: { hostname: string; port: number }): WorkerSocket {
  const sock = netConnect({ host: hostname, port });
  sock.on('error', () => {});
  const opened = new Promise((resolve, reject) => {
    sock.once('connect', () => resolve({}));
    sock.once('error', reject);
  });
  return {
    readable: Readable.toWeb(sock) as unknown as ReadableStream<Uint8Array>,
    writable: Writable.toWeb(sock) as unknown as WritableStream<Uint8Array>,
    opened,
    close: () => sock.destroy(),
  };
}

type Handler = { fetch(request: Request): Promise<Response> };

/** A browser-style WebSocket class whose connections go to the Worker's fetch handler. */
function webSocketFor(worker: Handler, headers: Record<string, string> = {}) {
  return class {
    binaryType = 'blob';
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: ((e: { code: number; reason: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    private end: FakeEnd | null = null;
    constructor(url: string) {
      worker.fetch(new Request(url.replace(/^ws/, 'http'), { headers: { upgrade: 'websocket', ...headers } })).then((res: any) => {
        if (res.status !== 101) return this.onclose?.({ code: 1006, reason: `HTTP ${res.status}` });
        this.end = res.webSocket as FakeEnd;
        this.end.onmessage = (e) => this.onmessage?.(e);
        this.end.onclose = (e) => this.onclose?.(e);
        this.onopen?.();
      });
    }
    send(data: string) {
      this.end?.send(data);
    }
    close(code?: number) {
      this.end?.close(code);
    }
  };
}

async function setup(t: TestContext, options: Partial<WorkerBridgeOptions> = {}) {
  const pool = await MockPool.start();
  t.after(() => pool.close());
  const logs: string[] = [];
  const worker = createWorkerBridge({
    allow: [pool.target],
    connect: tcpConnect,
    WebSocketPair: FakePair as never,
    upgradeResponse: (client) => ({ status: 101, webSocket: client }) as unknown as Response,
    log: (l) => logs.push(l),
    ...options,
  });
  return { pool, worker, logs };
}

const upgrade = (worker: Handler, path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`http://worker.test${path}`, { headers: { upgrade: 'websocket', ...headers } }));
const targetPath = (target: string, tls = 0) => `/?target=${encodeURIComponent(target)}&tls=${tls}`;

test('a stratum client reaches the pool through the Worker bridge', async (t) => {
  const { pool, worker, logs } = await setup(t);
  const client = createStratumClient({
    url: pool.url,
    user: 'worker',
    pass: 'x',
    transport: wsTransport({ bridge: 'ws://worker.test', WebSocket: webSocketFor(worker) as never }),
    retryPauseMs: 20,
  });
  t.after(() => client.close());
  const jobs: unknown[][] = [];
  client.on('job', (job) => jobs.push(job));
  await client.connect();
  assert.ok(logs.some((l) => l.includes(`connected to ${pool.target}`)));
  assert.deepEqual(pool.messages('mining.authorize')[0].params, ['worker', 'x']);
  pool.notify(EXAMPLE_JOB);
  await until(() => jobs.length === 1);
  assert.deepEqual(jobs[0], EXAMPLE_JOB);
  const submit = '{"method": "mining.submit", "params": ["worker", "bf", "00000000", "504e86b9", "9962e301"], "id":4}';
  assert.deepEqual(await client.submit(submit), { accepted: true, reason: null, stale: false });
});

test('refuses what the Node bridge refuses', async (t) => {
  let mode: 'null' | 'throw' | 'ok' = 'ok';
  const { pool, worker } = await setup(t, {
    origins: ['https://site.example'],
    maxConnections: 1,
    intercept: () => {
      if (mode === 'null') return null;
      if (mode === 'throw') throw new Error('boom');
      return {};
    },
  });
  const ok = { origin: 'https://site.example' };
  assert.equal((await worker.fetch(new Request('http://worker.test/'))).status, 426);
  assert.equal((await upgrade(worker, targetPath(pool.target))).status, 403, 'no origin');
  assert.equal((await upgrade(worker, targetPath(pool.target), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await upgrade(worker, targetPath('evil.example:3333'), ok)).status, 403);
  assert.equal((await upgrade(worker, `${targetPath(pool.target)}`.replace('tls=0', 'tls=2'), ok)).status, 400);
  mode = 'null';
  assert.equal((await upgrade(worker, targetPath(pool.target), ok)).status, 403);
  mode = 'throw';
  assert.equal((await upgrade(worker, targetPath(pool.target), ok)).status, 500);
  mode = 'ok';
  const first: any = await upgrade(worker, targetPath(pool.target), ok);
  assert.equal(first.status, 101);
  assert.equal((await upgrade(worker, targetPath(pool.target), ok)).status, 503, 'maxConnections');
  first.webSocket.close(1000);
  await sleep(20);
  assert.equal((await upgrade(worker, targetPath(pool.target), ok)).status, 101, 'a slot freed up');
});

test('answers 502 when the pool is unreachable', async (t) => {
  const { pool, worker } = await setup(t);
  await pool.close();
  const res = await upgrade(worker, targetPath(pool.target));
  assert.equal(res.status, 502);
  assert.match(await res.text(), /could not connect/);
});

test('async interceptors keep each direction in order', async (t) => {
  let closes = 0;
  const { pool, worker } = await setup(t, {
    intercept: (c) => ({
      async fromClient(line) {
        const msg = JSON.parse(line);
        await sleep(msg.id === 1 ? 30 : 1); // the first line is the slowest
        if (msg.method === 'blocked') {
          c.reply(JSON.stringify({ id: msg.id, result: null, error: [20, 'not allowed', null] }));
          return null;
        }
        if (msg.method === 'mining.authorize') msg.params[0] = 'owner';
        return JSON.stringify(msg);
      },
      fromPool: async (line) => (line.includes('mining.set_difficulty') ? null : line),
      onClose: () => closes++,
    }),
  });
  const res: any = await upgrade(worker, targetPath(pool.target));
  const end: FakeEnd = res.webSocket;
  const received: string[] = [];
  end.onmessage = (e) => received.push(String(e.data));
  end.send('{"id":1,"method":"mining.subscribe","params":[]}\n{"id":2,"method":"mining.authorize","params":["visitor","x"]}');
  end.send('{"id":3,"method":"blocked","params":[]}');
  await pool.waitForMethod('mining.authorize');
  assert.deepEqual(pool.received.map((r) => r.msg.id), [1, 2], 'in order despite the slower first line');
  assert.deepEqual(pool.messages('mining.authorize')[0].params, ['owner', 'x']);
  await until(() => received.some((m) => m.includes('not allowed')));
  pool.setDifficulty(5);
  pool.notify(EXAMPLE_JOB);
  await until(() => received.some((m) => m.includes('mining.notify')));
  assert.ok(!received.some((m) => m.includes('mining.set_difficulty')));
  end.close(1000);
  await until(() => closes === 1);
});

test('closing either side closes the other; a throwing interceptor closes with 1011', async (t) => {
  const { pool, worker } = await setup(t, { intercept: () => ({ fromClient: (l) => (l.includes('bad') ? Promise.reject(new Error('no')) : l) }) });
  const a: any = await upgrade(worker, targetPath(pool.target));
  await until(() => pool.connections.length === 1);
  pool.dropAll();
  await until(() => a.webSocket.closed);
  assert.equal(a.webSocket.closeEvent.code, 1000);
  const b: any = await upgrade(worker, targetPath(pool.target));
  b.webSocket.send('{"id":1,"method":"bad"}');
  await until(() => b.webSocket.closed);
  assert.equal(b.webSocket.closeEvent.code, 1011);
  assert.equal(pool.messages('bad').length, 0);
});
