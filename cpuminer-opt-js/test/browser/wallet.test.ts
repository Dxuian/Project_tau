// dist/wallet.js and dist/payouts.js in headless Chromium: wallets come from
// the browser's crypto, restore to the BIP84 vector, and blocks rebuild.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { ROOT } from '../helpers.ts';
import { serve, type StaticServer } from './server.ts';

const BUILT = existsSync(`${ROOT}dist/wallet.js`);
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import * as wallet from '/dist/wallet.js';
import * as payouts from '/dist/payouts.js';
window.T = { wallet, payouts };
window.ready = true;
</script>`;

let server: StaticServer;
let browser: Browser;
let page: Page;

before(async () => {
  if (!BUILT) return;
  server = await serve(ROOT, { '/index.html': PAGE });
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(server.url);
  await page.waitForFunction(() => (window as any).ready === true);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test('creates and restores wallets in the browser', { skip: !BUILT && 'run ./dev build first' }, async () => {
  const w = await page.evaluate(() => (window as any).T.wallet.createWallet());
  assert.equal(w.mnemonic.split(' ').length, 12);
  assert.match(w.address, /^bc1q/);
  assert.equal(await page.evaluate((m) => (window as any).T.wallet.walletFromMnemonic(m).address, w.mnemonic), w.address);
  const abandon = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  assert.equal(
    await page.evaluate((m) => (window as any).T.wallet.walletFromMnemonic(m).address, abandon),
    'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
  );
  assert.equal(
    await page.evaluate((m) => (window as any).T.wallet.newAddress({ mnemonic: m }).address, abandon),
    'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
  );
  assert.equal(await page.evaluate(() => (window as any).T.wallet.isValidAddress('nope')), false);
});

test('rebuilds Bitcoin block 1 from its stratum fields in the browser', { skip: !BUILT && 'run ./dev build first' }, async () => {
  const cb =
    '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff' +
    '0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390' +
    '813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000';
  const r = await page.evaluate(
    (fields) => (window as any).T.payouts.rebuildBlockHeader(fields),
    {
      prevhash: '0a8ce26f72b3f1b646a2a6c14ff763ae65831e939c085ae10019d66800000000',
      coinb1: cb.slice(0, 26),
      coinb2: cb.slice(42),
      merkle: [],
      version: '00000001',
      nbits: '1d00ffff',
      xn1: '00000000',
      xn2: '00000000',
      ntime: '4966bc61',
      nonce: '9962e301',
    },
  );
  assert.equal(r.blockHash, '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048');
  assert.equal(r.isBlock, true);
});
