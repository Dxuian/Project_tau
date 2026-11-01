// The website (site/, Next.js) end to end on Node: `next build` + `next start`,
// in headless Chromium, against the Node payout service and a regtest pool.
// On its one screen a visitor creates a wallet (download, share box, copy,
// restore from the file), sees this hour's mining address rendered by the
// server, agrees, mines a regtest block in the page, and once it's mature the
// page shows it paid.
// Meanwhile the page reports to a stand-in PostHog: the named events, tagged
// with the app, and never the words or an address.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createWallet } from '../../tau-crypto/dist/wallet.js';
import { loadConfig } from '../config.js';
import { startNodeServer } from '../node/index.js';
import { startRegtestPool } from './regtest-pool.js';
import { DESKTOP_ARGS, desktopContext, nodeReady, ownerReward, regtest, regtestChainEnv, startFakePostHog, until } from './helpers.js';

const SITE = fileURLToPath(new URL('../site/', import.meta.url));
const core = regtest();
const skip = !core && 'BITCOIND_RPC not set (run server/dev test)';

/** Starts `next start` on a free port with these settings; resolves once it answers. */
async function startSite(env, t) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  // Next itself, not through npx: stopping the child must stop the server, which holds our pipes.
  const child = spawn(process.execPath, [join(SITE, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: SITE,
    env: { ...process.env, ...env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  t.after(async () => {
    child.kill('SIGTERM');
    const gone = new Promise((resolve) => child.once('exit', resolve));
    await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    child.stdout.destroy();
    child.stderr.destroy();
  });
  const url = `http://127.0.0.1:${port}`;
  // Each probe gives up after 5 s: a request that reaches the server while it is still starting may never be answered.
  const up = async () => (await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null))?.ok;
  try {
    await until(up, 60_000, 'next start');
  } catch (err) {
    throw new Error(`${err.message}: ${output.slice(-600)}`);
  }
  return url;
}

const step = (what) => console.error(`site test: ${what}`);

let browser;
before(() => {
  if (skip) return;
  const built = spawnSync('npm', ['run', 'build'], { cwd: SITE, encoding: 'utf8', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
});
after(() => browser?.close());

test('the site: create a wallet, keep the words, mine a block in the page, get paid', { skip, timeout: 300_000 }, async (t) => {
  await nodeReady(core);
  const owner = createWallet({ network: 'regtest' });
  const other = createWallet({ network: 'regtest' }).address;
  await core.rpc('generatetoaddress', [20, other]);
  const dir = mkdtempSync(join(tmpdir(), 'tau-site-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pool = await startRegtestPool({ rpc: core.rpc });
  t.after(() => pool.close());
  // The payout service, with hourly addresses (the default).
  const config = loadConfig({
    TAU_NETWORK: 'regtest',
    TAU_POOL: pool.url,
    TAU_OWNER_ADDRESS: owner.address,
    TAU_STORAGE_DIR: dir,
    TAU_LISTEN: '0',
    TAU_HOST: '127.0.0.1',
    ...regtestChainEnv(),
  });
  const payouts = await startNodeServer(config, { ownerMnemonic: owner.mnemonic });
  t.after(() => payouts.close());
  const service = `http://127.0.0.1:${payouts.port}`;
  step('payout service up');
  const ph = await startFakePostHog();
  t.after(() => ph.close());
  const site = await startSite(
    {
      PAYOUT_API_URL: service,
      BRIDGE_URL: `ws://127.0.0.1:${payouts.port}`,
      POOL_URL: pool.url,
      NETWORK: 'regtest',
      POSTHOG_KEY: 'phc_tautest',
      POSTHOG_HOST: ph.url,
    },
    t,
  );

  step('site up');
  browser = await chromium.launch({ args: [...DESKTOP_ARGS] });
  const context = await desktopContext(browser, { acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));

  // One screen, in Arcade by default. No address yet, so nothing to mine to: create a wallet in the browser.
  await page.goto(`${site}/`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'arcade');
  assert.ok(await page.getByTestId('start').isDisabled(), 'no payout address yet');
  await page.getByTestId('create-wallet').click();
  const words = (await page.getByTestId('words').getByTestId('word').allInnerTexts()).map((w) => w.trim());
  assert.equal(words.length, 12);
  const address = (await page.getByTestId('new-address').innerText()).trim();
  assert.match(address, /^bcrt1q/);
  assert.equal(await page.getByTestId('words').getAttribute('translate'), 'no', 'page translators leave the words alone');

  // Download: the backup file holds the words and the address.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  const file = await download.path();
  const backup = readFileSync(file, 'utf8');
  assert.ok(backup.includes(`Words: ${words.join(' ')}`), backup);
  assert.ok(backup.includes(`Address: ${address}`));
  // Share: a warning first, then (on a laptop) a text box with the backup.
  await page.getByTestId('share').click();
  await page.getByTestId('share-confirm').click();
  const box = page.getByTestId('share-text');
  assert.equal(await box.inputValue(), backup);
  assert.deepEqual([await box.getAttribute('spellcheck'), await box.getAttribute('autocomplete')], ['false', 'off'], 'no spellcheck service sees the words');
  await page.getByTestId('share-done').click();
  // Copy: the words, in order.
  await page.getByTestId('copy').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), words.join(' '));
  // The wallet is used only once the visitor says the words are saved.
  assert.ok(await page.getByTestId('use-wallet').isDisabled());
  await page.getByTestId('saved').check();
  await page.getByTestId('use-wallet').click();
  assert.equal((await page.getByTestId('payout-address').innerText()).trim(), address);
  assert.ok(!(await page.evaluate(() => document.body.innerText)).includes(`${words[0]} ${words[1]}`), 'the words are gone from the page');

  step('wallet created and kept');
  // Restore from the downloaded file, in a fresh tab; the device remembers the address.
  const restore = await context.newPage();
  await restore.goto(`${site}/`);
  await restore.getByTestId('payout-address').getByText(address).waitFor({ timeout: 10_000 }); // remembered on this device
  await restore.getByTestId('change-address').click();
  await restore.getByTestId('restore-file').setInputFiles(file);
  assert.equal((await restore.getByTestId('payout-address').innerText()).trim(), address, 'restored from the backup');
  assert.ok(!(await restore.evaluate(() => JSON.stringify(localStorage))).includes(words[0] + ' ' + words[1]), 'no words stored');
  // Sent before the tab goes (events are sent in batches).
  await until(() => ph.events().some((e) => e.event === 'wallet_restored'), 20_000, 'the restore event');
  await restore.close();

  // This hour's mining address, rendered on the server.
  const hour = await (await fetch(`${service}/address`)).json();
  assert.equal((await page.getByTestId('mining-address').innerText()).trim(), hour.address);
  await page.getByTestId('payouts').getByText('No blocks found yet.').waitFor();
  // Old links lead to the one screen.
  assert.equal(new URL((await fetch(`${site}/wallet`, { redirect: 'manual' })).headers.get('location'), site).pathname, '/');
  assert.equal(new URL((await fetch(`${site}/mine/${address}`, { redirect: 'manual' })).headers.get('location'), site).pathname, '/');

  step('the screen shows the hour address');
  // A theme from the picker applies at once, and stays after a reload.
  await page.getByTestId('theme-button').click();
  await page.getByTestId('theme-terminal').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'terminal');
  await page.reload();
  await page.getByTestId('payout-address').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'terminal', 'remembered on the device');
  // Nothing mines until the mine button is pressed; then a regtest block, mined in the page.
  assert.equal((await page.getByTestId('state').innerText()).trim(), 'Idle');
  const before = pool.found.length;
  await page.getByTestId('start').click();
  await until(() => pool.found.length > before, 120_000, 'a block from the page');
  // The live graph has points, and can be switched off.
  await page.locator('canvas[role=img]').waitFor();
  await page.getByTestId('live-graph').click();
  assert.equal(await page.locator('canvas[role=img]').count(), 0, 'graph off: no canvas drawn');
  await page.getByTestId('stop').click();
  const block = pool.found[before];
  assert.equal(block.user, hour.address, "the pool saw this hour's address, not the visitor's");
  assert.ok(pool.authorized.every((u) => u !== address));

  step('block mined in the page');
  // Immature, then paid.
  await page.getByTestId('check-payout').click();
  await page.locator(`[data-testid=payout][data-status=immature]`).first().waitFor();
  await core.rpc('generatetoaddress', [100, other]);
  await page.getByTestId('check-payout').click();
  await page.locator(`[data-testid=payout][data-status=paid]`).first().waitFor({ timeout: 30_000 });
  await core.rpc('generatetoaddress', [1, other]);
  let reward = 0n;
  for (const b of pool.found.slice(before)) reward += (await ownerReward(core, b.hash, b.user)) / 10n;
  const got = (await core.utxos(address)).reduce((s, c) => s + c.value, 0n);
  assert.equal(got, reward, '10% of each block found in the page');

  step('paid');
  // Analytics: an uncaught error whose message holds the address, then everything
  // the page sent to PostHog.
  await page.evaluate((a) => setTimeout(() => {
    throw new Error(`analytics test error for ${a}`);
  }), address);
  const expected = ['$pageview', 'wallet_created', 'backup_downloaded', 'words_shared', 'words_copied', 'payout_address_chosen', 'wallet_restored'];
  expected.push('theme_changed', 'mining_started', 'mining_stopped', 'payout_checked', 'blocks_seen', '$exception');
  const names = () => new Set(ph.events().map((e) => e.event));
  try {
    await until(() => expected.every((n) => names().has(n)), 30_000, 'the analytics events');
  } catch (err) {
    throw new Error(`${err.message}; got ${[...names()].join(', ')}\n${ph.received()}`);
  }
  const events = ph.events();
  assert.deepEqual(new Set(events.map((e) => e.properties?.app)), new Set(['project-tau']), 'every event says which app sent it');
  const sent = ph.requests.map((r) => r.text).join('\n');
  assert.ok(!sent.includes(words.join(' ')), 'never the words');
  for (let i = 1; i < words.length; i++) assert.ok(!sent.includes(`${words[i - 1]} ${words[i]}`), 'not even two of the words');
  assert.ok(!sent.includes(address), "never the visitor's address");
  assert.ok(!sent.includes(hour.address), 'never our address');
  const pages = new Set(events.filter((e) => e.event === '$pageview').map((e) => new URL(e.properties.$current_url).pathname));
  assert.deepEqual(pages, new Set(['/']), 'one screen');
  const exception = events.find((e) => e.event === '$exception');
  assert.match(JSON.stringify(exception.properties.$exception_list), /analytics test error for \[address\]/);
  assert.deepEqual(ph.requests.filter((r) => /\/(static|flags|decide|array)\b/.test(r.path)), [], 'no remote config or scripts from PostHog');
});
