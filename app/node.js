// The Node target: one HTTP server hosts the payout bridge (WebSocket) and the
// payout API (POST /payout, GET /health).
import { createServer } from 'node:http';
import { createBridge } from '../cpuminer-opt-js/dist/bridge.js';
import { memoryStores } from '../cpuminer-opt-js/dist/payouts.js';
import { loadConfig } from './config.js';
import { chainFromConfig, createPayoutService, poolTarget } from './service.js';
import { fileStores } from './stores/file.js';

const MAX_BODY = 4096;

export function storesFromConfig(config) {
  if (config.storage.type === 'file') return fileStores(config.storage.dir);
  if (config.storage.type === 'memory') return memoryStores();
  throw new Error(`storage ${config.storage.type} isn't available on Node`);
}

/**
 * Starts the Node target. `deps` may supply stores, chain, ownerMnemonic
 * (default OWNER_MNEMONIC from the environment) and log.
 */
export async function startNodeServer(config, deps = {}) {
  const { log = () => {} } = deps;
  const { shares, ledger } = deps.stores ?? storesFromConfig(config);
  const service = createPayoutService(config, {
    shares,
    ledger,
    chain: deps.chain ?? chainFromConfig(config.chain),
    ownerMnemonic: 'ownerMnemonic' in deps ? deps.ownerMnemonic : process.env.OWNER_MNEMONIC,
    log,
  });
  const server = createServer((req, res) => {
    let body = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) tooBig = true;
    });
    req.on('end', async () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      const r = tooBig
        ? { status: 413, headers: { 'content-type': 'application/json' }, body: '{"error":"body too large"}' }
        : await service.handleHttp({ method: req.method, path, origin: req.headers.origin, body });
      res.writeHead(r.status, r.headers);
      res.end(r.body);
    });
  });
  const bridge = await createBridge({ server, allow: [poolTarget(config.pool)], origins: config.origins, intercept: service.intercept, log });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.listen, config.host, () => resolve());
  });
  let sweep = null;
  if (config.sweepIntervalMs > 0) {
    sweep = setInterval(() => {
      service.payoutAll().then(
        (r) => Object.keys(r).length && log(`payout sweep: ${JSON.stringify(Object.keys(r))}`),
        (err) => log(`payout sweep failed: ${err.message}`),
      );
    }, config.sweepIntervalMs);
    sweep.unref();
  }
  return {
    port: server.address().port,
    service,
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
