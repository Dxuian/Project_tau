// The storage adapters (files for Node, D1 for Cloudflare) against the same
// contract, then the real payout engine on each: one payout per block.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { createWallet } from '../tau-crypto/dist/wallet.js';
import { createPayoutApi } from '../server/api.js';
import { d1Stores } from '../server/cloudflare/d1-stores.js';
import { loadConfig } from '../server/config.js';
import { fileStores } from '../server/node/file-stores.js';
import { OWNER, OWNER_WORDS, findBlockThrough, mockChainWith } from './helpers.js';

let mf;
before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch: () => new Response("") }', compatibilityDate: '2026-07-30', d1Databases: ['DB'] });
});
after(() => mf?.dispose());

let n = 0;
const kinds = {
  file: () => {
    const dir = mkdtempSync(join(tmpdir(), 'tau-store-'));
    after(() => rmSync(dir, { recursive: true, force: true }));
    return fileStores(dir);
  },
  d1: async () => {
    // A fresh database per test: a new Miniflare D1 binding name each time.
    const name = `DB${++n}`;
    await mf.setOptions({ modules: true, script: 'export default { fetch: () => new Response("") }', compatibilityDate: '2026-07-30', d1Databases: [name] });
    return d1Stores(await mf.getD1Database(name));
  },
};

const entry = (blockHash, inputs) => ({
  blockHash,
  visitor: 'v',
  status: 'pending',
  rewardSats: '100',
  amountSats: '10',
  txid: 'ab'.repeat(32),
  inputs,
  time: new Date().toISOString(),
});

for (const [kind, make] of Object.entries(kinds)) {
  describe(`${kind} stores`, () => {
    test('shares: blocks by visitor, claimants, visitors', async () => {
      const { shares } = await make();
      const base = { type: 'share', v: 1, time: 't', conn: 1, peer: 'p', jobId: 'j', job: {}, xn1: '', xn2: '', ntime: '', nonce: '', difficulty: null, ownerSats: null };
      await shares.add({ ...base, id: '1', visitor: 'a', blockHash: 'h1', isBlock: true });
      await shares.add({ ...base, id: '2', visitor: 'a', blockHash: 'h2', isBlock: false });
      await shares.add({ ...base, id: '3', visitor: 'b', blockHash: 'h1', isBlock: true });
      await shares.addResult({ type: 'result', v: 1, share: '1', time: 't', accepted: true, error: null });
      assert.deepEqual((await shares.blocksFor('a')).map((r) => r.id), ['1']);
      assert.deepEqual((await shares.claimants('h1')).sort(), ['a', 'b']);
      assert.deepEqual((await shares.visitorsWithBlocks()).sort(), ['a', 'b']);
    });

    test('ledger: reserve is all-or-nothing per block and per coin', async () => {
      const { ledger } = await make();
      assert.equal(await ledger.reserve(entry('h1', ['c1:0', 'c2:0'])), 'reserved');
      assert.equal(await ledger.reserve(entry('h1', ['c9:0'])), 'block-taken');
      assert.equal(await ledger.reserve(entry('h2', ['c2:0', 'c3:0'])), 'inputs-taken');
      assert.deepEqual([...(await ledger.usedInputs())].sort(), ['c1:0', 'c2:0'], 'the failed reserve claimed nothing');
      assert.equal((await ledger.get('h1')).status, 'pending');
      assert.equal(await ledger.get('h2'), null);
      // Concurrent reserves of one block: exactly one wins.
      const results = await Promise.all([1, 2, 3, 4, 5].map((i) => ledger.reserve(entry('h3', [`d${i}:0`]))));
      assert.deepEqual(results.filter((r) => r === 'reserved').length, 1);
    });

    test('ledger: sent is final, void releases a pending payout and its coins', async () => {
      const { ledger } = await make();
      await ledger.reserve(entry('h1', ['c1:0']));
      await ledger.reserve(entry('h2', ['c2:0']));
      await ledger.markSent('h1', 'ab'.repeat(32));
      assert.equal((await ledger.get('h1')).status, 'sent');
      await assert.rejects(ledger.markSent('h2', 'cd'.repeat(32)), /no pending payout/);
      assert.equal(await ledger.void('h1'), false, 'sent payouts stay');
      assert.equal(await ledger.void('h2'), true);
      assert.equal(await ledger.get('h2'), null);
      assert.deepEqual([...(await ledger.usedInputs())], ['c1:0']);
      assert.equal(await ledger.reserve(entry('h2', ['c2:0'])), 'reserved', 'released coins can be used again');
    });

    test('the payout engine pays once through these stores', async () => {
      const stores = await make();
      // One owner address (period 0): the store contract, not the address slots, is under test.
      const config = loadConfig({ TAU_OWNER_ADDRESS: OWNER, TAU_STORAGE: 'memory', TAU_ADDRESS_PERIOD_MS: '0' });
      const visitor = createWallet().address;
      const recorder = createPayoutApi(config, { ...stores, chain: {} }); // the bridge side: no key
      const found = await findBlockThrough(recorder.intercept, visitor);
      const chain = mockChainWith(found);
      const service = createPayoutApi(config, { ...stores, chain, ownerMnemonic: OWNER_WORDS });
      const [first, second] = await Promise.all([service.verifyPayout(visitor), service.verifyPayout(visitor)]);
      assert.deepEqual([first[0].status, second[0].status].sort(), ['already-paid', 'paid']);
      assert.equal(chain.broadcasts.length, 1);
      assert.equal((await service.verifyPayout(visitor))[0].status, 'already-paid');
    });
  });
}
