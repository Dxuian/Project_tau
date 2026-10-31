// The payout service: the library's auditor, payout engine and chain clients,
// wired with your config, your stores and your key. Runtime-neutral (Node and
// Cloudflare Workers); the entry points add the transport.
import { createShareAuditor } from '../tau-crypto/dist/bridge.js';
import { payoutAll, verifyPayout } from '../tau-crypto/dist/payouts.js';
import { bitcoinCore, esplora, isValidAddress, walletFromMnemonic } from '../tau-crypto/dist/wallet.js';

/** JSON with bigints as strings. */
export const toJson = (value) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));

export function chainFromConfig(chain) {
  return chain.type === 'bitcoin-core' ? bitcoinCore({ url: chain.url, user: chain.user, pass: chain.pass }) : esplora(chain.url);
}

/** host:port of a stratum URL (the bridge's allowlist entry). */
export function poolTarget(pool) {
  const m = /^stratum\+(?:tcp|ssl|tcps):\/\/(\[[0-9a-f:.]+\]|[a-z0-9._-]+):(\d{1,5})\/?$/i.exec(String(pool).trim());
  if (!m) throw new Error(`invalid pool URL ${pool}`);
  return `${m[1].toLowerCase()}:${m[2]}`;
}

/**
 * @param config  from loadConfig()
 * @param deps    { shares, ledger, chain, ownerMnemonic?, log? }. Without
 *                ownerMnemonic the service records shares but can't pay.
 */
export function createPayoutService(config, { shares, ledger, chain, ownerMnemonic, log = () => {} }) {
  if (ownerMnemonic && walletFromMnemonic(ownerMnemonic, { network: config.network }).address !== config.ownerAddress) {
    throw new Error('OWNER_MNEMONIC is not the wallet of TAU_OWNER_ADDRESS');
  }
  const intercept = createShareAuditor({
    poolUser: config.ownerAddress,
    network: config.network,
    onShare: (record) => shares.add(record),
    onResult: (result) => shares.addResult?.(result),
    log,
  });
  const payoutOptions = () => {
    if (!ownerMnemonic) throw Object.assign(new Error('OWNER_MNEMONIC is not set: this deployment records shares but cannot pay'), { status: 503 });
    return {
      shares,
      ledger,
      chain,
      ownerMnemonic,
      sharePercent: config.clientSharePercent,
      network: config.network,
      minConfirmations: config.minConfirmations,
      maxFeeRate: config.maxFeeRate,
    };
  };

  async function handleHttp({ method, path, origin, body }) {
    const headers = { 'content-type': 'application/json; charset=utf-8' };
    if (origin && config.origins.includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers.vary = 'Origin';
    }
    const reply = (status, value) => ({ status, headers, body: toJson(value) });
    if (method === 'OPTIONS') {
      return { status: 204, headers: { ...headers, 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': 'content-type' }, body: '' };
    }
    if (method === 'GET' && path === '/health') {
      return reply(200, { ok: true, target: config.target, network: config.network, pool: config.pool, ownerAddress: config.ownerAddress, canPay: !!ownerMnemonic });
    }
    if (method === 'POST' && path === '/payout') {
      let address;
      try {
        address = JSON.parse(body || '{}').address;
      } catch {
        return reply(400, { error: 'expected a JSON body {"address": "..."}' });
      }
      if (!isValidAddress(address, config.network)) return reply(400, { error: `address must be a ${config.network} Bitcoin address` });
      try {
        return reply(200, { address, results: await verifyPayout(address, payoutOptions()) });
      } catch (err) {
        log(`payout for ${address} failed: ${err.message}`);
        return reply(err.status ?? 500, { error: err.message });
      }
    }
    return reply(404, { error: 'not found' });
  }

  return {
    config,
    /** The bridge interceptor (createBridge / createWorkerBridge `intercept`). */
    intercept,
    verifyPayout: (address) => verifyPayout(address, payoutOptions()),
    payoutAll: () => payoutAll(payoutOptions()),
    /** POST /payout {"address"} -> verifyPayout; GET /health. Returns { status, headers, body }. */
    handleHttp,
  };
}
