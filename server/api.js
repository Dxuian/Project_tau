// The payout HTTP API, as a web-standard fetch(request) handler:
//   GET  /address  this hour's mining address (cacheable until the hour ends)
//   POST /payout   {"address"}: pays that visitor for each block they provably found
//   GET  /health
// The Worker, a Next.js route handler or a Pages Function can call it directly;
// the Node server adapts node:http to it. It builds the library's payout
// service from your config, stores and key.
import { createPayoutService } from '../tau-crypto/dist/payouts.js';
import { isValidAddress } from '../tau-crypto/dist/wallet.js';
import { addressPeriod } from './config.js';

/** Larger request bodies are refused with 413. */
export const MAX_BODY_BYTES = 4096;

/** JSON with bigints as strings. */
export const toJson = (value) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));

/** The body as text, or null once it passes `max` bytes (the rest isn't read). */
async function readBody(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

/**
 * @param config  from loadConfig()
 * @param deps    { shares, ledger, chain, ownerMnemonic?, log?, now? }. Without
 *                ownerMnemonic the service records shares but can't pay.
 */
export function createPayoutApi(config, { shares, ledger, chain, ownerMnemonic, log = () => {}, now = Date.now }) {
  let service;
  try {
    service = createPayoutService({
      ownerAddress: config.ownerAddress,
      ownerMnemonic,
      ownerXpub: config.ownerXpub,
      addressPeriod: addressPeriod(config),
      now,
      sharePercent: config.clientSharePercent,
      network: config.network,
      shares,
      ledger,
      chain,
      minConfirmations: config.minConfirmations,
      maxFeeRate: config.maxFeeRate,
      log,
    });
  } catch (err) {
    // Name the settings, not the library's parameters.
    if (/ownerMnemonic is not the wallet of ownerAddress/.test(err.message)) throw new Error('OWNER_MNEMONIC is not the wallet of TAU_OWNER_ADDRESS');
    if (/ownerXpub is not the wallet of ownerAddress/.test(err.message)) throw new Error('TAU_OWNER_XPUB is not the wallet of TAU_OWNER_ADDRESS');
    if (/need ownerXpub or ownerMnemonic/.test(err.message)) throw new Error('hourly addresses need TAU_OWNER_XPUB or OWNER_MNEMONIC');
    throw err;
  }

  async function fetch(request) {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get('origin');
    const headers = { 'content-type': 'application/json; charset=utf-8' };
    if (origin && config.origins.includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers.vary = 'Origin';
    }
    const reply = (status, value) => new Response(toJson(value), { status, headers });
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...headers, 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': 'content-type' },
      });
    }
    if (request.method === 'GET' && pathname === '/health') {
      return reply(200, { ok: true, target: config.target, network: config.network, pool: config.pool, ownerAddress: config.ownerAddress, canPay: service.canPay });
    }
    if (request.method === 'GET' && pathname === '/address') {
      let mining;
      try {
        mining = service.addressFor();
      } catch (err) {
        return reply(500, { error: err.message });
      }
      // Cacheable (a CDN, the site's fetch cache) until this address's time is up.
      const seconds = mining.until ? Math.max(0, Math.floor((Date.parse(mining.until) - now()) / 1000)) : 300;
      return new Response(toJson({ ...mining, network: config.network }), {
        status: 200,
        headers: { ...headers, 'cache-control': `public, max-age=${seconds}` },
      });
    }
    if (request.method === 'POST' && pathname === '/payout') {
      const body = await readBody(request, MAX_BODY_BYTES);
      if (body === null) return reply(413, { error: 'body too large' });
      let address;
      try {
        address = JSON.parse(body || '{}').address;
      } catch {
        return reply(400, { error: 'expected a JSON body {"address": "..."}' });
      }
      if (!isValidAddress(address, config.network)) return reply(400, { error: `address must be a ${config.network} Bitcoin address` });
      if (!service.canPay) return reply(503, { error: 'OWNER_MNEMONIC is not set: this deployment records shares but cannot pay' });
      try {
        return reply(200, { address, results: await service.verifyPayout(address) });
      } catch (err) {
        log(`payout for ${address} failed: ${err.message}`);
        return reply(500, { error: err.message });
      }
    }
    return reply(404, { error: 'not found' });
  }

  return {
    config,
    /** The library's payout service (interceptor, verifyPayout, payoutAll). */
    service,
    /** The bridge interceptor (createBridge / createFetchBridge `intercept`). */
    intercept: service.intercept,
    /** The owner address visitors who connect at `time` mine to: { address, index, from, until }. */
    addressFor: (time) => service.addressFor(time),
    verifyPayout: (address) => service.verifyPayout(address),
    payoutAll: () => service.payoutAll(),
    /** POST /payout {"address"} -> verifyPayout; GET /health; CORS for config.origins. */
    fetch,
  };
}
