// The Node target: one HTTP server hosts the payout bridge (WebSocket, the
// library's Node bridge) and the payout API (POST /payout, GET /health).
import { createServer } from 'node:http';
import { createBridge, poolTarget } from '../../tau-crypto/dist/bridge/node.js';
import { memoryStores } from '../../tau-crypto/dist/payouts.js';
import { createPayoutApi, MAX_BODY_BYTES } from '../api.js';
import { chainFromConfig, loadConfig } from '../config.js';
import { fileStores } from './file-stores.js';

export function storesFromConfig(config) {
  if (config.storage.type === 'file') return fileStores(config.storage.dir);
  if (config.storage.type === 'memory') return memoryStores();
  throw new Error(`storage ${config.storage.type} isn't available on Node`);
}

/** node:http request -> web Request (only what the API reads) -> api.fetch -> node:http response. */
function serveApi(api) {
  return (req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', async () => {
      let response;
      if (size > MAX_BODY_BYTES) {
        response = new Response('{"error":"body too large"}', { status: 413, headers: { 'content-type': 'application/json' } });
      } else {
        const headers = {};
        if (req.headers.origin) headers.origin = req.headers.origin;
        if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
        const method = req.method ?? 'GET';
        const body = method === 'GET' || method === 'HEAD' || !chunks.length ? undefined : Buffer.concat(chunks);
        response = await api.fetch(new Request(new URL(req.url ?? '/', 'http://localhost'), { method, headers, body }));
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  };
}

/**
 * Starts the Node target. `deps` may supply stores, chain, ownerMnemonic
 * (default OWNER_MNEMONIC from the environment) and log.
 */
export async function startNodeServer(config, deps = {}) {
  const { log = () => {} } = deps;
  const { shares, ledger } = deps.stores ?? storesFromConfig(config);
  const api = createPayoutApi(config, {
    shares,
    ledger,
    chain: deps.chain ?? chainFromConfig(config.chain),
    ownerMnemonic: 'ownerMnemonic' in deps ? deps.ownerMnemonic : process.env.OWNER_MNEMONIC,
    log,
  });
  const server = createServer(serveApi(api));
  const bridge = await createBridge({ server, allow: [poolTarget(config.pool)], origins: config.origins, intercept: api.intercept, log });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.listen, config.host, () => resolve());
  });
  let sweep = null;
  if (config.sweepIntervalMs > 0) {
    sweep = setInterval(() => {
      api.payoutAll().then(
        (r) => Object.keys(r).length && log(`payout sweep: ${JSON.stringify(Object.keys(r))}`),
        (err) => log(`payout sweep failed: ${err.message}`),
      );
    }, config.sweepIntervalMs);
    sweep.unref();
  }
  return {
    port: server.address().port,
    api,
    async close() {
      if (sweep) clearInterval(sweep);
      await bridge.close();
      await new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
    },
  };
}

/** startNodeServer with the config from the environment (+ overrides). */
export function startPayoutBridge(overrides = {}, deps = {}) {
  return startNodeServer(loadConfig(process.env, { target: 'node', ...overrides }), deps);
}
