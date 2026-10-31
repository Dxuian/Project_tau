// The website on Cloudflare: the OpenNext build (npm run cf:build) served by
// `wrangler dev` (local workerd), with the payout Worker (cloudflare/worker.js)
// in Miniflare, D1 included, as its payout service and bridge. A visitor
// creates a wallet, sees this hour's address rendered by the site Worker, mines
// a regtest block through the payout Worker, and is paid through the site
// Worker's /api/payout.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { chromium } from 'playwright-core';
import { createWallet } from '../../tau-crypto/dist/wallet.js';
import { startRegtestPool } from './regtest-pool.js';
import { bundleWorker, migrateD1, nodeReady, ownerReward, regtest, regtestChainEnv, until } from './helpers.js';

const SITE = fileURLToPath(new URL('../site/', import.meta.url));
const core = regtest();
const skip = !core && 'BITCOIND_RPC not set (run server/dev test)';
const step = (what) => console.error(`site on cloudflare: ${what}`);
const quiet = { NEXT_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false', CI: '1' };

let browser;
before(() => {
  if (skip) return;
  const built = spawnSync('npm', ['run', 'cf:build'], { cwd: SITE, encoding: 'utf8', env: { ...process.env, ...quiet } });
  assert.equal(built.status, 0, `${built.stdout.slice(-3000)}\n${built.stderr.slice(-3000)}`);
});
after(() => browser?.close());

/** `wrangler dev` (local workerd) serving the site's OpenNext build with these vars; resolves once it answers. */
async function startSiteWorker(vars, t) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const home = mkdtempSync(join(tmpdir(), 'tau-site-cf-'));
  const args = [join(SITE, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--port', String(port), '--ip', '127.0.0.1'];
  args.push('--show-interactive-dev-session=false', '--persist-to', join(home, 'state'));
  for (const [key, value] of Object.entries(vars)) args.push('--var', `${key}:${value}`);
  // Its own process group, so stopping it also stops the workerd it starts.
  const child = spawn(process.execPath, args, { cwd: SITE, env: { ...process.env, ...quiet, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  t.after(async () => {
    const group = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // already gone
      }
    };
    group('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    group('SIGKILL');
    child.stdout.destroy();
    child.stderr.destroy();
    rmSync(home, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}`;
  const up = async () => (await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null))?.ok;
  try {
    await until(up, 120_000, 'wrangler dev');
  } catch (err) {
    throw new Error(`${err.message}: ${output.slice(-1500)}`);
  }
  return url;
}

test('the site on Cloudflare: a wallet, the hour address rendered by the site Worker, a block mined through the payout Worker, paid', { skip, timeout: 300_000 }, async (t) => {
  await nodeReady(core);
  const { out } = bundleWorker(t);
  const owner = createWallet({ network: 'regtest' });
  const other = createWallet({ network: 'regtest' }).address;
  await core.rpc('generatetoaddress', [20, other]);
  const pool = await startRegtestPool({ rpc: core.rpc });
  t.after(() => pool.close());
  const payoutWorker = new Miniflare({
    modules: true,
    scriptPath: join(out, 'worker.js'),
    modulesRoot: out,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    host: '127.0.0.1',
    port: 0,
    bindings: {
      TAU_TARGET: 'cloudflare',
      TAU_NETWORK: 'regtest',
      TAU_POOL: pool.url,
      TAU_OWNER_ADDRESS: owner.address,
      TAU_STORAGE: 'd1',
      ...regtestChainEnv(),
      OWNER_MNEMONIC: owner.mnemonic,
    },
  });
  t.after(() => payoutWorker.dispose());
  const { port } = await payoutWorker.ready;
  await migrateD1(await payoutWorker.getD1Database('DB'));
  const service = `http://127.0.0.1:${port}`;
  step('payout Worker up');
  const site = await startSiteWorker({ PAYOUT_API_URL: service, BRIDGE_URL: `ws://127.0.0.1:${port}`, POOL_URL: pool.url, NETWORK: 'regtest' }, t);
  step('site Worker up');

  browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${site}/wallet`);
  await page.getByRole('button', { name: 'Create a wallet' }).click();
  await page.getByTestId('create').click();
  const address = (await page.getByTestId('new-address').innerText()).trim();
  assert.match(address, /^bcrt1q/);
  await page.getByTestId('saved').check();
  await page.getByTestId('continue').click();
  await page.waitForURL(`${site}/mine/${address}`);
  const hour = await (await fetch(`${service}/address`)).json();
  assert.equal((await page.getByTestId('mining-address').innerText()).trim(), hour.address, 'rendered by the site Worker from the payout Worker');
  step('mine page shows the hour address');

  await page.getByTestId('consent').check();
  const before = pool.found.length;
  await page.getByTestId('start').click();
  await until(() => pool.found.length > before, 120_000, 'a block from the page');
  await page.getByTestId('stop').click();
  assert.equal(pool.found[before].user, hour.address);
  step('block mined through the payout Worker');

  await page.getByTestId('check-payout').click();
  await page.locator('[data-testid=payout][data-status=immature]').first().waitFor();
  await core.rpc('generatetoaddress', [100, other]);
  await page.getByTestId('check-payout').click();
  await page.locator('[data-testid=payout][data-status=paid]').first().waitFor({ timeout: 30_000 });
  await core.rpc('generatetoaddress', [1, other]);
  let reward = 0n;
  for (const b of pool.found.slice(before)) reward += (await ownerReward(core, b.hash, b.user)) / 10n;
  assert.equal((await core.utxos(address)).reduce((s, c) => s + c.value, 0n), reward, '10% of each block');
});
