// Shared test helpers: a mock chain, an easy synthetic block, regtest access,
// a stand-in for PostHog.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { migrate as migrateSqlite } from 'drizzle-orm/d1/migrator';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { migrate as migrateMysql } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { mineBTC } from '../../tau-crypto/dist/index.js';
import { addressSlot, rebuildBlockHeader } from '../../tau-crypto/dist/payouts.js';
import { addressScript, bitcoinCore, newAddress } from '../../tau-crypto/dist/wallet.js';

export const OWNER_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(condition, ms = 5000, what = 'a condition') {
  const end = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

const sha256 = (b) => createHash('sha256').update(b).digest();

/** txid of a raw transaction: hash of its serialization without the segwit marker and witnesses. */
export function txidOf(hex) {
  const b = Buffer.from(hex, 'hex');
  if (b[4] !== 0) return Buffer.from(sha256(sha256(b))).reverse().toString('hex');
  let at = 6;
  const varint = () => {
    const f = b[at++];
    if (f < 0xfd) return f;
    if (f === 0xfd) return b.readUInt16LE((at += 2) - 2);
    return b.readUInt32LE((at += 4) - 4);
  };
  const nIn = varint();
  for (let i = 0; i < nIn; i++) {
    at += 36;
    const script = varint();
    at += script + 4;
  }
  const nOut = varint();
  for (let i = 0; i < nOut; i++) {
    at += 8;
    const script = varint();
    at += script;
  }
  // version | inputs and outputs (without marker and flag) | locktime
  const plain = Buffer.concat([b.subarray(0, 4), b.subarray(6, at), b.subarray(b.length - 4)]);
  return Buffer.from(sha256(sha256(plain))).reverse().toString('hex');
}

const le64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b.toString('hex');
};

/**
 * Feeds one visitor's block-finding share through an auditor (service.intercept):
 * a job paying `owner` `reward`, with an easy target (nbits 207fffff).
 */
export async function findBlockThrough(intercept, visitor, { owner = OWNER, reward = 312_500_000n, seed = 1, network = 'mainnet' } = {}) {
  const job = {
    prevhash: seed.toString(16).padStart(64, '0'),
    coinb1: '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + '0c' + '03' + seed.toString(16).padStart(6, '0'),
    coinb2: 'ffffffff' + '01' + le64(reward) + '16' + addressScript(owner, network) + '00000000',
    merkle: [],
    version: '20000000',
    nbits: '207fffff',
    ntime: '66000000',
  };
  const audit = intercept({ id: seed, peer: 'p', target: 'pool:3333', tls: false, origin: null, query: new URLSearchParams(), reply() {}, close() {} });
  await audit.fromClient(JSON.stringify({ id: 1, method: 'mining.subscribe', params: [] }));
  await audit.fromPool(JSON.stringify({ id: 1, result: [[], 'abcd0123', 4], error: null }));
  await audit.fromClient(JSON.stringify({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] }));
  await audit.fromPool(JSON.stringify({ id: null, method: 'mining.notify', params: ['j', job.prevhash, job.coinb1, job.coinb2, [], job.version, job.nbits, job.ntime, true] }));
  let nonce = 0;
  let rebuilt;
  do {
    rebuilt = rebuildBlockHeader({ ...job, xn1: 'abcd0123', xn2: '00000000', nonce: (++nonce).toString(16).padStart(8, '0') });
  } while (!rebuilt.isBlock);
  await audit.fromClient(JSON.stringify({ id: 3, method: 'mining.submit', params: [visitor, 'j', '00000000', job.ntime, nonce.toString(16).padStart(8, '0')] }));
  return { blockHash: rebuilt.blockHash, coinbaseTxid: rebuilt.coinbaseTxid, reward, ownerScript: addressScript(owner, network) };
}

/** A chain on which `found` is a block 100 deep paying the owner. */
export function mockChainWith(found, { tip = 1099 } = {}) {
  const chain = {
    tip,
    broadcasts: [],
    blocks: { [found.blockHash]: { inBestChain: true, height: 1000 } },
    async tipHeight() {
      return chain.tip;
    },
    async block(hash) {
      return chain.blocks[hash] ?? null;
    },
    async coinbase(hash) {
      return hash === found.blockHash ? { txid: found.coinbaseTxid, outputs: [{ script: found.ownerScript, value: found.reward }] } : null;
    },
    async utxos() {
      return [{ txid: found.coinbaseTxid, vout: 0, value: found.reward, height: 1000, coinbase: true }];
    },
    async isCoinbase() {
      return true;
    },
    async feeRate() {
      return 5;
    },
    async broadcast(hex) {
      chain.broadcasts.push(hex);
      return txidOf(hex);
    },
  };
  return chain;
}

/** The regtest node started by server/dev test, or null. */
export function regtest() {
  const url = process.env.BITCOIND_RPC;
  return url ? bitcoinCore({ url, user: process.env.BITCOIND_USER, pass: process.env.BITCOIND_PASS }) : null;
}

export async function nodeReady(core) {
  await until(() => core.rpc('getblockchaininfo').then(() => true, () => false), 30_000, 'bitcoind');
}

export const regtestChainEnv = () => ({
  TAU_CHAIN: 'bitcoin-core',
  TAU_CHAIN_URL: process.env.BITCOIND_RPC,
  TAU_CHAIN_USER: process.env.BITCOIND_USER,
  TAU_CHAIN_PASS: process.env.BITCOIND_PASS,
});

/** Mines through `bridgeUrl` until the regtest pool has `count` more blocks, then stops. */
export async function mineBlocks(address, bridgeUrl, pool, count = 1) {
  const before = pool.found.length;
  const miner = await mineBTC(address, bridgeUrl, { pool: pool.url, network: 'regtest', threads: 2, backend: 'wasm-sha256-x8', gpu: false });
  try {
    await until(() => pool.found.length >= before + count, 120_000, 'a block');
  } finally {
    await miner.stop();
  }
  return pool.found.slice(before);
}

/** Satoshis a block's coinbase pays `address`, according to bitcoind (regtest halves every 150 blocks). */
export async function ownerReward(core, blockHash, address) {
  const cb = (await core.rpc('getblock', [blockHash, 2])).tx[0];
  return cb.vout.filter((o) => o.scriptPubKey.address === address).reduce((sum, o) => sum + BigInt(Math.round(o.value * 1e8)), 0n);
}

/** End-to-end settings: a fresh owner address every 2 s, so successive mining sessions use different ones. */
export const FAST_SLOTS = Object.freeze({ TAU_ADDRESS_PERIOD_MS: '2000', TAU_ADDRESS_EPOCH: '2026-01-01T00:00:00Z' });
const FAST = { periodMs: 2000, epochMs: Date.parse(FAST_SLOTS.TAU_ADDRESS_EPOCH) };
export const currentSlot = (time = Date.now()) => addressSlot(time, FAST);

/** The owner wallet's addresses handed out between `from` and `to` (FAST_SLOTS): address -> receive index. */
export function slotAddresses(owner, from, to = Date.now()) {
  const out = new Map();
  for (let index = currentSlot(from); index <= currentSlot(to); index++) out.set(newAddress(owner, { index }).address, index);
  return out;
}

/** Waits until the next FAST_SLOTS slot has started. */
export async function nextSlot() {
  const now = currentSlot();
  await until(() => currentSlot() > now, 5000, 'the next address slot');
}

/** server/ (where wrangler is installed and the Worker's config lives). */
export const SERVER = fileURLToPath(new URL('..', import.meta.url));
const TIDB_MIGRATIONS = join(SERVER, 'tidb', 'migrations');
const D1_MIGRATIONS = join(SERVER, 'cloudflare', 'migrations');

/** The payout Worker bundled by wrangler, as `wrangler deploy` would (into a temporary folder). */
export function bundleWorker(t) {
  const out = mkdtempSync(join(tmpdir(), 'tau-worker-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = spawnSync('npx', ['wrangler', 'deploy', '--dry-run', '--config', 'cloudflare/wrangler.toml', '--outdir', out], {
    cwd: SERVER,
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', HOME: out },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return { out, files: readdirSync(out) };
}

/**
 * A new database `name` on the local TiDB the tests run (TIDB_TEST_URL), with
 * the migrations applied: a Drizzle MySQL database over mysql2 for tidbStores().
 * Production uses tidb/client.js over TiDB Cloud's HTTPS API, and the same
 * migrations (tidb/migrate.js).
 */
export async function tidbTestDatabase(name) {
  const admin = await mysql.createConnection(process.env.TIDB_TEST_URL);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const pool = mysql.createPool({ uri: `${process.env.TIDB_TEST_URL}/${name}`, connectionLimit: 8 });
  const db = drizzleMysql({ client: pool });
  await migrateMysql(db, { migrationsFolder: TIDB_MIGRATIONS });
  return { db, end: () => pool.end() };
}

/** Applies the D1 migrations (cloudflare/migrations) to a Miniflare D1 database, as `wrangler d1 migrations apply` does to a real one. */
export async function migrateD1(binding) {
  await migrateSqlite(drizzleD1(binding), { migrationsFolder: D1_MIGRATIONS });
}

// Playwright's Chromium as an ordinary desktop browser, for the site tests:
// posthog-js drops events from browsers that look automated (navigator.webdriver,
// "HeadlessChrome" in the user agent or in navigator.userAgentData's brands).
// Launch with DESKTOP_ARGS, then open pages in a desktopContext().
export const DESKTOP_ARGS = Object.freeze(['--disable-blink-features=AutomationControlled']);
export async function desktopContext(browser, options = {}) {
  const userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
  const context = await browser.newContext({ ...options, userAgent });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined }));
  return context;
}

/** A request body as posthog-js sends it: gzip, base64 form data (data=...) or plain JSON. */
function postHogText(raw) {
  if (raw[0] === 0x1f && raw[1] === 0x8b) return gunzipSync(raw).toString('utf8');
  const text = raw.toString('utf8');
  if (!text.startsWith('data=')) return text;
  return Buffer.from(new URLSearchParams(text).get('data') ?? '', 'base64').toString('utf8');
}

/**
 * A stand-in for PostHog's ingestion API, on 127.0.0.1 (point the site's
 * POSTHOG_HOST at `url`). It records every request the page makes to it, with
 * the body decoded (`text`), and answers like PostHog, CORS included.
 * events(): every event received.
 */
export async function startFakePostHog() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const { pathname } = new URL(req.url, 'http://localhost');
    requests.push({ method: req.method, path: pathname, text: postHogText(Buffer.concat(chunks)) });
    res.writeHead(req.method === 'OPTIONS' ? 204 : 200, {
      'access-control-allow-origin': req.headers.origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'content-type': 'application/json',
    });
    res.end(req.method === 'OPTIONS' ? '' : '{"status":1}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const events = () =>
    requests.flatMap((r) => {
      try {
        const body = JSON.parse(r.text);
        return (Array.isArray(body) ? body : (body.batch ?? [body])).filter((e) => typeof e?.event === 'string');
      } catch {
        return [];
      }
    });
  /** What arrived, for failure messages. */
  const received = () => requests.map((r) => `${r.method} ${r.path} ${r.text.slice(0, 160)}`).join('\n') || 'no requests';
  return { url: `http://127.0.0.1:${server.address().port}`, requests, events, received, close: () => new Promise((r) => server.close(r)) };
}
