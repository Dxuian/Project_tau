// Cloudflare target: npx wrangler deploy (see wrangler.toml and README).
// One Worker serves the payout bridge (WebSocket upgrades) and the payout API
// (POST /payout, GET /health); records live in D1; a cron trigger, if
// configured, pays every visitor with a mature block.
import { connect } from 'cloudflare:sockets';
import { createWorkerBridge } from './cpuminer-opt-js/dist/bridge.js';
import { loadConfig } from './app/config.js';
import { chainFromConfig, createPayoutService, poolTarget, toJson } from './app/service.js';
import { d1Stores } from './app/stores/d1.js';

let app; // per isolate

function setup(env) {
  const config = loadConfig(env, { target: 'cloudflare' });
  const db = env[config.storage.binding];
  if (!db) throw new Error(`no D1 binding named ${config.storage.binding} (see wrangler.toml)`);
  const { shares, ledger } = d1Stores(db);
  const log = (line) => console.log(line);
  const service = createPayoutService(config, { shares, ledger, chain: chainFromConfig(config.chain), ownerMnemonic: env.OWNER_MNEMONIC, log });
  const bridge = createWorkerBridge({ allow: [poolTarget(config.pool)], origins: config.origins, intercept: service.intercept, connect, log });
  return { service, bridge };
}

function get(env) {
  try {
    app ??= setup(env);
    return app;
  } catch (err) {
    return { error: err };
  }
}

export default {
  async fetch(request, env) {
    const a = get(env);
    if (a.error) return new Response(`configuration error: ${a.error.message}\n`, { status: 500 });
    if ((request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket') return a.bridge.fetch(request);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? (await request.text()).slice(0, 4096) : '';
    const r = await a.service.handleHttp({ method: request.method, path: url.pathname, origin: request.headers.get('origin'), body });
    return new Response(r.body || null, { status: r.status, headers: r.headers });
  },
  async scheduled(_event, env, ctx) {
    const a = get(env);
    if (a.error) throw a.error;
    ctx.waitUntil(a.service.payoutAll().then((r) => console.log(`payout sweep: ${toJson(r)}`)));
  },
};
