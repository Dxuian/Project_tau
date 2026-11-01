// Your payout service's settings. Every value the library needs is a parameter
// here, read from environment variables (Node) or Worker vars (Cloudflare).
// The secrets, OWNER_MNEMONIC and DB_PASSWORD (the TiDB connection string), are
// read separately by the entry points.
import { bitcoinCore, esplora, isValidAddress } from '../tau-crypto/dist/wallet.js';

export const DEFAULTS = Object.freeze({
  /** Where the bridge and payout service run: 'node' (node/server.js) or 'cloudflare' (cloudflare/worker.js). */
  target: 'node',
  network: 'mainnet',
  pool: 'stratum+tcp://solo.ckpool.org:3333',
  /** Required: the owner wallet's first address. Payout change goes here (and every block, with addressPeriodMs 0). */
  ownerAddress: undefined,
  /** The owner wallet's account public key (accountXpub): derives the hourly addresses without the words. */
  ownerXpub: undefined,
  /** A fresh owner address for visitors this often (slot N = receive index N); 0: everyone mines to ownerAddress. */
  addressPeriodMs: 3_600_000,
  /** When slot 1 starts (ISO time). */
  addressEpoch: '2026-01-01T00:00:00Z',
  /** The visitor's share of a block they found, whole percent. */
  clientSharePercent: 10,
  minConfirmations: 100,
  maxFeeRate: 200,
  chain: Object.freeze({ type: 'esplora', url: 'https://mempool.space/api' }),
  storage: Object.freeze({ type: 'file', dir: 'payout-ledger' }),
  /** Delete ordinary (non-block) shares older than this many days; 0 keeps them all. */
  shareRetentionDays: 30,
  /** Web pages allowed to connect and call /payout. */
  origins: Object.freeze([]),
  listen: 8080,
  host: undefined,
  /** Node: run payoutAll() this often (0 = only on request). Cloudflare uses a cron trigger instead. */
  sweepIntervalMs: 0,
  /** Where the Worker's cron sends its health event (health.js): a PostHog project key (phc_, public) and host; no key, no event. */
  posthog: Object.freeze({ key: undefined, host: 'https://us.i.posthog.com' }),
  /** The site, which each health event checks (GET /api/address); unset, no check. */
  siteUrl: undefined,
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
 *   TAU_TARGET, TAU_NETWORK, TAU_POOL, TAU_OWNER_ADDRESS, TAU_OWNER_XPUB,
 *   TAU_ADDRESS_PERIOD_MS, TAU_ADDRESS_EPOCH, TAU_CLIENT_SHARE_PERCENT,
 *   TAU_MIN_CONFIRMATIONS, TAU_MAX_FEE_RATE,
 *   TAU_CHAIN (esplora | bitcoin-core), TAU_CHAIN_URL, TAU_CHAIN_USER, TAU_CHAIN_PASS,
 *   TAU_STORAGE (file | d1 | tidb | memory), TAU_STORAGE_DIR, TAU_D1_BINDING, TAU_DB_NAME,
 *   TAU_SHARE_RETENTION_DAYS,
 *   TAU_ORIGINS (comma-separated), TAU_LISTEN, TAU_HOST, TAU_SWEEP_INTERVAL_MS,
 *   TAU_POSTHOG_KEY, TAU_POSTHOG_HOST, TAU_SITE_URL.
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
    ownerXpub: env.TAU_OWNER_XPUB || DEFAULTS.ownerXpub,
    addressPeriodMs: int(env.TAU_ADDRESS_PERIOD_MS, DEFAULTS.addressPeriodMs, 'TAU_ADDRESS_PERIOD_MS'),
    addressEpoch: env.TAU_ADDRESS_EPOCH || DEFAULTS.addressEpoch,
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
        : storageType === 'tidb'
          ? { type: 'tidb', database: env.TAU_DB_NAME || 'tau' }
          : storageType === 'file'
            ? { type: 'file', dir: env.TAU_STORAGE_DIR ?? DEFAULTS.storage.dir }
            : { type: storageType },
    shareRetentionDays: int(env.TAU_SHARE_RETENTION_DAYS, DEFAULTS.shareRetentionDays, 'TAU_SHARE_RETENTION_DAYS'),
    origins: list(env.TAU_ORIGINS),
    listen: int(env.TAU_LISTEN, DEFAULTS.listen, 'TAU_LISTEN'),
    host: env.TAU_HOST ?? DEFAULTS.host,
    sweepIntervalMs: int(env.TAU_SWEEP_INTERVAL_MS, DEFAULTS.sweepIntervalMs, 'TAU_SWEEP_INTERVAL_MS'),
    // Unusable values only stop the health event (health.js says why), never the service.
    posthog: { key: env.TAU_POSTHOG_KEY || DEFAULTS.posthog.key, host: env.TAU_POSTHOG_HOST || DEFAULTS.posthog.host },
    siteUrl: env.TAU_SITE_URL || DEFAULTS.siteUrl,
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
  if (!Number.isSafeInteger(c.addressPeriodMs) || (c.addressPeriodMs !== 0 && c.addressPeriodMs < 1000)) {
    throw new Error('addressPeriodMs (TAU_ADDRESS_PERIOD_MS) must be 0 or at least 1000');
  }
  if (!Number.isFinite(Date.parse(c.addressEpoch))) throw new Error('addressEpoch (TAU_ADDRESS_EPOCH) must be an ISO time');
  if (!Number.isInteger(c.clientSharePercent) || c.clientSharePercent < 1 || c.clientSharePercent > 100) {
    throw new Error('clientSharePercent must be a whole number from 1 to 100');
  }
  if (!(c.minConfirmations >= 100)) throw new Error('minConfirmations must be at least 100');
  if (!(c.maxFeeRate > 0)) throw new Error('maxFeeRate must be positive');
  if (c.chain?.type === 'bitcoin-core' && !c.chain.url) throw new Error('TAU_CHAIN_URL is required for bitcoin-core');
  if (!['esplora', 'bitcoin-core'].includes(c.chain?.type)) throw new Error('chain must be esplora or bitcoin-core');
  if (!['file', 'd1', 'tidb', 'memory'].includes(c.storage?.type)) throw new Error('storage must be file, d1, tidb or memory');
  if (c.target === 'cloudflare' && !['d1', 'tidb'].includes(c.storage.type)) throw new Error('the cloudflare target stores records in D1 or TiDB (TAU_STORAGE=d1 or tidb)');
  if (c.target === 'node' && c.storage.type === 'd1') throw new Error('D1 storage is for the cloudflare target');
  if (!Number.isSafeInteger(c.shareRetentionDays) || c.shareRetentionDays < 0) throw new Error('shareRetentionDays (TAU_SHARE_RETENTION_DAYS) must be 0 or more');
  return c;
}

/** The chain client for config.chain. */
export function chainFromConfig(chain) {
  return chain.type === 'bitcoin-core' ? bitcoinCore({ url: chain.url, user: chain.user, pass: chain.pass }) : esplora(chain.url);
}

/** config's address period as the library's SlotOptions, or undefined for one address. */
export function addressPeriod(config) {
  return config.addressPeriodMs > 0 ? { periodMs: config.addressPeriodMs, epochMs: Date.parse(config.addressEpoch) } : undefined;
}

/** The ISO time before which ordinary shares may be purged, or null when they're kept forever. */
export function shareCutoff(config, now = Date.now()) {
  return config.shareRetentionDays > 0 ? new Date(now - config.shareRetentionDays * 86_400_000).toISOString() : null;
}
