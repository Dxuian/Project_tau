// Cloudflare target: npx wrangler deploy -c cloudflare/wrangler.toml, from server/ (see README).
// One Worker serves the payout bridge (WebSocket upgrades) and the payout API
// (POST /payout, GET /health); records live in D1; a cron trigger, if
// configured, pays every visitor with a mature block.
//
// The Cloudflare-specific part is here, not in the library: the library's
// fetch bridge gets Workers' TCP sockets (connect) and WebSocketPair.
import { connect } from 'cloudflare:sockets';
import { createFetchBridge, poolTarget } from '../../tau-crypto/dist/bridge.js';
import { createPayoutApi, toJson } from '../api.js';
import { chainFromConfig, loadConfig } from '../config.js';
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

let app; // per isolate

function setup(env) {
  const config = loadConfig(env, { target: 'cloudflare' });
  const db = env[config.storage.binding];
  if (!db) throw new Error(`no D1 binding named ${config.storage.binding} (see wrangler.toml)`);
  const { shares, ledger } = d1Stores(db);
  const log = (line) => console.log(line);
  const api = createPayoutApi(config, { shares, ledger, chain: chainFromConfig(config.chain), ownerMnemonic: env.OWNER_MNEMONIC, log });
  const bridge = createFetchBridge({
    allow: [poolTarget(config.pool)],
    origins: config.origins,
    intercept: api.intercept,
    log,
    connect: openPool,
    upgrade: acceptWebSocket,
    peer: (request) => request.headers.get('cf-connecting-ip'),
  });
  return { api, bridge };
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
  },
};
