// Stratum client tests against the mock pool (127.0.0.1 only).
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { EXAMPLE_JOB, MockPool } from './mock-pool.ts';
import {
  DEFAULT_USER_AGENT as UA,
  LineDecoder,
  MAX_LINE_BYTES,
  createStratumClient,
  defaultTransport,
  nodeTransport,
  parseStratumUrl,
  type StratumClientOptions,
} from '../src/stratum/index.ts';
import type { StratumClient, StratumEvents, Transport } from '../src/types.ts';

const SUBMIT = '{"method": "mining.submit", "params": ["user", "jobid", "00000000", "4966bc61", "9962e301"], "id":4}';
const EVENTS = [
  'subscribed',
  'authorized',
  'difficulty',
  'job',
  'extranonce',
  'message',
  'disconnected',
  'reconnecting',
  'error',
  'log',
] as const;

type Recorded = { [K in keyof StratumEvents]: { name: K; value: StratumEvents[K] } }[keyof StratumEvents];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every event the client emits from now on, in order. */
function record(client: StratumClient): Recorded[] {
  const events: Recorded[] = [];
  for (const name of EVENTS) client.on(name, (value) => events.push({ name, value } as Recorded));
  return events;
}

const names = (events: Recorded[]) => events.map((e) => e.name).filter((n) => n !== 'log');
const values = <K extends keyof StratumEvents>(events: Recorded[], name: K) =>
  events.filter((e) => e.name === name).map((e) => e.value as StratumEvents[K]);

function nextEvent<K extends keyof StratumEvents>(client: StratumClient, name: K, ms = 3000): Promise<StratumEvents[K]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${name}`));
    }, ms);
    const off = client.on(name, (value) => {
      clearTimeout(timer);
      off();
      resolve(value);
    });
  });
}

async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await sleep(5);
  }
}

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function client(t: TestContext, options: Partial<StratumClientOptions> & { url: string }): StratumClient {
  const c = createStratumClient({ user: 'worker', pass: 'x', retryPauseMs: 20, ...options });
  t.after(() => c.close());
  return c;
}

/** Connected, with the optional extranonce.subscribe exchange done, so the pool has nothing left to say. */
async function settled(pool: MockPool, c: StratumClient): Promise<void> {
  await c.connect();
  await pool.waitForMethod('mining.extranonce.subscribe');
}

async function setup(t: TestContext, options: Partial<StratumClientOptions> = {}) {
  const pool = await MockPool.start();
  t.after(() => pool.close());
  return { pool, client: client(t, { url: pool.url, ...options }) };
}

// ------------------------------------------------------------------- URLs

test('parseStratumUrl accepts the stratum schemes and bare host:port', () => {
  const tcp = { scheme: 'stratum+tcp', host: 'pool.example.com', port: 3333, tls: false };
  assert.deepEqual(parseStratumUrl('stratum+tcp://pool.example.com:3333'), tcp);
  assert.deepEqual(parseStratumUrl('pool.example.com:3333'), tcp);
  assert.deepEqual(parseStratumUrl('  STRATUM+TCP://pool.example.com:3333/  '), tcp);
  assert.deepEqual(parseStratumUrl('stratum+tcp://user:pass@pool.example.com:3333'), tcp);
  assert.deepEqual(parseStratumUrl('stratum+ssl://pool.example.com:443'), {
    scheme: 'stratum+ssl',
    host: 'pool.example.com',
    port: 443,
    tls: true,
  });
  assert.deepEqual(parseStratumUrl('stratum+tcps://10.0.0.1:65535'), {
    scheme: 'stratum+tcps',
    host: '10.0.0.1',
    port: 65535,
    tls: true,
  });
  assert.deepEqual(parseStratumUrl('stratum+tcp://[2001:db8::1]:3333'), {
    scheme: 'stratum+tcp',
    host: '2001:db8::1',
    port: 3333,
    tls: false,
  });
});

test('parseStratumUrl rejects other schemes and malformed URLs', () => {
  for (const url of ['http://pool:3333', 'https://pool:443', 'ws://pool:80', 'stratum+udp://pool:3333', 'tcp://pool:1']) {
    assert.throws(() => parseStratumUrl(url), /unsupported pool URL .* use stratum\+tcp:\/\//, url);
  }
  const malformed = [
    '',
    'pool.example.com',
    'stratum+tcp://pool',
    'stratum+tcp://:3333',
    'stratum+tcp://pool:0',
    'stratum+tcp://pool:65536',
    'stratum+tcp://pool:x1',
    'stratum+tcp://po ol:1',
  ];
  for (const url of malformed) {
    assert.throws(() => parseStratumUrl(url), /invalid pool URL/, url);
  }
  assert.throws(() => createStratumClient({ url: 'http://pool:80', user: 'u', pass: 'p' }), /unsupported pool URL/);
});

test('LineDecoder splits lines, drops CR and blank lines, and caps line length', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const d = new LineDecoder(8);
  assert.deepEqual(d.push(bytes('a\r\n\n\r\n  \nb')), ['a']);
  assert.deepEqual(d.push(bytes('c\nd')), ['bc']);
  const euro = bytes('€\n');
  assert.deepEqual(d.push(euro.subarray(0, 2)), []);
  assert.deepEqual(d.push(euro.subarray(2)), ['d€']);
  assert.deepEqual(d.push(bytes('12345678\n')), ['12345678']);
  assert.throws(() => d.push(bytes('123456789')), RangeError, 'a partial line over the limit');
  const e = new LineDecoder(8);
  assert.throws(() => e.push(bytes('123456789\n')), RangeError, 'a complete line over the limit');
  assert.deepEqual(e.push(bytes('ok\n')), ['ok'], 'usable again after the error');
});

test('defaultTransport: a bridge wins, Node gets TCP, browsers without a bridge get a clear error', () => {
  assert.equal(typeof defaultTransport({}, 'node'), 'function');
  assert.equal(typeof defaultTransport({ bridge: 'ws://127.0.0.1:1' }, 'browser'), 'function');
  assert.throws(() => defaultTransport({}, 'browser'), /run a bridge .*cpuminer-js bridge/);
  assert.throws(() => defaultTransport({}, 'worker'), /bridge/);
});

test('a custom transport gets the normalized URL', async (t) => {
  const urls: string[] = [];
  let fake!: Transport & { sent: string[] };
  const c = client(t, {
    url: 'pool.example.com:3333',
    transport: (url) => {
      urls.push(url);
      fake = {
        sent: [],
        onLine: null,
        onClose: null,
        connect: async () => {},
        send(line) {
          this.sent.push(line);
        },
        close() {},
      };
      return fake;
    },
  });
  const connecting = c.connect();
  await until(() => fake?.sent.length === 1);
  assert.deepEqual(urls, ['stratum+tcp://pool.example.com:3333']);
  fake.onLine!('{"id":1,"result":[[],"00",2],"error":null}');
  fake.onLine!('{"id":2,"result":true,"error":null}');
  await connecting;
  assert.deepEqual(
    fake.sent.map((l) => JSON.parse(l).method),
    ['mining.subscribe', 'mining.authorize', 'mining.extranonce.subscribe'],
  );
});

// -------------------------------------------------------------- handshake

test('subscribes, authorizes, then subscribes to extranonce', async (t) => {
  const { pool, client: c } = await setup(t);
  const events = record(c);
  assert.equal(c.connected, false);
  await c.connect();
  assert.equal(c.connected, true);
  await pool.waitForMethod('mining.extranonce.subscribe');
  assert.deepEqual(
    pool.received.map((r) => r.line),
    [
      `{"id":1,"method":"mining.subscribe","params":["${UA}"]}`,
      '{"id":2,"method":"mining.authorize","params":["worker","x"]}',
      '{"id":3,"method":"mining.extranonce.subscribe","params":[]}',
    ],
  );
  assert.deepEqual(names(events), ['subscribed', 'authorized']);
  assert.deepEqual(values(events, 'subscribed'), [{ xnonce1: 'f8002c90', xnonce2Size: 4, sessionId: 's1' }]);
  assert.deepEqual(values(events, 'authorized'), [{ user: 'worker' }]);
  assert.ok(values(events, 'log').some((l) => /authorized/.test(l)));
  assert.equal(await c.connect(), undefined, 'connect() again returns the same settled promise');
  assert.equal(pool.connections.length, 1);
});

test('resubscribes with the previous session id after a reconnect', async (t) => {
  const { pool, client: c } = await setup(t);
  await c.connect();
  pool.sessionId = 's2';
  let next = nextEvent(c, 'subscribed');
  pool.dropAll();
  assert.equal((await next).sessionId, 's2');
  pool.sessionId = null;
  next = nextEvent(c, 'subscribed');
  pool.dropAll();
  assert.equal((await next).sessionId, null);
  next = nextEvent(c, 'subscribed');
  pool.dropAll();
  await next;
  assert.deepEqual(
    pool.messages('mining.subscribe').map((m) => m.params),
    [[UA], [UA, 's1'], [UA, 's2'], [UA]],
  );
});

test('retries mining.subscribe with no params when the pool rejects them', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.subscribe', (msg) =>
    msg.params.length ? { error: [20, 'Unsupported params', null] } : { result: pool.subscribeResult() },
  );
  await c.connect();
  assert.deepEqual(pool.messages('mining.subscribe').map((m) => [m.id, m.params]), [[1, [UA]], [1, []]]);
});

test('a subscribe that fails twice (false result) fails the attempt', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.subscribe', () => ({ result: false }));
  await assert.rejects(c.connect(), /mining.subscribe failed/);
  assert.deepEqual(pool.messages('mining.subscribe').map((m) => m.params), [[UA], []]);
});

test('reads the session id from a list of subscriptions, a single pair, or none', async (t) => {
  const cases: [unknown, string | null][] = [
    [[['mining.set_difficulty', 'd'], ['mining.notify', 'abc']], 'abc'],
    [['mining.notify', 'single'], 'single'],
    [[['MINING.NOTIFY', 'upper']], 'upper'],
    [[['mining.set_difficulty', 'd']], null],
    [[], null],
    [null, null],
  ];
  for (const [subscriptions, sessionId] of cases) {
    const { pool, client: c } = await setup(t);
    pool.handle('mining.subscribe', () => ({ result: [subscriptions, 'AABB', 8] }));
    const subscribed = nextEvent(c, 'subscribed');
    await c.connect();
    assert.deepEqual(await subscribed, { xnonce1: 'AABB', xnonce2Size: 8, sessionId }, JSON.stringify(subscriptions));
  }
});

test('an invalid extranonce1 or extranonce2 size fails the attempt', async (t) => {
  const invalid = [['f8002c90', 1], ['f8002c90', 17], ['f8002c90', '4'], ['f8002c90', 4.5], ['f80', 4], [42, 4]];
  for (const [xnonce1, size] of invalid) {
    const { pool, client: c } = await setup(t);
    pool.handle('mining.subscribe', () => ({ result: [[], xnonce1, size] }));
    await assert.rejects(c.connect(), /mining.subscribe failed/, `${xnonce1} ${size}`);
  }
});

test('processes notify and set_difficulty sent before the authorize reply, in order', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.authorize', (_msg, conn) => {
    conn.setDifficulty(16);
    conn.notify(EXAMPLE_JOB);
    conn.setDifficulty(32);
    return { result: true };
  });
  const events = record(c);
  await c.connect();
  assert.deepEqual(names(events), ['subscribed', 'difficulty', 'job', 'difficulty', 'authorized']);
  assert.deepEqual(values(events, 'difficulty'), [16, 32]);
  assert.deepEqual(values(events, 'job'), [EXAMPLE_JOB]);
});

test('holds back methods sent before the subscribe reply until after subscribed', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.subscribe', (_msg, conn) => {
    conn.setDifficulty(8);
    conn.notify(EXAMPLE_JOB);
    return { result: pool.subscribeResult() };
  });
  const events = record(c);
  await c.connect();
  assert.deepEqual(names(events), ['subscribed', 'difficulty', 'job', 'authorized']);
});

test('JSON-escapes the user name and password', async (t) => {
  const user = 'bc1q"we\\ird".worker\u0001';
  const pass = 'p"a}s,s\nd=1';
  const { pool, client: c } = await setup(t, { user, pass });
  await c.connect();
  const line = pool.received.find((r) => r.msg?.method === 'mining.authorize')!.line;
  assert.ok(!line.includes('\n'));
  assert.deepEqual(JSON.parse(line).params, [user, pass]);
});

test('a rejected authorization fails the first connect and does not retry', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.authorize', () => ({ result: false, error: [24, 'Unauthorized worker', null] }));
  const events = record(c);
  await assert.rejects(c.connect(), /authorization failed: Unauthorized worker/);
  assert.equal(c.connected, false);
  await sleep(100); // five retry pauses
  assert.equal(pool.connections.length, 1);
  // It got as far as subscribing, so the subscription ends with disconnected.
  assert.deepEqual(names(events), ['subscribed', 'disconnected']);
});

test('authorization needs a result that is not false and no error', async (t) => {
  const bad = ['{"id":2,"error":null}', { result: true, error: { code: 24, message: 'nope' } }, { result: false }];
  for (const reply of bad) {
    const { pool, client: c } = await setup(t);
    pool.handle('mining.authorize', () => reply);
    await assert.rejects(c.connect(), /authorization failed/, JSON.stringify(reply));
  }
  // Upstream accepts a null result without an error.
  const { pool, client: c } = await setup(t);
  pool.handle('mining.authorize', () => ({ result: null, error: null }));
  await c.connect();
});

test('a subscribe or authorize reply that never comes times out', async (t) => {
  const { pool, client: c } = await setup(t, { requestTimeoutMs: 50 });
  pool.handle('mining.authorize', () => null);
  await assert.rejects(c.connect(), /no reply to mining.authorize within 0.05 s/);
});

test('carries on without waiting when mining.extranonce.subscribe gets no reply', async (t) => {
  const { pool, client: c } = await setup(t, { extranonceTimeoutMs: 30 });
  pool.handle('mining.extranonce.subscribe', () => null);
  const logs: string[] = [];
  c.on('log', (l) => logs.push(l));
  await c.connect();
  assert.equal(c.connected, true);
  await until(() => logs.some((l) => /no reply to mining.extranonce.subscribe within 0.03 s/.test(l)));
  pool.current.reply(3, true); // too late: ignored
  assert.deepEqual(await c.submit(SUBMIT), { accepted: true, reason: null, stale: false });
  assert.equal(c.connected, true);
});

test('a declined mining.extranonce.subscribe is only logged', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.extranonce.subscribe', () => ({ result: false, error: [20, 'Not supported', null] }));
  const logs: string[] = [];
  c.on('log', (l) => logs.push(l));
  await c.connect();
  await until(() => logs.some((l) => /declined mining.extranonce.subscribe \(Not supported\)/.test(l)));
  assert.equal(c.connected, true);
});

test('a first connect to an unreachable pool rejects and does not retry', async (t) => {
  const port = await freePort();
  let attempts = 0;
  const tcp = nodeTransport();
  const c = client(t, {
    url: `127.0.0.1:${port}`,
    retryPauseMs: 10,
    transport: (url) => (attempts++, tcp(url)),
  });
  await assert.rejects(c.connect(), (err: NodeJS.ErrnoException) => err.code === 'ECONNREFUSED');
  await sleep(60);
  assert.equal(attempts, 1);
  await assert.rejects(c.connect(), /ECONNREFUSED/, 'the caller may try again');
  assert.equal(attempts, 2);
});

// --------------------------------------------------------- server methods

test('emits difficulty, job and extranonce events and ignores invalid ones', async (t) => {
  const { pool, client: c } = await setup(t);
  await c.connect();
  const events = record(c);
  const conn = pool.current;
  for (const diff of [0, -1, '8', null, Infinity]) conn.setDifficulty(diff);
  conn.setDifficulty(0.5);
  conn.send({ id: null, method: 'mining.notify', params: 'not an array' });
  conn.notify(EXAMPLE_JOB);
  conn.setExtranonce('abc', 4);
  conn.setExtranonce('a1b2', 1);
  conn.setExtranonce('a1b2c3', 8);
  conn.send({ id: null, method: 'MINING.SET_DIFFICULTY', params: [2] });
  await until(() => values(events, 'difficulty').includes(2));
  assert.deepEqual(values(events, 'difficulty'), [0.5, 2]);
  assert.deepEqual(values(events, 'job'), [EXAMPLE_JOB]);
  assert.deepEqual(values(events, 'extranonce'), [{ xnonce1: 'a1b2c3', xnonce2Size: 8 }]);
  assert.deepEqual(names(events), ['difficulty', 'job', 'extranonce', 'difficulty']);
});

test('answers client.get_version, client.show_message, mining.ping and unknown methods', async (t) => {
  const { pool, client: c } = await setup(t, { userAgent: 'agent-x/2' });
  await c.connect();
  const messages: string[] = [];
  c.on('message', (m) => messages.push(m));
  assert.deepEqual(await pool.request('client.get_version', [], 11), { id: 11, result: 'agent-x/2', error: null });
  assert.deepEqual(await pool.request('client.show_message', ['hello miner'], 12), { id: 12, result: true, error: null });
  assert.deepEqual(await pool.request('mining.ping', [], 13), { id: 13, result: 'pong', error: null });
  assert.deepEqual(await pool.request('client.get_algo', [], 'x14'), {
    id: 'x14',
    result: false,
    error: { code: 38, message: 'unknown method' },
  });
  const line = (id: unknown) => pool.received.find((r) => r.msg?.id === id && !r.msg.method)!.line;
  assert.equal(line(11), '{"id":11,"result":"agent-x/2","error":null}');
  assert.equal(line(13), '{"id":13,"result":"pong","error":null}');
  assert.equal(line('x14'), '{"id":"x14","result":false,"error":{"code":38,"message":"unknown method"}}');
  // Notifications (no id) get no reply.
  pool.send({ id: null, method: 'client.show_message', params: ['no reply needed'] });
  pool.send({ id: null, method: 'mining.ping', params: [] });
  pool.send({ method: 'some.unknown', params: [] });
  await pool.request('mining.ping', [], 15);
  assert.deepEqual(messages, ['hello miner', 'no reply needed']);
  const replies = pool.received.filter((r) => r.msg && r.msg.method === undefined).map((r) => r.msg.id);
  assert.deepEqual(replies, [11, 12, 13, 'x14', 15]);
  assert.equal(c.connected, true);
});

test('tolerates CRLF, blank lines and lines split across packets', async (t) => {
  const { pool, client: c } = await setup(t);
  await settled(pool, c);
  const diffs: number[] = [];
  c.on('difficulty', (d) => diffs.push(d));
  const conn = pool.current;
  conn.write('{"id":null,"method":"mining.set_difficulty","params":[2]}\r\n\r\n\n  \n');
  conn.write('{"id":null,"method":"mining.set_dif');
  await sleep(20);
  conn.write('ficulty","params":[3]}\r\n{"id":null,"method":"mining.set_difficulty","params":[4]}\n');
  await until(() => diffs.length === 3);
  assert.deepEqual(diffs, [2, 3, 4]);
});

test('ignores invalid JSON and replies nobody asked for', async (t) => {
  const { pool, client: c } = await setup(t);
  await c.connect();
  const logs: string[] = [];
  c.on('log', (l) => logs.push(l));
  const errors: Error[] = [];
  c.on('error', (e) => errors.push(e));
  const conn = pool.current;
  conn.write('this is not json\n[1,2,3]\n"text"\n');
  conn.send({ id: 999, result: true, error: null });
  conn.send({ id: null, result: true, error: null });
  conn.setDifficulty(7);
  await until(() => logs.some((l) => /ignoring unexpected reply/.test(l)));
  assert.deepEqual(await c.submit(SUBMIT), { accepted: true, reason: null, stale: false });
  assert.ok(logs.some((l) => /ignoring invalid JSON/.test(l)));
  assert.deepEqual(errors, []);
  assert.equal(c.connected, true);
});

test('drops the connection on a line longer than 1 MiB, then reconnects', async (t) => {
  const { pool, client: c } = await setup(t);
  await c.connect();
  const disconnected = nextEvent(c, 'disconnected');
  pool.current.write('x'.repeat(MAX_LINE_BYTES + 1));
  assert.match((await disconnected).error!.message, /line longer than 1048576 bytes/);
  await pool.waitForMethod('mining.authorize', 2);
});

// ------------------------------------------------------------------ shares

test('gives every share a unique id and maps the verdicts', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.submit', () => null);
  await c.connect();
  const verdicts = Array.from({ length: 6 }, () => c.submit(SUBMIT));
  await until(() => pool.messages('mining.submit').length === 6);
  const submits = pool.messages('mining.submit');
  const ids = submits.map((m) => m.id);
  assert.equal(new Set(ids).size, 6);
  assert.ok(ids.every((id) => Number.isInteger(id) && id > 3), String(ids));
  assert.deepEqual(submits[0].params, ['user', 'jobid', '00000000', '4966bc61', '9962e301']);
  assert.equal(
    pool.received.find((r) => r.msg?.method === 'mining.submit')!.line,
    `{"method":"mining.submit","params":["user","jobid","00000000","4966bc61","9962e301"],"id":${ids[0]}}`,
  );
  const conn = pool.current;
  // Answer out of order: matched by id.
  conn.reply(ids[5], false, 'plain string error');
  conn.reply(ids[4], false, [21, 'Stale job', null]);
  conn.reply(ids[3], false, { code: 21, message: 'Job not found' });
  conn.reply(ids[2], false, { code: 22, message: 'Duplicate share' });
  conn.reply(ids[1], false, [23, 'Low difficulty share', null]);
  conn.reply(ids[0], true, null);
  assert.deepEqual(await Promise.all(verdicts), [
    { accepted: true, reason: null, stale: false },
    { accepted: false, reason: 'Low difficulty share', stale: false },
    { accepted: false, reason: 'Duplicate share', stale: false },
    { accepted: false, reason: 'Job not found', stale: true },
    { accepted: false, reason: 'Stale job', stale: true },
    { accepted: false, reason: 'plain string error', stale: false },
  ]);
  // Ids keep increasing across reconnects.
  const next = nextEvent(c, 'authorized');
  pool.dropAll();
  await next;
  pool.handle('mining.submit', () => ({ result: true }));
  assert.equal((await c.submit(SUBMIT)).accepted, true);
  assert.ok(pool.messages('mining.submit')[6].id > Math.max(...ids));
});

test('a share found before the authorize reply is sent behind mining.authorize', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.authorize', (_msg, conn) => (conn.notify(EXAMPLE_JOB), null));
  pool.handle('mining.submit', () => null);
  const job = nextEvent(c, 'job');
  const connecting = c.connect();
  await job;
  assert.equal(c.connected, false);
  const verdict = c.submit(SUBMIT);
  const submit = await pool.waitForMethod('mining.submit');
  assert.deepEqual(pool.received.map((r) => r.msg.method), ['mining.subscribe', 'mining.authorize', 'mining.submit']);
  pool.current.reply(2, true);
  await connecting;
  pool.current.reply(submit.id, true);
  assert.deepEqual(await verdict, { accepted: true, reason: null, stale: false });
});

test('a share without a verdict resolves as rejected after the share timeout', async (t) => {
  const { pool, client: c } = await setup(t, { shareTimeoutMs: 60 });
  pool.handle('mining.submit', () => null);
  await c.connect();
  const started = performance.now();
  assert.deepEqual(await c.submit(SUBMIT), { accepted: false, reason: 'timeout', stale: false });
  assert.ok(performance.now() - started >= 50);
  const { id } = await pool.waitForMethod('mining.submit');
  pool.current.reply(id, true); // late verdict: ignored
  pool.handle('mining.submit', () => ({ result: true }));
  assert.deepEqual(await c.submit(SUBMIT), { accepted: true, reason: null, stale: false });
});

test('pending shares resolve as disconnected when the connection drops', async (t) => {
  const { pool, client: c } = await setup(t, { retryPauseMs: 50 });
  pool.handle('mining.submit', () => null);
  assert.deepEqual(await c.submit(SUBMIT), { accepted: false, reason: 'disconnected', stale: false }, 'before connect');
  await c.connect();
  const pending = [c.submit(SUBMIT), c.submit(SUBMIT)];
  await until(() => pool.messages('mining.submit').length === 2);
  pool.dropAll();
  for (const verdict of await Promise.all(pending)) {
    assert.deepEqual(verdict, { accepted: false, reason: 'disconnected', stale: false });
  }
  assert.equal(c.connected, false);
  assert.deepEqual(await c.submit(SUBMIT), { accepted: false, reason: 'disconnected', stale: false }, 'while down');
});

test('an unparsable share request is rejected locally and reported', async (t) => {
  const { pool, client: c } = await setup(t);
  await c.connect();
  const error = nextEvent(c, 'error');
  assert.deepEqual(await c.submit('{"method": "mining.submit", "params": ["us"er"]}'), {
    accepted: false,
    reason: 'invalid request',
    stale: false,
  });
  assert.match((await error).message, /invalid share request/);
  assert.equal(pool.messages('mining.submit').length, 0);
});

// --------------------------------------------------------------- reconnects

test('reconnects after the pool drops the connection', async (t) => {
  const { pool, client: c } = await setup(t, { retryPauseMs: 40 });
  await settled(pool, c); // so the drop is a clean close, not a reset
  const events = record(c);
  const times: Record<string, number> = {};
  c.on('disconnected', () => (times.disconnected = performance.now()));
  c.on('reconnecting', () => (times.reconnecting = performance.now()));
  const reauthorized = nextEvent(c, 'authorized');
  pool.dropAll();
  await reauthorized;
  assert.deepEqual(names(events), ['disconnected', 'reconnecting', 'subscribed', 'authorized']);
  assert.match(values(events, 'disconnected')[0].error!.message, /connection closed by the pool/);
  assert.deepEqual(values(events, 'reconnecting'), [{ url: pool.url, delayMs: 40 }]);
  assert.ok(times.reconnecting - times.disconnected >= 35, 'waits retryPauseMs');
  assert.equal(c.connected, true);
  assert.equal(pool.connections.length, 2);
});

test('keeps retrying at a fixed pause while the pool is down', async (t) => {
  const first = await MockPool.start();
  const port = first.port;
  const c = client(t, { url: first.url, retryPauseMs: 15 });
  await c.connect();
  let attempts = 0;
  c.on('reconnecting', () => attempts++);
  await first.close();
  await until(() => attempts >= 3);
  assert.equal(c.connected, false);
  const second = await MockPool.start({ port });
  t.after(() => second.close());
  await nextEvent(c, 'authorized');
  assert.equal(c.connected, true);
});

test('reconnects when the pool stays silent for timeoutMs', async (t) => {
  const { pool, client: c } = await setup(t, { timeoutMs: 150, retryPauseMs: 10 });
  await c.connect();
  const started = performance.now();
  const { error } = await nextEvent(c, 'disconnected');
  assert.match(error!.message, /no data from the pool for 0.15 s/);
  assert.ok(performance.now() - started >= 100);
  await pool.waitForMethod('mining.authorize', 2);
});

test('traffic from the pool resets the silence timer', async (t) => {
  const { pool, client: c } = await setup(t, { timeoutMs: 300 });
  await c.connect();
  const events = record(c);
  for (let i = 0; i < 12; i++) {
    pool.current.setDifficulty(i + 1);
    await sleep(50);
  }
  assert.ok(!names(events).includes('disconnected'));
  assert.equal(pool.connections.length, 1);
});

test('follows client.reconnect to another pool and returns to the configured one when it fails', async (t) => {
  const a = await MockPool.start();
  const b = await MockPool.start();
  t.after(() => a.close());
  t.after(() => b.close());
  const c = client(t, { url: a.url, retryPauseMs: 20 });
  await c.connect();
  const events = record(c);
  const onB = b.waitForMethod('mining.authorize');
  a.reconnect('127.0.0.1', String(b.port)); // port as a string
  await onB;
  await until(() => c.connected);
  assert.deepEqual(values(events, 'reconnecting'), [{ url: b.url, delayMs: 0 }]);
  assert.deepEqual(b.messages('mining.subscribe')[0].params, [UA, 's1']);
  await a.connections[0].closed;
  // b goes away: the next attempt goes back to a.
  const backOnA = a.waitForMethod('mining.authorize', 2);
  await b.close();
  await backOnA;
  assert.deepEqual(values(events, 'reconnecting').at(-1), { url: a.url, delayMs: 20 });
  assert.equal(b.connections.length, 1);
});

test('a client.reconnect target that refuses connections sends the client back', async (t) => {
  const { pool, client: c } = await setup(t, { retryPauseMs: 20 });
  await c.connect();
  const dead = await freePort();
  const events = record(c);
  pool.reconnect('127.0.0.1', dead);
  await pool.waitForMethod('mining.authorize', 2);
  assert.deepEqual(values(events, 'reconnecting'), [
    { url: `stratum+tcp://127.0.0.1:${dead}`, delayMs: 0 },
    { url: pool.url, delayMs: 20 },
  ]);
  assert.ok(values(events, 'log').some((l) => l.includes(`switching back to ${pool.url}`)));
});

test('a client.reconnect during the first connect is followed, and connect() resolves there', async (t) => {
  const a = await MockPool.start();
  const b = await MockPool.start();
  t.after(() => a.close());
  t.after(() => b.close());
  a.handle('mining.authorize', (_msg, conn) => (conn.reconnect('127.0.0.1', b.port), null));
  const c = client(t, { url: a.url });
  const events = record(c);
  await c.connect();
  assert.equal(c.connected, true);
  assert.equal(b.messages('mining.authorize').length, 1);
  assert.deepEqual(names(events), ['subscribed', 'disconnected', 'reconnecting', 'subscribed', 'authorized']);
});

test('a transport that reports one failure twice is handled once', async (t) => {
  let attempts = 0;
  const c = client(t, {
    url: 'pool.example.com:3333',
    transport: () => {
      attempts++;
      const transport: Transport = {
        onLine: null,
        onClose: null,
        connect() {
          transport.onClose?.(new Error('refused'));
          return Promise.reject(new Error('refused'));
        },
        send() {},
        close() {},
      };
      return transport;
    },
  });
  const logs: string[] = [];
  c.on('log', (l) => logs.push(l));
  await assert.rejects(c.connect(), /refused/);
  await sleep(60);
  assert.equal(attempts, 1);
  assert.equal(logs.filter((l) => /failed: refused/.test(l)).length, 1);
});

test('ignores client.reconnect without a usable target', async (t) => {
  const { pool, client: c } = await setup(t);
  await c.connect();
  const events = record(c);
  for (const params of [[], ['127.0.0.1'], ['', 3333], ['127.0.0.1', 'abc'], ['127.0.0.1', 0], ['bad host', 1], [7, 3333]]) {
    pool.send({ id: null, method: 'client.reconnect', params });
  }
  await pool.request('mining.ping', [], 20); // everything before it has been handled
  assert.deepEqual(names(events), []);
  assert.equal(pool.connections.length, 1);
  assert.equal(c.connected, true);
});

// ------------------------------------------------------------------ close()

test('close() resolves pending shares, stops reconnecting and silences events', async (t) => {
  const { pool, client: c } = await setup(t, { retryPauseMs: 30 });
  pool.handle('mining.submit', () => null);
  await c.connect();
  const pending = c.submit(SUBMIT);
  await pool.waitForMethod('mining.submit');
  const events = record(c);
  c.close();
  assert.equal(c.connected, false);
  assert.deepEqual(await pending, { accepted: false, reason: 'closed', stale: false });
  await pool.connections[0].closed;
  await sleep(120);
  assert.equal(pool.connections.length, 1);
  assert.deepEqual(events, []);
  assert.deepEqual(await c.submit(SUBMIT), { accepted: false, reason: 'closed', stale: false });
  await assert.rejects(c.connect(), /closed/);
  c.close(); // idempotent
});

test('close() during the retry pause cancels the reconnect', async (t) => {
  const { pool, client: c } = await setup(t, { retryPauseMs: 40 });
  await c.connect();
  const disconnected = nextEvent(c, 'disconnected');
  pool.dropAll();
  await disconnected;
  c.close();
  await sleep(150);
  assert.equal(pool.connections.length, 1);
});

test('close() during the first connect rejects it', async (t) => {
  const { pool, client: c } = await setup(t);
  pool.handle('mining.authorize', () => null);
  const connecting = c.connect();
  await pool.waitForMethod('mining.authorize');
  c.close();
  await assert.rejects(connecting, /closed/);
  await pool.connections[0].closed;
});

// --------------------------------------------------------------------- TLS

test('connects over TLS with stratum+ssl:// and stratum+tcps:// when told to accept the certificate', async (t) => {
  const pool = await MockPool.start({ tls: true });
  t.after(() => pool.close());
  for (const scheme of ['stratum+ssl', 'stratum+tcps']) {
    const c = client(t, { url: `${scheme}://127.0.0.1:${pool.port}`, tlsInsecure: true });
    await c.connect();
    assert.deepEqual(await c.submit(SUBMIT), { accepted: true, reason: null, stale: false });
    c.close();
  }
  assert.equal(pool.messages('mining.authorize').length, 2);
});

test('verifies TLS certificates by default', async (t) => {
  const pool = await MockPool.start({ tls: true });
  t.after(() => pool.close());
  const c = client(t, { url: pool.url });
  await assert.rejects(c.connect(), (err: NodeJS.ErrnoException) => /CERT|SELF_SIGNED/.test(String(err.code)));
});

test('client.reconnect keeps the TLS scheme', async (t) => {
  const a = await MockPool.start({ tls: true });
  const b = await MockPool.start({ tls: true });
  t.after(() => a.close());
  t.after(() => b.close());
  const c = client(t, { url: a.url, tlsInsecure: true });
  await c.connect();
  const reconnecting = nextEvent(c, 'reconnecting');
  a.reconnect('127.0.0.1', b.port);
  assert.deepEqual(await reconnecting, { url: `stratum+ssl://127.0.0.1:${b.port}`, delayMs: 0 });
  await b.waitForMethod('mining.authorize');
});
