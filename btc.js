// Mining, wallets, found-block verification and payouts for a site built on
// cpuminer-opt-js.
//
//   Browser or Node:  createWallet, walletFromMnemonic, mineBTC
//   Server (Node):    startPayoutBridge, verifyPayout, payout
//
// How a payout is earned. Visitors mine through the site's bridge
// (startPayoutBridge), which rewrites their stratum login to the owner's
// address, so every block found pays the owner. The bridge sees each job the
// pool sends and each share the visitor submits, rebuilds the block header
// itself and records the share against the visitor address that connection
// authorized with. verifyPayout(address) only pays for blocks it can prove:
// the header rebuilt from that visitor's own share hashes to a block that is in
// the best chain with 100+ confirmations, whose coinbase is the one rebuilt from
// the share and pays the owner. It then sends CLIENT_SHARE_PERCENT of the
// owner's output, at most once per block. Nothing a visitor claims is trusted.
//
// Mining uses the visitor's CPU (and GPU): only start it after they agree, and
// tell them the split and the odds.
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { createMiner, parseStratumUrl } from './cpuminer-opt-js/dist/index.js';

/** The visitor's share of the owner's block reward, in percent. */
export const CLIENT_SHARE_PERCENT = 10n;
/** Confirmations a found block needs before it is paid (coinbase maturity). */
export const MIN_CONFIRMATIONS = 100;
export const DEFAULT_POOL = 'stratum+tcp://solo.ckpool.org:3333';
export const DEFAULT_ESPLORA = 'https://mempool.space/api';

const REGTEST = Object.freeze({ bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef });
const NETWORKS = { mainnet: btc.NETWORK, testnet: btc.TEST_NETWORK, regtest: REGTEST };
// BIP84 (native SegWit, bc1q...) first receive address, as Sparrow derives it.
const PATHS = { mainnet: "m/84'/0'/0'/0/0", testnet: "m/84'/1'/0'/0/0", regtest: "m/84'/1'/0'/0/0" };
const DUST_SATS = 546n;
const COINBASE_MATURITY = 100;

// ------------------------------------------------------------------ helpers

function network(name = 'mainnet') {
  const n = NETWORKS[name];
  if (!n) throw new Error(`unknown network "${name}" (mainnet, testnet or regtest)`);
  return n;
}

function nodeBuiltin(name) {
  const mod = globalThis.process?.getBuiltinModule?.(name);
  if (!mod) throw new Error(`${name} is not available: this function runs on the server (Node 22.3+)`);
  return mod;
}

const env = (name) => globalThis.process?.env?.[name];

function fromHex(text, bytes) {
  if (typeof text !== 'string' || text.length % 2 || !/^[0-9a-f]*$/i.test(text)) throw new Error('invalid hex');
  if (bytes !== undefined && text.length !== bytes * 2) throw new Error(`expected ${bytes} bytes of hex`);
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16);
  return out;
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const reversed = (bytes) => Uint8Array.from(bytes).reverse();
const sha256d = (bytes) => sha256(sha256(bytes));

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Reverses the bytes of each 4-byte word (stratum's prevhash form <-> header bytes). */
function swap32(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) {
    out[i] = bytes[i + 3];
    out[i + 1] = bytes[i + 2];
    out[i + 2] = bytes[i + 1];
    out[i + 3] = bytes[i];
  }
  return out;
}

function leBigInt(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

/** Block target from compact nbits (hex), 0n if invalid or negative. */
export function nbitsTarget(nbits) {
  const n = parseInt(nbits, 16) >>> 0;
  const exponent = n >>> 24;
  const mantissa = BigInt(n & 0x7fffff);
  if (n & 0x800000 || !/^[0-9a-f]{8}$/i.test(nbits)) return 0n;
  return exponent <= 3 ? mantissa >> BigInt(8 * (3 - exponent)) : mantissa << BigInt(8 * (exponent - 3));
}

function sats(value, what = 'amount') {
  const n = typeof value === 'bigint' ? value : Number.isSafeInteger(value) ? BigInt(value) : null;
  if (n === null || n <= 0n) throw new Error(`${what} must be a positive whole number of satoshis`);
  return n;
}

// ------------------------------------------------------------------ addresses and wallets

/** The output script (hex) an address pays to; throws if it isn't a valid address on `net`. */
export function addressScript(address, net = 'mainnet') {
  const n = network(net);
  if (typeof address !== 'string' || address.length < 14 || address.length > 90) {
    throw new Error(`invalid ${net} address`);
  }
  try {
    return toHex(btc.OutScript.encode(btc.Address(n).decode(address)));
  } catch {
    throw new Error(`invalid ${net} address: ${address}`);
  }
}

export function isValidAddress(address, net = 'mainnet') {
  try {
    addressScript(address, net);
    return true;
  } catch {
    return false;
  }
}

function deriveKey(mnemonic, net = 'mainnet', passphrase = '') {
  const words = String(mnemonic ?? '').trim().toLowerCase().split(/\s+/).join(' ');
  if (!validateMnemonic(words, wordlist)) throw new Error('invalid mnemonic (unknown word or bad checksum)');
  network(net);
  const path = PATHS[net];
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(words, passphrase)).derive(path);
  const payment = btc.p2wpkh(key.publicKey, network(net));
  return { path, address: payment.address, script: toHex(payment.script), privateKey: key.privateKey };
}

/**
 * A new wallet: 12 (or 24) random words and its first native SegWit address.
 * Show the words to the user once and never send them to a server; they
 * restore the wallet in any BIP84 wallet app (Sparrow, BlueWallet...).
 */
export function createWallet({ words = 12, network: net = 'mainnet' } = {}) {
  if (words !== 12 && words !== 24) throw new Error('words must be 12 or 24');
  network(net);
  const mnemonic = generateMnemonic(wordlist, words === 12 ? 128 : 256);
  const { address, path } = deriveKey(mnemonic, net);
  return { mnemonic, address, path, network: net };
}

/** The address of an existing wallet (checks the words and their checksum). */
export function walletFromMnemonic(mnemonic, { network: net = 'mainnet', passphrase = '' } = {}) {
  const { address, path } = deriveKey(mnemonic, net, passphrase);
  return { address, path, network: net };
}

// ------------------------------------------------------------------ mining

/**
 * Starts mining for `address` and returns the running cpuminer-opt-js Miner
 * (miner.stop(), miner.stats(), miner.on('share' | 'hashrate' | ...)).
 *
 * - `url` ws:// or wss://: the site's payout bridge (startPayoutBridge). The
 *   reward goes to the site owner; a block found here earns `address` its share
 *   through verifyPayout. `options.pool` must match the pool the bridge allows.
 * - `url` stratum+tcp:// or stratum+ssl://: straight to that pool (Node only),
 *   plain solo mining with no split.
 *
 * Other options are passed to createMiner (threads, throttle, backend, gpu...).
 */
export async function mineBTC(address, url, options = {}) {
  const { pool = DEFAULT_POOL, network: net = 'mainnet', ...minerOptions } = options;
  addressScript(address, net);
  if (typeof url !== 'string') throw new Error('url is required');
  const viaBridge = /^wss?:\/\//i.test(url);
  if (!viaBridge && !/^stratum\+/i.test(url)) {
    throw new Error('url must be the payout bridge (ws:// or wss://) or a pool (stratum+tcp:// or stratum+ssl://)');
  }
  const miner = await createMiner({
    algo: 'sha256d',
    pass: 'x',
    ...minerOptions,
    url: viaBridge ? pool : url,
    bridge: viaBridge ? url : undefined,
    user: address,
  });
  await miner.start();
  return miner;
}

// ------------------------------------------------------------------ block reconstruction

/**
 * Rebuilds the block header a share describes and hashes it.
 * Inputs are stratum's hex fields: prevhash (word-swapped, as in mining.notify),
 * coinb1, coinb2, merkle branches, version, nbits, plus the connection's
 * extranonce1 and the submitted extranonce2, ntime and nonce.
 */
export function rebuildBlockHeader({ prevhash, coinb1, coinb2, merkle, version, nbits, xn1, xn2, ntime, nonce }) {
  if (!Array.isArray(merkle) || merkle.length > 32) throw new Error('invalid merkle branch');
  const coinbase = concat(fromHex(coinb1), fromHex(xn1), fromHex(xn2), fromHex(coinb2));
  let root = sha256d(coinbase);
  for (const branch of merkle) root = sha256d(concat(root, fromHex(branch, 32)));
  const header = concat(
    reversed(fromHex(version, 4)),
    swap32(fromHex(prevhash, 32)),
    root,
    reversed(fromHex(ntime, 4)),
    reversed(fromHex(nbits, 4)),
    reversed(fromHex(nonce, 4)),
  );
  const hash = sha256d(header);
  const target = nbitsTarget(nbits);
  return {
    header: toHex(header),
    blockHash: toHex(reversed(hash)),
    coinbase: toHex(coinbase),
    coinbaseTxid: toHex(reversed(sha256d(coinbase))),
    isBlock: target > 0n && leBigInt(hash) <= target,
  };
}

function readVarInt(bytes, at) {
  if (at >= bytes.length) throw new Error('truncated transaction');
  const first = bytes[at];
  if (first < 0xfd) return [first, at + 1];
  if (first === 0xfd) return [bytes[at + 1] | (bytes[at + 2] << 8), at + 3];
  if (first === 0xfe) return [(bytes[at + 1] | (bytes[at + 2] << 8) | (bytes[at + 3] << 16) | (bytes[at + 4] << 24)) >>> 0, at + 5];
  throw new Error('length too large');
}

/** Outputs of a coinbase transaction (non-witness serialization, as stratum sends it). */
export function coinbaseOutputs(coinbaseHex) {
  const b = fromHex(coinbaseHex);
  let at = 4;
  if (b[at] === 0) throw new Error('unexpected witness serialization');
  let n;
  [n, at] = readVarInt(b, at);
  if (n !== 1) throw new Error('a coinbase has one input');
  at += 36;
  let len;
  [len, at] = readVarInt(b, at);
  at += len + 4;
  [n, at] = readVarInt(b, at);
  const outputs = [];
  for (let i = 0; i < n; i++) {
    if (at + 8 > b.length) throw new Error('truncated transaction');
    const value = leBigInt(b.subarray(at, at + 8));
    [len, at] = readVarInt(b, at + 8);
    if (at + len > b.length) throw new Error('truncated transaction');
    outputs.push({ value, script: toHex(b.subarray(at, at + len)) });
    at += len;
  }
  if (at + 4 !== b.length) throw new Error('unexpected trailing bytes');
  return outputs;
}

function paidTo(outputs, scriptHex) {
  return outputs.reduce((sum, o) => (o.script === scriptHex ? sum + o.value : sum), 0n);
}

// ------------------------------------------------------------------ the share auditor

const HEX_RE = /^[0-9a-f]*$/i;
const isHex = (s, bytes) => typeof s === 'string' && s.length % 2 === 0 && HEX_RE.test(s) && (bytes === undefined || s.length === bytes * 2);
const MAX_LINE = 16 * 1024;
const MAX_JOBS = 32;
const MAX_PENDING = 64;

function validNotify(p) {
  if (!Array.isArray(p) || p.length < 9) return null;
  const [jobId, prevhash, coinb1, coinb2, merkle, version, nbits, ntime, clean] = p;
  if (typeof jobId !== 'string' || !jobId || jobId.length > 128) return null;
  if (!isHex(prevhash, 32) || !isHex(version, 4) || !isHex(nbits, 4) || !isHex(ntime, 4)) return null;
  if (!isHex(coinb1) || !isHex(coinb2) || coinb1.length + coinb2.length > 40_000) return null;
  if (!Array.isArray(merkle) || merkle.length > 32 || !merkle.every((m) => isHex(m, 32))) return null;
  return { jobId, prevhash, coinb1, coinb2, merkle, version, nbits, ntime, clean: clean === true };
}

/**
 * The bridge interceptor that makes payouts verifiable (used by
 * startPayoutBridge; exported for tests). Per connection it:
 *  - lets through only subscribe, authorize, extranonce.subscribe, submit and
 *    replies to the pool's requests, re-serialized from the parsed JSON;
 *  - binds the connection to the payout address of its first authorize and
 *    logs in to the pool as `ownerAddress` instead;
 *  - remembers the jobs the pool sends (with the extranonce1 in effect), and
 *    for each submit records the raw share fields and whether it is a block.
 * `record(entry)` stores ledger entries (shares and pool verdicts).
 */
export function createAuditor({ ownerAddress, network: net = 'mainnet', record, log = () => {}, maxSharesPer10s = 50 }) {
  const ownerScript = addressScript(ownerAddress, net);
  const started = Date.now().toString(36);
  return (connection) => {
    let visitor = null;
    let xn1 = null;
    let xn2Size = null;
    let difficulty = null;
    let shareCount = 0;
    const jobs = new Map();
    const pending = new Map(); // JSON-RPC id -> what the client asked
    const recent = [];

    const deny = (id, message, code = 20) => {
      if (id !== undefined && id !== null) connection.reply(JSON.stringify({ id, result: null, error: [code, message, null] }));
      return null;
    };
    const idKey = (id) => `${typeof id}:${id}`;

    const fromClient = (line) => {
      if (line.length > MAX_LINE) return null;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return null;
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
      const { id, method, params } = msg;
      if (method === undefined) {
        // A reply to one of the pool's requests (client.get_version, mining.ping...).
        return 'result' in msg || 'error' in msg ? JSON.stringify(msg) : null;
      }
      const validId = (typeof id === 'number' && Number.isSafeInteger(id)) || (typeof id === 'string' && id.length <= 64);
      if (!validId) return null;
      if (typeof method !== 'string' || !Array.isArray(params)) return deny(id, 'invalid request');
      if (pending.has(idKey(id))) return deny(id, 'duplicate request id');
      if (pending.size >= MAX_PENDING) return deny(id, 'too many requests in flight');
      const forward = (kind, newParams, extra = {}) => {
        pending.set(idKey(id), { kind, ...extra });
        return JSON.stringify({ id, method, params: newParams });
      };

      switch (method) {
        case 'mining.subscribe':
          return forward('subscribe', params.filter((p) => typeof p === 'string' && p.length <= 128).slice(0, 2));
        case 'mining.extranonce.subscribe':
          return forward('extranonce', []);
        case 'mining.authorize': {
          const address = typeof params[0] === 'string' ? params[0].trim() : '';
          if (!isValidAddress(address, net)) return deny(id, `invalid payout address: expected a ${net} Bitcoin address`, 24);
          if (visitor && visitor !== address) return deny(id, 'one payout address per connection', 24);
          visitor = address;
          return forward('authorize', [ownerAddress, typeof params[1] === 'string' ? params[1].slice(0, 64) : 'x']);
        }
        case 'mining.submit': {
          if (!visitor) return deny(id, 'unauthorized worker', 24);
          if (params.length !== 5) return deny(id, 'version rolling is not supported');
          const [, jobId, xn2, ntime, nonce] = params;
          const job = typeof jobId === 'string' ? jobs.get(jobId) : undefined;
          if (!job) return deny(id, 'Job not found', 21);
          if (!isHex(xn2, job.xn2Size) || !isHex(ntime, 4) || !isHex(nonce, 4)) return deny(id, 'invalid share fields');
          const now = Date.now();
          while (recent.length && now - recent[0] > 10_000) recent.shift();
          if (recent.length >= maxSharesPer10s) return deny(id, 'too many shares');
          recent.push(now);
          const share = { xn1: job.xn1, xn2: xn2.toLowerCase(), ntime: ntime.toLowerCase(), nonce: nonce.toLowerCase() };
          const rebuilt = rebuildBlockHeader({ ...job, ...share });
          const shareId = `${started}-${connection.id}-${++shareCount}`;
          record({
            type: 'share',
            v: 1,
            id: shareId,
            time: new Date(now).toISOString(),
            conn: connection.id,
            peer: connection.peer,
            visitor,
            jobId,
            job: { prevhash: job.prevhash, coinb1: job.coinb1, coinb2: job.coinb2, merkle: job.merkle, version: job.version, nbits: job.nbits },
            ...share,
            difficulty,
            blockHash: rebuilt.blockHash,
            isBlock: rebuilt.isBlock,
            ownerSats: job.ownerSats === null ? null : String(job.ownerSats),
          });
          if (rebuilt.isBlock) log(`block candidate ${rebuilt.blockHash} from ${visitor} (connection ${connection.id})`);
          return forward('submit', [ownerAddress, jobId, share.xn2, share.ntime, share.nonce], { shareId });
        }
        default:
          return deny(id, `unsupported method ${method.slice(0, 64)}`);
      }
    };

    const fromPool = (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return line;
      }
      if (!msg || typeof msg !== 'object') return line;
      if (msg.method === 'mining.notify') {
        const job = validNotify(msg.params);
        if (job && xn1 !== null) {
          let ownerSats = null;
          try {
            ownerSats = paidTo(coinbaseOutputs(job.coinb1 + xn1 + '00'.repeat(xn2Size) + job.coinb2), ownerScript);
          } catch {
            // not a parsable coinbase: shares on it can never be paid
          }
          if (job.clean) jobs.clear();
          jobs.delete(job.jobId);
          jobs.set(job.jobId, { ...job, xn1, xn2Size, ownerSats });
          while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
        }
      } else if (msg.method === 'mining.set_extranonce') {
        const [x1, size] = Array.isArray(msg.params) ? msg.params : [];
        // Applies to the jobs that follow, like the miner does.
        if (isHex(x1) && x1.length <= 32 && Number.isInteger(size) && size >= 2 && size <= 16) {
          xn1 = x1.toLowerCase();
          xn2Size = size;
        }
      } else if (msg.method === 'mining.set_difficulty') {
        const d = Array.isArray(msg.params) ? msg.params[0] : undefined;
        if (typeof d === 'number' && Number.isFinite(d) && d > 0) difficulty = d;
      } else if (msg.method === 'client.reconnect') {
        return null; // visitors stay on this bridge's pool
      } else if (msg.method === undefined && msg.id !== undefined && msg.id !== null) {
        const asked = pending.get(idKey(msg.id));
        if (asked) {
          pending.delete(idKey(msg.id));
          if (asked.kind === 'subscribe' && Array.isArray(msg.result)) {
            const [, x1, size] = msg.result;
            if (isHex(x1) && x1.length <= 32 && Number.isInteger(size) && size >= 2 && size <= 16) {
              xn1 = x1.toLowerCase();
              xn2Size = size;
            }
          } else if (asked.kind === 'submit') {
            record({ type: 'result', v: 1, share: asked.shareId, time: new Date().toISOString(), accepted: msg.result === true, error: msg.error ?? null });
          }
        }
      }
      return line;
    };

    return { fromClient, fromPool };
  };
}

/**
 * Runs the payout bridge (Node): browsers mine through it with
 * mineBTC(address, 'wss://...'). Only `pool` can be reached, visitors are
 * logged in as `ownerAddress`, and every share is recorded in
 * `<ledgerDir>/shares.jsonl` for verifyPayout.
 */
export async function startPayoutBridge({
  listen = 8080,
  host,
  pool = DEFAULT_POOL,
  ownerAddress,
  network: net = 'mainnet',
  ledgerDir = env('PAYOUT_LEDGER') ?? 'payout-ledger',
  origins,
  maxConnections,
  log = () => {},
} = {}) {
  addressScript(ownerAddress, net);
  const fs = nodeBuiltin('node:fs');
  const path = nodeBuiltin('node:path');
  fs.mkdirSync(ledgerDir, { recursive: true, mode: 0o700 });
  const sharesFile = path.join(ledgerDir, 'shares.jsonl');
  const record = (entry) => fs.appendFileSync(sharesFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  const target = parseStratumUrl(pool);
  const { createBridge, BRIDGE_FEATURES } = await import('./cpuminer-opt-js/dist/bridge.js');
  // Without the hook a bridge would relay visitors' logins unchanged (paying them, not the owner).
  if (!BRIDGE_FEATURES?.includes('intercept')) throw new Error('cpuminer-opt-js/dist is too old: rebuild it (the bridge needs intercept)');
  return createBridge({
    port: listen,
    host,
    allow: [`${target.host.includes(':') ? `[${target.host}]` : target.host}:${target.port}`],
    origins,
    maxConnections,
    log,
    intercept: createAuditor({ ownerAddress, network: net, record, log }),
  });
}

// ------------------------------------------------------------------ chain access

const HASH_RE = /^[0-9a-f]{64}$/;

function btcToSats(value) {
  return BigInt(Math.round(Number(value) * 1e8));
}

/** Block explorer client for an Esplora API (default mempool.space). */
export function esplora(baseUrl = DEFAULT_ESPLORA, { fetch: doFetch = globalThis.fetch } = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const get = async (path, as = 'json') => {
    const res = await doFetch(base + path);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`${base}${path}: HTTP ${res.status}`);
    return as === 'json' ? res.json() : (await res.text()).trim();
  };
  const tx = async (txid) => {
    if (!HASH_RE.test(txid)) throw new Error('invalid txid');
    return get(`/tx/${txid}`);
  };
  return {
    async tipHeight() {
      return Number(await get('/blocks/tip/height', 'text'));
    },
    async block(hash) {
      if (!HASH_RE.test(hash)) throw new Error('invalid block hash');
      const s = await get(`/block/${hash}/status`);
      return s ? { inBestChain: s.in_best_chain === true, height: s.height ?? null } : null;
    },
    async coinbase(hash) {
      if (!HASH_RE.test(hash)) throw new Error('invalid block hash');
      const txid = await get(`/block/${hash}/txid/0`, 'text');
      const t = txid && (await tx(txid));
      if (!t?.vin?.[0]?.is_coinbase) return null;
      return { txid, outputs: t.vout.map((o) => ({ script: String(o.scriptpubkey).toLowerCase(), value: BigInt(o.value) })) };
    },
    async utxos(address) {
      const list = (await get(`/address/${encodeURIComponent(address)}/utxo`)) ?? [];
      return list.map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), height: u.status?.confirmed ? u.status.block_height : null }));
    },
    async isCoinbase(txid) {
      return (await tx(txid))?.vin?.[0]?.is_coinbase === true;
    },
    async feeRate() {
      const f = await get('/v1/fees/recommended');
      if (f && Number.isFinite(f.halfHourFee)) return f.halfHourFee;
      const e = await get('/fee-estimates');
      if (e && Number.isFinite(e['3'])) return e['3'];
      throw new Error('no fee estimate available');
    },
    async broadcast(hex) {
      const res = await doFetch(`${base}/tx`, { method: 'POST', body: hex, headers: { 'content-type': 'text/plain' } });
      const text = (await res.text()).trim();
      if (!res.ok) throw new Error(`broadcast rejected: ${text.slice(0, 300)}`);
      return text;
    },
  };
}

/** Client for a Bitcoin Core node's JSON-RPC (no wallet needed). */
export function bitcoinCore({ url, user, pass, fallbackFeeRate = 2, fetch: doFetch = globalThis.fetch }) {
  let nextId = 1;
  const auth = `Basic ${btoa(`${user}:${pass}`)}`;
  const rpc = async (method, params = []) => {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify({ jsonrpc: '1.0', id: nextId++, method, params }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    if (body.error) {
      const err = new Error(`${method}: ${body.error.message}`);
      err.code = body.error.code;
      throw err;
    }
    return body.result;
  };
  return {
    rpc,
    async tipHeight() {
      return rpc('getblockcount');
    },
    async block(hash) {
      if (!HASH_RE.test(hash)) throw new Error('invalid block hash');
      try {
        const h = await rpc('getblockheader', [hash, true]);
        return { inBestChain: h.confirmations >= 0, height: h.height };
      } catch (err) {
        if (err.code === -5) return null; // not found
        throw err;
      }
    },
    async coinbase(hash) {
      if (!HASH_RE.test(hash)) throw new Error('invalid block hash');
      const b = await rpc('getblock', [hash, 2]);
      const cb = b.tx[0];
      return { txid: cb.txid, outputs: cb.vout.map((o) => ({ script: o.scriptPubKey.hex.toLowerCase(), value: btcToSats(o.value) })) };
    },
    async utxos(address) {
      const r = await rpc('scantxoutset', ['start', [`addr(${address})`]]);
      return r.unspents.map((u) => ({ txid: u.txid, vout: u.vout, value: btcToSats(u.amount), height: u.height, coinbase: u.coinbase }));
    },
    async isCoinbase(txid, height) {
      const blockHash = await rpc('getblockhash', [height]);
      const t = await rpc('getrawtransaction', [txid, true, blockHash]);
      return Boolean(t.vin?.[0]?.coinbase);
    },
    async feeRate() {
      const e = await rpc('estimatesmartfee', [6]).catch(() => null);
      return e?.feerate ? Math.ceil((e.feerate * 1e8) / 1000) : fallbackFeeRate;
    },
    async broadcast(hex) {
      return rpc('sendrawtransaction', [hex]);
    },
  };
}

function defaultChain(net) {
  if (net === 'mainnet') return esplora();
  if (net === 'testnet') return esplora('https://mempool.space/testnet4/api');
  throw new Error(`pass a chain client for ${net}`);
}

// ------------------------------------------------------------------ payouts

function outputWeight(scriptHex) {
  return 4 * (8 + 1 + scriptHex.length / 2);
}

/** Upper-bound virtual size of a P2WPKH-input transaction. */
function estimateVsize(inputs, outputScripts) {
  // version, counts, locktime: 10 bytes; segwit marker+flag: 2 weight units;
  // per P2WPKH input 41 bytes + a 108-byte witness (72-byte signature max).
  const weight = 40 + 2 + inputs * (41 * 4 + 108) + outputScripts.reduce((w, s) => w + outputWeight(s), 0);
  return Math.ceil(weight / 4);
}

/** Builds and signs a payment from the owner's wallet, without broadcasting it. */
async function buildPayout(to, amountSats, options) {
  const {
    network: net = 'mainnet',
    chain = defaultChain(net),
    ownerMnemonic = env('OWNER_MNEMONIC'),
    feeRate,
    maxFeeRate = 200,
    minConfirmations = 1,
    exclude = new Set(),
  } = options;
  const amount = sats(amountSats);
  if (amount < DUST_SATS) throw new Error(`amount below the dust limit (${DUST_SATS} sats)`);
  const toScript = addressScript(to, net);
  if (!ownerMnemonic) throw new Error('the owner wallet is missing: set OWNER_MNEMONIC (or pass ownerMnemonic)');
  const owner = deriveKey(ownerMnemonic, net);
  if (toScript === owner.script) throw new Error('refusing to pay the owner address itself');
  const rate = Number(feeRate ?? (await chain.feeRate()));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('invalid fee rate');
  if (rate > maxFeeRate) throw new Error(`fee rate ${rate} sat/vB is above maxFeeRate (${maxFeeRate})`);
  const feeFor = (inputs, scripts) => BigInt(Math.ceil(estimateVsize(inputs, scripts) * Math.max(rate, 1)));

  // Spendable owner coins: confirmed, not already used by a payout, and
  // coinbase outputs only once mature. Largest first.
  const tip = await chain.tipHeight();
  const usable = [];
  for (const u of await chain.utxos(owner.address)) {
    if (u.height === null || u.height === undefined) continue;
    const confirmations = tip - u.height + 1;
    if (confirmations < minConfirmations || exclude.has(`${u.txid}:${u.vout}`)) continue;
    if (confirmations < COINBASE_MATURITY) {
      const coinbase = u.coinbase ?? (await chain.isCoinbase(u.txid, u.height));
      if (coinbase) continue;
    }
    usable.push(u);
  }
  usable.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

  const chosen = [];
  let total = 0n;
  let fee = 0n;
  let change = 0n;
  for (const u of usable) {
    chosen.push(u);
    total += u.value;
    fee = feeFor(chosen.length, [toScript, owner.script]);
    if (total >= amount + fee) break;
  }
  if (total < amount + fee) throw new Error(`not enough confirmed funds: have ${total} sats, need ${amount + fee}`);
  change = total - amount - fee;
  if (change < DUST_SATS) {
    // No change output: the remainder goes to the fee (it must still cover the smaller transaction).
    change = 0n;
    fee = total - amount;
  }

  const n = network(net);
  const tx = new btc.Transaction();
  for (const u of chosen) {
    tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: fromHex(owner.script), amount: u.value } });
  }
  tx.addOutputAddress(to, amount, n);
  if (change > 0n) tx.addOutputAddress(owner.address, change, n);
  tx.sign(owner.privateKey);
  tx.finalize();
  if (tx.fee !== fee) throw new Error('internal error: fee mismatch');
  if (Number(fee) < tx.vsize * Math.max(rate, 1) - 1e-9 && change > 0n) throw new Error('internal error: fee below the rate');
  return {
    txid: tx.id,
    hex: tx.hex,
    feeSats: fee,
    vsize: tx.vsize,
    amountSats: amount,
    to,
    inputs: chosen.map((u) => `${u.txid}:${u.vout}`),
  };
}

/**
 * Sends `amountSats` to `to` from the owner's wallet (server side; the owner's
 * words come from OWNER_MNEMONIC or `options.ownerMnemonic`). The owner pays
 * the network fee. Options: network, chain (esplora() / bitcoinCore()),
 * feeRate (sat/vB, default: the chain's estimate), maxFeeRate (default 200),
 * broadcast (default true; false only builds and signs).
 */
export async function payout(to, amountSats, options = {}) {
  const built = await buildPayout(to, amountSats, options);
  if (options.broadcast === false) return built;
  const chain = options.chain ?? defaultChain(options.network ?? 'mainnet');
  const txid = await chain.broadcast(built.hex);
  if (txid !== built.txid) throw new Error(`broadcast returned ${txid}, expected ${built.txid}`);
  return built;
}

// ------------------------------------------------------------------ verifyPayout

function readLedger(fs, file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn last line after a crash: ignored
    }
  }
  return out;
}

let queue = Promise.resolve();
function serialized(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/**
 * Server side: pays `address` CLIENT_SHARE_PERCENT of every block it provably
 * found through the payout bridge, once per block. Returns one entry per
 * block candidate: { blockHash, status, height?, confirmations?, rewardSats?,
 * payoutSats?, txid?, error? } with status
 *   paid          payout sent now
 *   already-paid  paid before (txid of that payout)
 *   immature      in the best chain but under MIN_CONFIRMATIONS
 *   not-in-chain  not a block in the best chain (stale, orphaned or unknown)
 *   not-ours      the block's coinbase isn't the one from this share, or doesn't pay the owner
 *   not-paid-yet  verified, but the payment couldn't be built (e.g. not enough
 *                 mature funds, fee above maxFeeRate); tried again next time
 *   needs-review  a payout was started but not confirmed as sent: check `txid`
 *                 on-chain, then append {"type":"payout","status":"void",...}
 *                 to payouts.jsonl to allow a retry
 * Options: network, chain, ownerMnemonic (default OWNER_MNEMONIC), ledgerDir
 * (default PAYOUT_LEDGER or ./payout-ledger), feeRate, maxFeeRate.
 */
export async function verifyPayout(address, options = {}) {
  const net = options.network ?? 'mainnet';
  addressScript(address, net);
  const fs = nodeBuiltin('node:fs');
  const path = nodeBuiltin('node:path');
  const ledgerDir = options.ledgerDir ?? env('PAYOUT_LEDGER') ?? 'payout-ledger';
  const chain = options.chain ?? defaultChain(net);
  const minConfirmations = options.minConfirmations ?? MIN_CONFIRMATIONS;
  const ownerMnemonic = options.ownerMnemonic ?? env('OWNER_MNEMONIC');
  if (!ownerMnemonic) throw new Error('the owner wallet is missing: set OWNER_MNEMONIC (or pass ownerMnemonic)');
  const owner = deriveKey(ownerMnemonic, net);
  if (minConfirmations < COINBASE_MATURITY) throw new Error(`minConfirmations must be at least ${COINBASE_MATURITY}`);

  return serialized(async () => {
    fs.mkdirSync(ledgerDir, { recursive: true, mode: 0o700 });
    const lockFile = path.join(ledgerDir, 'payout.lock');
    let lock;
    try {
      lock = fs.openSync(lockFile, 'wx', 0o600);
    } catch {
      throw new Error(`another payout run holds ${lockFile} (if none is running, delete it)`);
    }
    try {
      return await settle();
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockFile);
    }
  });

  async function settle() {
    const payoutsFile = path.join(ledgerDir, 'payouts.jsonl');
    const appendPayout = (entry) => {
      const fd = fs.openSync(payoutsFile, 'a', 0o600);
      try {
        fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    };

    // Latest payout state per block, and the coins those payouts spend. A
    // "void" entry (the operator checked the txid never reached the chain)
    // forgets the attempt and releases its coins; rebuilding is deterministic,
    // so a retry from the same coins produces the same transaction.
    const payouts = new Map();
    for (const p of readLedger(fs, payoutsFile)) {
      if (p.type !== 'payout' || typeof p.blockHash !== 'string') continue;
      if (p.status === 'void') payouts.delete(p.blockHash);
      else payouts.set(p.blockHash, { ...payouts.get(p.blockHash), ...p });
    }
    const usedInputs = new Set([...payouts.values()].flatMap((p) => p.inputs ?? []));

    // Block candidates, rebuilt from the raw share fields (never from the stored hash).
    const claimants = new Map(); // blockHash -> visitors whose shares rebuild to it
    const mine = new Map(); // blockHash -> rebuilt, for `address`
    for (const r of readLedger(fs, path.join(ledgerDir, 'shares.jsonl'))) {
      if (r.type !== 'share' || r.isBlock !== true || typeof r.visitor !== 'string' || !r.job) continue;
      let rebuilt;
      try {
        rebuilt = rebuildBlockHeader({ ...r.job, xn1: r.xn1, xn2: r.xn2, ntime: r.ntime, nonce: r.nonce });
      } catch {
        continue;
      }
      if (!rebuilt.isBlock) continue;
      if (!claimants.has(rebuilt.blockHash)) claimants.set(rebuilt.blockHash, new Set());
      claimants.get(rebuilt.blockHash).add(r.visitor);
      if (r.visitor === address) mine.set(rebuilt.blockHash, rebuilt);
    }

    const results = [];
    for (const [blockHash, rebuilt] of mine) {
      const prior = payouts.get(blockHash);
      if (prior?.status === 'sent') {
        results.push({ blockHash, status: 'already-paid', txid: prior.txid, payoutSats: BigInt(prior.amountSats ?? 0) });
        continue;
      }
      if (prior) {
        results.push({ blockHash, status: 'needs-review', txid: prior.txid });
        continue;
      }
      if (claimants.get(blockHash).size > 1) {
        results.push({ blockHash, status: 'needs-review', error: 'more than one visitor recorded for this block' });
        continue;
      }
      const status = await chain.block(blockHash);
      if (!status || !status.inBestChain) {
        results.push({ blockHash, status: 'not-in-chain' });
        continue;
      }
      const confirmations = (await chain.tipHeight()) - status.height + 1;
      if (confirmations < minConfirmations) {
        results.push({ blockHash, status: 'immature', height: status.height, confirmations });
        continue;
      }
      const cb = await chain.coinbase(blockHash);
      if (!cb || cb.txid !== rebuilt.coinbaseTxid) {
        results.push({ blockHash, status: 'not-ours', height: status.height, error: "the block's coinbase is not the one from this share" });
        continue;
      }
      const rewardSats = paidTo(cb.outputs, owner.script);
      if (rewardSats <= 0n) {
        results.push({ blockHash, status: 'not-ours', height: status.height, error: 'the coinbase does not pay the owner' });
        continue;
      }
      const payoutSats = (rewardSats * CLIENT_SHARE_PERCENT) / 100n;
      const entry = { blockHash, height: status.height, confirmations, rewardSats, payoutSats };
      let built;
      try {
        built = await buildPayout(address, payoutSats, { ...options, network: net, chain, ownerMnemonic, exclude: usedInputs });
      } catch (err) {
        results.push({ ...entry, status: 'not-paid-yet', error: err.message });
        continue;
      }
      // Recorded before broadcasting, so a crash can never lead to a second payment.
      appendPayout({
        type: 'payout',
        v: 1,
        status: 'pending',
        time: new Date().toISOString(),
        blockHash,
        visitor: address,
        rewardSats: String(rewardSats),
        amountSats: String(payoutSats),
        txid: built.txid,
        inputs: built.inputs,
      });
      for (const i of built.inputs) usedInputs.add(i);
      try {
        const txid = await chain.broadcast(built.hex);
        if (txid !== built.txid) throw new Error(`broadcast returned ${txid}`);
      } catch (err) {
        results.push({ ...entry, status: 'needs-review', txid: built.txid, error: err.message });
        continue;
      }
      appendPayout({ type: 'payout', v: 1, status: 'sent', time: new Date().toISOString(), blockHash, txid: built.txid, amountSats: String(payoutSats) });
      results.push({ ...entry, status: 'paid', txid: built.txid, feeSats: built.feeSats });
    }
    return results;
  }
}
