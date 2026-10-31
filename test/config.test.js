// loadConfig(): every setting is a parameter, and bad settings fail clearly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayoutService, createWallet, loadConfig, memoryStores, poolTarget } from '../btc.js';
import { OWNER, OWNER_WORDS } from './helpers.js';

test('defaults, and overrides from the environment', () => {
  const c = loadConfig({ TAU_OWNER_ADDRESS: OWNER });
  assert.equal(c.target, 'node');
  assert.equal(c.pool, 'stratum+tcp://solo.ckpool.org:3333');
  assert.equal(c.clientSharePercent, 10);
  assert.deepEqual(c.chain, { type: 'esplora', url: 'https://mempool.space/api' });
  assert.deepEqual(c.storage, { type: 'file', dir: 'payout-ledger' });
  const d = loadConfig({
    TAU_TARGET: 'cloudflare',
    TAU_OWNER_ADDRESS: OWNER,
    TAU_CLIENT_SHARE_PERCENT: '25',
    TAU_POOL: 'stratum+ssl://pool.example:443',
    TAU_CHAIN: 'bitcoin-core',
    TAU_CHAIN_URL: 'http://node:8332',
    TAU_ORIGINS: 'https://a.example, https://b.example',
  });
  assert.equal(d.clientSharePercent, 25);
  assert.deepEqual(d.storage, { type: 'd1', binding: 'DB' }, 'cloudflare stores in D1');
  assert.deepEqual(d.origins, ['https://a.example', 'https://b.example']);
  assert.equal(d.chain.type, 'bitcoin-core');
  assert.equal(poolTarget(d.pool), 'pool.example:443');
});

test('rejects unusable settings', () => {
  const ok = { TAU_OWNER_ADDRESS: OWNER };
  assert.throws(() => loadConfig({}), /TAU_OWNER_ADDRESS/);
  assert.throws(() => loadConfig({ TAU_OWNER_ADDRESS: 'nope' }), /TAU_OWNER_ADDRESS/);
  assert.throws(() => loadConfig({ ...ok, TAU_NETWORK: 'regtest' }), /regtest Bitcoin address/);
  assert.throws(() => loadConfig({ ...ok, TAU_CLIENT_SHARE_PERCENT: '0' }), /1 to 100/);
  assert.throws(() => loadConfig({ ...ok, TAU_CLIENT_SHARE_PERCENT: '12.5' }), /whole number/);
  assert.throws(() => loadConfig({ ...ok, TAU_MIN_CONFIRMATIONS: '6' }), /at least 100/);
  assert.throws(() => loadConfig({ ...ok, TAU_TARGET: 'aws' }), /node or cloudflare/);
  assert.throws(() => loadConfig({ ...ok, TAU_POOL: 'http://pool' }), /stratum/);
  assert.throws(() => loadConfig({ ...ok, TAU_STORAGE: 'd1' }), /cloudflare target/);
  assert.throws(() => loadConfig({ ...ok, TAU_TARGET: 'cloudflare', TAU_STORAGE: 'file' }), /D1/);
  assert.throws(() => loadConfig({ ...ok, TAU_CHAIN: 'bitcoin-core' }), /TAU_CHAIN_URL/);
});

test("refuses an OWNER_MNEMONIC that isn't the owner address's wallet", () => {
  const config = loadConfig({ TAU_OWNER_ADDRESS: OWNER });
  const { shares, ledger } = memoryStores();
  assert.throws(() => createPayoutService(config, { shares, ledger, chain: {}, ownerMnemonic: createWallet().mnemonic }), /not the wallet/);
  assert.ok(createPayoutService(config, { shares, ledger, chain: {}, ownerMnemonic: OWNER_WORDS }));
});

test('the payout API: health, validation, CORS, and no key means no payouts', async () => {
  const config = loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_ORIGINS: 'https://site.example' });
  const { shares, ledger } = memoryStores();
  const recordOnly = createPayoutService(config, { shares, ledger, chain: {} });
  const health = await recordOnly.handleHttp({ method: 'GET', path: '/health' });
  assert.equal(JSON.parse(health.body).canPay, false);
  const visitor = createWallet().address;
  const r = await recordOnly.handleHttp({ method: 'POST', path: '/payout', origin: 'https://site.example', body: JSON.stringify({ address: visitor }) });
  assert.equal(r.status, 503);
  assert.equal(r.headers['access-control-allow-origin'], 'https://site.example');
  const evil = await recordOnly.handleHttp({ method: 'POST', path: '/payout', origin: 'https://evil.example', body: '{}' });
  assert.equal(evil.status, 400);
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
  assert.equal((await recordOnly.handleHttp({ method: 'POST', path: '/payout', body: 'not json' })).status, 400);
  assert.equal((await recordOnly.handleHttp({ method: 'GET', path: '/nope' })).status, 404);
  assert.equal((await recordOnly.handleHttp({ method: 'OPTIONS', path: '/payout', origin: 'https://site.example' })).status, 204);
});
