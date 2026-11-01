// loadConfig(): every setting is a parameter, and bad settings fail clearly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { poolTarget } from '../../tau-crypto/dist/bridge.js';
import { memoryStores } from '../../tau-crypto/dist/payouts.js';
import { accountXpub, createWallet, newAddress } from '../../tau-crypto/dist/wallet.js';
import { createPayoutApi } from '../api.js';
import { loadConfig, shareCutoff } from '../config.js';
import { OWNER, OWNER_WORDS } from './helpers.js';

test('defaults, and overrides from the environment', () => {
  const c = loadConfig({ TAU_OWNER_ADDRESS: OWNER });
  assert.equal(c.target, 'node');
  assert.equal(c.pool, 'stratum+tcp://solo.ckpool.org:3333');
  assert.equal(c.clientSharePercent, 10);
  assert.deepEqual([c.addressPeriodMs, c.addressEpoch, c.ownerXpub], [3_600_000, '2026-01-01T00:00:00Z', undefined], 'a fresh owner address every hour');
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
  assert.throws(() => loadConfig({ ...ok, TAU_ADDRESS_PERIOD_MS: '500' }), /0 or at least 1000/);
  assert.throws(() => loadConfig({ ...ok, TAU_ADDRESS_PERIOD_MS: '1.5' }), /whole number/);
  assert.throws(() => loadConfig({ ...ok, TAU_ADDRESS_EPOCH: 'yesterday' }), /ISO time/);
  assert.throws(() => loadConfig({ ...ok, TAU_STORAGE: 'postgres' }), /file, d1, tidb or memory/);
  assert.throws(() => loadConfig({ ...ok, TAU_SHARE_RETENTION_DAYS: '-1' }), /0 or more/);
  assert.throws(() => loadConfig({ ...ok, TAU_SHARE_RETENTION_DAYS: '1.5' }), /whole number/);
});

test('records in TiDB Cloud (either target), and how long ordinary shares are kept', () => {
  const tidb = loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_STORAGE: 'tidb' });
  assert.deepEqual(tidb.storage, { type: 'tidb', database: 'tau' });
  const named = loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_TARGET: 'cloudflare', TAU_STORAGE: 'tidb', TAU_DB_NAME: 'tau_prod' });
  assert.deepEqual(named.storage, { type: 'tidb', database: 'tau_prod' });
  const at = Date.UTC(2026, 9, 31);
  assert.equal(tidb.shareRetentionDays, 30);
  assert.equal(shareCutoff(tidb, at), '2026-10-01T00:00:00.000Z', 'shares older than 30 days go');
  assert.equal(shareCutoff(loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_SHARE_RETENTION_DAYS: '0' }), at), null, '0 keeps every share');
});

test("refuses an OWNER_MNEMONIC that isn't the owner address's wallet", () => {
  const config = loadConfig({ TAU_OWNER_ADDRESS: OWNER });
  const { shares, ledger } = memoryStores();
  assert.throws(
    () => createPayoutApi(config, { shares, ledger, chain: {}, ownerMnemonic: createWallet().mnemonic }),
    /OWNER_MNEMONIC is not the wallet of TAU_OWNER_ADDRESS/,
  );
  assert.equal(createPayoutApi(config, { shares, ledger, chain: {}, ownerMnemonic: OWNER_WORDS }).service.canPay, true);
});

test('the payout API (fetch): health, validation, CORS, body limit, and no key means no payouts', async () => {
  const config = loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_OWNER_XPUB: accountXpub(OWNER_WORDS), TAU_ORIGINS: 'https://site.example' });
  const { shares, ledger } = memoryStores();
  const recordOnly = createPayoutApi(config, { shares, ledger, chain: {} });
  const call = (method, path, { origin, body } = {}) =>
    recordOnly.fetch(new Request(`http://api.test${path}`, { method, headers: origin ? { origin } : {}, body }));
  const health = await call('GET', '/health');
  assert.equal((await health.json()).canPay, false);
  const visitor = createWallet().address;
  const r = await call('POST', '/payout', { origin: 'https://site.example', body: JSON.stringify({ address: visitor }) });
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://site.example');
  const evil = await call('POST', '/payout', { origin: 'https://evil.example', body: '{}' });
  assert.equal(evil.status, 400);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('POST', '/payout', { body: 'not json' })).status, 400);
  assert.equal((await call('POST', '/payout', { body: JSON.stringify({ address: visitor, pad: 'x'.repeat(5000) }) })).status, 413);
  assert.equal((await call('GET', '/nope')).status, 404);
  const preflight = await call('OPTIONS', '/payout', { origin: 'https://site.example' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, GET');
});

test('GET /address: the hour\'s owner address, cacheable until the hour ends; one address with period 0', async () => {
  const at = Date.UTC(2026, 9, 31, 13, 45); // slot 7286, 15 minutes left
  const config = loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_OWNER_XPUB: accountXpub(OWNER_WORDS), TAU_ORIGINS: 'https://site.example' });
  const api = createPayoutApi(config, { ...memoryStores(), chain: {}, now: () => at });
  const res = await api.fetch(new Request('http://api.test/address', { headers: { origin: 'https://site.example' } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=900');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://site.example');
  assert.deepEqual(await res.json(), {
    address: newAddress({ mnemonic: OWNER_WORDS }, { index: 7286 }).address,
    index: 7286,
    from: '2026-10-31T13:00:00.000Z',
    until: '2026-10-31T14:00:00.000Z',
    network: 'mainnet',
  });
  assert.equal(api.addressFor(at + 15 * 60_000).index, 7287);

  const single = createPayoutApi(loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_ADDRESS_PERIOD_MS: '0' }), { ...memoryStores(), chain: {} });
  const one = await single.fetch(new Request('http://api.test/address'));
  assert.equal((await one.json()).address, OWNER);
  assert.equal(one.headers.get('cache-control'), 'public, max-age=300');
});

test('hourly addresses need the xpub or the words, and both must be the owner address\'s wallet', () => {
  const config = loadConfig({ TAU_OWNER_ADDRESS: OWNER });
  assert.throws(() => createPayoutApi(config, { ...memoryStores(), chain: {} }), /need TAU_OWNER_XPUB or OWNER_MNEMONIC/);
  const wrong = loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_OWNER_XPUB: accountXpub(createWallet().mnemonic) });
  assert.throws(() => createPayoutApi(wrong, { ...memoryStores(), chain: {} }), /TAU_OWNER_XPUB is not the wallet of TAU_OWNER_ADDRESS/);
});

test('the health event settings; the wrangler files hold PostHog project keys only', () => {
  const c = loadConfig({ TAU_OWNER_ADDRESS: OWNER });
  assert.deepEqual([c.posthog, c.siteUrl], [{ key: undefined, host: 'https://us.i.posthog.com' }, undefined], 'no key: no health event');
  const d = loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_POSTHOG_KEY: 'phc_x', TAU_POSTHOG_HOST: 'https://eu.i.posthog.com', TAU_SITE_URL: 'https://site.example' });
  assert.deepEqual([d.posthog, d.siteUrl], [{ key: 'phc_x', host: 'https://eu.i.posthog.com' }, 'https://site.example']);
  // An unusable key stops only the health event (health.js refuses it), never the service.
  assert.doesNotThrow(() => loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_POSTHOG_KEY: 'phx_nope' }));
  // The repository is public: both Workers' settings may hold only PostHog's public project keys.
  const [worker, site] = ['../cloudflare/wrangler.toml', '../site/wrangler.jsonc'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));
  for (const text of [worker, site]) assert.doesNotMatch(text, /phx_[A-Za-z0-9]/, 'no personal PostHog key');
  assert.match(worker, /^TAU_POSTHOG_KEY = "phc_[A-Za-z0-9]+"$/m);
  assert.match(site, /"POSTHOG_KEY": "phc_[A-Za-z0-9]+"/);
});
