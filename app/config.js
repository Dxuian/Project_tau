// Your payout service's settings. Every value the library needs is a parameter
// here, read from environment variables (Node) or Worker vars (Cloudflare).
// The only secret, OWNER_MNEMONIC, is read separately by the entry points.
import { isValidAddress } from '../cpuminer-opt-js/dist/wallet.js';

export const DEFAULTS = Object.freeze({
  /** Where the bridge and payout service run: 'node' (server.js) or 'cloudflare' (worker.js). */
  target: 'node',
  network: 'mainnet',
  pool: 'stratum+tcp://solo.ckpool.org:3333',
  /** Required: the address the pool pays (and visitors are logged in as). */
  ownerAddress: undefined,
  /** The visitor's share of a block they found, whole percent. */
  clientSharePercent: 10,
  minConfirmations: 100,
  maxFeeRate: 200,
  chain: Object.freeze({ type: 'esplora', url: 'https://mempool.space/api' }),
  storage: Object.freeze({ type: 'file', dir: 'payout-ledger' }),
  /** Web pages allowed to connect and call /payout. */
  origins: Object.freeze([]),
  listen: 8080,
  host: undefined,
  /** Node: run payoutAll() this often (0 = only on request). Cloudflare uses a cron trigger instead. */
  sweepIntervalMs: 0,
});

const int = (value, fallback, name) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`${name} must be a whole number`);
  return n;
};
const list = (value) => (value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : []);

/**
 * The service config from environment variables:
 *   TAU_TARGET, TAU_NETWORK, TAU_POOL, TAU_OWNER_ADDRESS, TAU_CLIENT_SHARE_PERCENT,
 *   TAU_MIN_CONFIRMATIONS, TAU_MAX_FEE_RATE,
 *   TAU_CHAIN (esplora | bitcoin-core), TAU_CHAIN_URL, TAU_CHAIN_USER, TAU_CHAIN_PASS,
 *   TAU_STORAGE (file | d1 | memory), TAU_STORAGE_DIR, TAU_D1_BINDING,
 *   TAU_ORIGINS (comma-separated), TAU_LISTEN, TAU_HOST, TAU_SWEEP_INTERVAL_MS.
 * `overrides` (an object with the same keys as DEFAULTS) win over the environment.
 */
export function loadConfig(env = globalThis.process?.env ?? {}, overrides = {}) {
  const chainType = env.TAU_CHAIN ?? DEFAULTS.chain.type;
  const storageType = env.TAU_STORAGE ?? (env.TAU_TARGET === 'cloudflare' ? 'd1' : DEFAULTS.storage.type);
  const config = {
    target: env.TAU_TARGET ?? DEFAULTS.target,
    network: env.TAU_NETWORK ?? DEFAULTS.network,
    pool: env.TAU_POOL ?? DEFAULTS.pool,
    ownerAddress: env.TAU_OWNER_ADDRESS ?? DEFAULTS.ownerAddress,
    clientSharePercent: int(env.TAU_CLIENT_SHARE_PERCENT, DEFAULTS.clientSharePercent, 'TAU_CLIENT_SHARE_PERCENT'),
    minConfirmations: int(env.TAU_MIN_CONFIRMATIONS, DEFAULTS.minConfirmations, 'TAU_MIN_CONFIRMATIONS'),
    maxFeeRate: int(env.TAU_MAX_FEE_RATE, DEFAULTS.maxFeeRate, 'TAU_MAX_FEE_RATE'),
    chain:
      chainType === 'bitcoin-core'
        ? { type: 'bitcoin-core', url: env.TAU_CHAIN_URL, user: env.TAU_CHAIN_USER, pass: env.TAU_CHAIN_PASS }
        : { type: chainType, url: env.TAU_CHAIN_URL ?? DEFAULTS.chain.url },
    storage:
      storageType === 'd1'
        ? { type: 'd1', binding: env.TAU_D1_BINDING ?? 'DB' }
        : storageType === 'file'
          ? { type: 'file', dir: env.TAU_STORAGE_DIR ?? DEFAULTS.storage.dir }
          : { type: storageType },
    origins: list(env.TAU_ORIGINS),
    listen: int(env.TAU_LISTEN, DEFAULTS.listen, 'TAU_LISTEN'),
    host: env.TAU_HOST ?? DEFAULTS.host,
    sweepIntervalMs: int(env.TAU_SWEEP_INTERVAL_MS, DEFAULTS.sweepIntervalMs, 'TAU_SWEEP_INTERVAL_MS'),
    ...overrides,
  };
  return validateConfig(config);
}

/** Throws a clear error for an unusable config; returns it otherwise. */
export function validateConfig(c) {
  if (!['node', 'cloudflare'].includes(c.target)) throw new Error('target must be node or cloudflare');
  if (!['mainnet', 'testnet', 'regtest'].includes(c.network)) throw new Error('network must be mainnet, testnet or regtest');
  if (!/^stratum\+(tcp|ssl|tcps):\/\//.test(String(c.pool))) throw new Error('pool must be a stratum+tcp:// or stratum+ssl:// URL');
  if (!isValidAddress(c.ownerAddress, c.network)) throw new Error(`ownerAddress (TAU_OWNER_ADDRESS) must be a ${c.network} Bitcoin address`);
  if (!Number.isInteger(c.clientSharePercent) || c.clientSharePercent < 1 || c.clientSharePercent > 100) {
    throw new Error('clientSharePercent must be a whole number from 1 to 100');
  }
  if (!(c.minConfirmations >= 100)) throw new Error('minConfirmations must be at least 100');
  if (!(c.maxFeeRate > 0)) throw new Error('maxFeeRate must be positive');
  if (c.chain?.type === 'bitcoin-core' && !c.chain.url) throw new Error('TAU_CHAIN_URL is required for bitcoin-core');
  if (!['esplora', 'bitcoin-core'].includes(c.chain?.type)) throw new Error('chain must be esplora or bitcoin-core');
  if (!['file', 'd1', 'memory'].includes(c.storage?.type)) throw new Error('storage must be file, d1 or memory');
  if (c.target === 'cloudflare' && c.storage.type !== 'd1') throw new Error('the cloudflare target stores records in D1 (TAU_STORAGE=d1)');
  if (c.target === 'node' && c.storage.type === 'd1') throw new Error('D1 storage is for the cloudflare target');
  return c;
}
