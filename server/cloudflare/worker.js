// Cloudflare target: npx wrangler deploy -c cloudflare/wrangler.toml, from server/ (see README).
// One Worker serves the payout bridge (WebSocket upgrades) and the payout API
// (GET /address, POST /payout, GET /health). Records live in TiDB Cloud
// (TAU_STORAGE=tidb, connection string in the DB_PASSWORD secret) or in D1.
// A cron trigger, if configured, pays every visitor with a mature block and
// purges old ordinary shares.
//
// The Cloudflare-specific part is here, not in the library: the library's
// fetch bridge gets Workers' TCP sockets (connect) and WebSocketPair.
import { connect } from 'cloudflare:sockets';
import { createFetchBridge, poolTarget } from '../../tau-crypto/dist/bridge.js';
import { createPayoutApi, toJson } from '../api.js';
import { chainFromConfig, loadConfig, shareCutoff } from '../config.js';
import { tidbDatabase } from '../tidb/client.js';
import { tidbStores } from '../tidb/tidb-stores.js';
import { d1Stores } from './d1-stores.js';

/** The pool connection: Workers' TCP socket (readable, writable, opened, close). */
const openPool = ({ host, port, tls }) => connect({ hostname: host, port }, { secureTransport: tls ? 'on' : 'off', allowHalfOpen: false });

/** Accepts the upgrade: the Worker keeps one end of a WebSocketPair, the 101 response hands the other to the client. */
function acceptWebSocket() {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  return { socket: server, response: new Response(null, { status: 101, webSocket: client }) };
}

function storesFor(config, env) {
  if (config.storage.type === 'tidb') return tidbStores(tidbDatabase(env.DB_PASSWORD, { database: config.storage.database }));
  const db = env[config.storage.binding];
  if (!db) throw new Error(`no D1 binding named ${config.storage.binding} (see wrangler.toml)`);
  return d1Stores(db);
}

let app; // per isolate

function setup(env) {
  const config = loadConfig(env, { target: 'cloudflare' });
  const stores = storesFor(config, env);
  const log = (line) => console.log(line);
  const api = createPayoutApi(config, { shares: stores.shares, ledger: stores.ledger, chain: chainFromConfig(config.chain), ownerMnemonic: env.OWNER_MNEMONIC, log });
  const bridge = createFetchBridge({
    allow: [poolTarget(config.pool)],
    origins: config.origins,
    intercept: api.intercept,
    log,
    connect: openPool,
    upgrade: acceptWebSocket,
    peer: (request) => request.headers.get('cf-connecting-ip'),
  });
  return { config, stores, api, bridge };
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
    return a.api.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    const a = get(env);
    if (a.error) throw a.error;
    ctx.waitUntil(a.api.payoutAll().then((r) => console.log(`payout sweep: ${toJson(r)}`)));
    const cutoff = shareCutoff(a.config);
    if (cutoff) ctx.waitUntil(a.stores.purge(cutoff).then((n) => console.log(`purged ${n} old share records`)));
  },
};
