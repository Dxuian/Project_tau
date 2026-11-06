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

/**
 * Every event carries `app` with this value, which tells this site's events apart
 * from any other app's in PostHog (the payout Worker's health event carries it too).
 */
export const ANALYTICS_APP = 'project-tau';

/**
 * A same-origin path the site proxies to PostHog (app/ingest). The browser sends
 * events here, not to PostHog's own domain, so ad blockers (which block that domain
 * and silently drop 10-25% of events) don't see them.
 */
export const INGEST_PATH = '/ingest';

/**
 * The PostHog ingestion host: POSTHOG_HOST (default PostHog US), or null when unusable.
 * The ingest proxy (app/ingest) forwards to it server-side; it never reaches the browser.
 */
export function posthogHost(env = process.env) {
  const host = String(env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
  return /^https?:\/\//.test(host) ? host : null;
}

/**
 * PostHog, for the browser: POSTHOG_KEY (the project's public phc_ key) and
 * POSTHOG_HOST (default PostHog US). Analytics is off when the key is unset or
 * malformed; it never stops the site from working. The browser sends events to a
 * same-origin path (apiHost), which the site proxies to PostHog; uiHost keeps
 * "view in PostHog" links pointing at the real host.
 */
export function analyticsConfig(env = process.env) {
  const key = String(env.POSTHOG_KEY ?? '').trim();
  const host = posthogHost(env);
  if (!/^phc_[A-Za-z0-9]+$/.test(key) || !host) return null;
  return { key, apiHost: INGEST_PATH, uiHost: host, app: ANALYTICS_APP, network: env.NETWORK || 'mainnet' };
}
