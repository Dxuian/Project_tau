// The site's settings, read on the server at request time (Node env vars on
// Vercel or `next start`, Worker vars on Cloudflare), so one build serves any
// deployment. Only what a page needs is passed on to the browser.
const POOL = 'stratum+tcp://solo.ckpool.org:3333';

export function siteConfig(env = process.env) {
  const payoutApi = String(env.PAYOUT_API_URL ?? '').replace(/\/+$/, '');
  const bridgeUrl = String(env.BRIDGE_URL ?? '');
  const network = env.NETWORK || 'mainnet';
  if (!/^https?:\/\//.test(payoutApi)) throw new Error('PAYOUT_API_URL must be the payout service URL (http:// or https://)');
  if (!/^wss?:\/\//.test(bridgeUrl)) throw new Error('BRIDGE_URL must be the bridge URL (ws:// or wss://)');
  if (!['mainnet', 'testnet', 'regtest'].includes(network)) throw new Error('NETWORK must be mainnet, testnet or regtest');
  return {
    /** The payout service (server/): GET /address, POST /payout. Server-side only. */
    payoutApi,
    /** Where browsers mine: the payout service's WebSocket bridge. */
    bridgeUrl,
    /** The pool that bridge connects to. */
    pool: env.POOL_URL || POOL,
    network,
    /** The miner, served as static files (scripts/copy-miner.mjs). */
    minerUrl: env.MINER_URL || '/tau-crypto/index.js',
  };
}
