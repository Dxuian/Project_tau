// The website (site/, Next.js) end to end on Node: `next build` + `next start`,
// in headless Chromium, against the Node payout service and a regtest pool.
// A visitor creates a wallet (download, share box, copy, restore from the
// file), sees this hour's mining address rendered by the server, agrees, mines
// a regtest block in the page, and once it's mature the page shows it paid.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createWallet } from '../tau-crypto/dist/wallet.js';
import { loadConfig } from '../server/config.js';
import { startNodeServer } from '../server/node/index.js';
import { startRegtestPool } from './regtest-pool.js';
import { nodeReady, ownerReward, regtest, regtestChainEnv, until } from './helpers.js';

const SITE = fileURLToPath(new URL('../site/', import.meta.url));
const core = regtest();
const skip = !core && 'BITCOIND_RPC not set (run ./dev test)';

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
  const site = await startSite(
    { PAYOUT_API_URL: service, BRIDGE_URL: `ws://127.0.0.1:${payouts.port}`, POOL_URL: pool.url, NETWORK: 'regtest' },
    t,
  );

  step('site up');
  browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));

  // Create a wallet in the browser.
  await page.goto(`${site}/wallet`);
  await page.getByRole('button', { name: 'Create a wallet' }).click();
  await page.getByTestId('create').click();
  const words = (await page.getByTestId('words').locator('li').allInnerTexts()).map((w) => w.trim());
  assert.equal(words.length, 12);
  const address = (await page.getByTestId('new-address').innerText()).trim();
  assert.match(address, /^bcrt1q/);

  // Download: the backup file holds the words and the address.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  const file = await download.path();
  const backup = readFileSync(file, 'utf8');
  assert.ok(backup.includes(`Words: ${words.join(' ')}`), backup);
  assert.ok(backup.includes(`Address: ${address}`));
  // Share: a warning first, then (on a laptop) a text box with the backup.
  await page.getByTestId('share').click();
  await page.getByTestId('share-confirm').click();
  assert.equal(await page.getByTestId('share-text').inputValue(), backup);
  await page.getByRole('button', { name: 'Done' }).click();
  // Copy: the words, in order.
  await page.getByTestId('copy').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), words.join(' '));
  // Continue only once the visitor says the words are saved.
  assert.ok(await page.getByTestId('continue').isDisabled());
  await page.getByTestId('saved').check();
  await page.getByTestId('continue').click();
  await page.waitForURL(`${site}/mine/${address}`);

  step('wallet created and kept');
  // Restore from the downloaded file, in a fresh tab; the device remembers the address.
  const restore = await context.newPage();
  await restore.goto(`${site}/wallet`);
  assert.ok((await restore.locator('.panel').first().innerText()).includes(address), 'remembered on this device');
  await restore.getByRole('button', { name: 'Restore from backup file' }).click();
  await restore.getByTestId('restore-file').setInputFiles(file);
  assert.equal((await restore.getByTestId('restored-address').innerText()).trim(), address);
  assert.ok(!(await restore.evaluate(() => JSON.stringify(localStorage))).includes(words[0] + ' ' + words[1]), 'no words stored');
  await restore.close();

  // The mine page: this hour's address, rendered on the server.
  const hour = await (await fetch(`${service}/address`)).json();
  assert.equal((await page.getByTestId('mining-address').innerText()).trim(), hour.address);
  await page.getByTestId('payouts').getByText('No blocks found yet.').waitFor();

  step('mine page shows the hour address');
  // Nothing starts without consent; then a regtest block, mined in the page.
  assert.ok(await page.getByTestId('start').isDisabled());
  await page.getByTestId('consent').check();
  const before = pool.found.length;
  await page.getByTestId('start').click();
  await until(() => pool.found.length > before, 120_000, 'a block from the page');
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
});
