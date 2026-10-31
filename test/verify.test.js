// verifyPayout(): pays 10% once for provable blocks, and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addressScript, createAuditor, createWallet, rebuildBlockHeader, verifyPayout, walletFromMnemonic } from '../btc.js';
import { mockChain, outputsOf } from './mock-chain.js';

const OWNER_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER = walletFromMnemonic(OWNER_WORDS).address;
const OWNER_SCRIPT = addressScript(OWNER);
const REWARD = 312_500_000n;

function le64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b.toString('hex');
}

/**
 * A visitor finds a block through the auditor: a job whose coinbase pays the
 * owner, with an easy target (nbits 207fffff) so a block takes a few nonces.
 */
function findBlock(ledgerDir, visitor, seed = 1) {
  const job = {
    prevhash: seed.toString(16).padStart(64, '0'),
    coinb1: '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + '0c' + '03a08601',
    coinb2: 'ffffffff' + '01' + le64(REWARD) + '16' + OWNER_SCRIPT + '00000000',
    merkle: [],
    version: '20000000',
    nbits: '207fffff',
    ntime: '66000000',
  };
  const records = [];
  const audit = createAuditor({ ownerAddress: OWNER, record: (r) => records.push(r) })({ id: seed, peer: 'p', reply() {}, close() {} });
  audit.fromClient(JSON.stringify({ id: 1, method: 'mining.subscribe', params: [] }));
  audit.fromPool(JSON.stringify({ id: 1, result: [[], 'abcd0123', 4], error: null }));
  audit.fromClient(JSON.stringify({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] }));
  audit.fromPool(JSON.stringify({ id: null, method: 'mining.notify', params: ['j', job.prevhash, job.coinb1, job.coinb2, [], job.version, job.nbits, job.ntime, true] }));
  let nonce = 0;
  let rebuilt;
  do {
    rebuilt = rebuildBlockHeader({ ...job, xn1: 'abcd0123', xn2: '00000000', nonce: (++nonce).toString(16).padStart(8, '0') });
  } while (!rebuilt.isBlock);
  audit.fromClient(JSON.stringify({ id: 3, method: 'mining.submit', params: [visitor, 'j', '00000000', job.ntime, nonce.toString(16).padStart(8, '0')] }));
  for (const r of records) appendFileSync(join(ledgerDir, 'shares.jsonl'), `${JSON.stringify(r)}\n`);
  return { blockHash: rebuilt.blockHash, coinbaseTxid: rebuilt.coinbaseTxid, record: records[0] };
}

/** A chain on which `found` is a block at height 1000 paying the owner REWARD. */
function chainWith(found, extra = {}) {
  return mockChain({
    tip: 1099, // 100 confirmations
    blocks: { [found.blockHash]: { inBestChain: true, height: 1000 } },
    coinbases: { [found.blockHash]: { txid: found.coinbaseTxid, outputs: [{ script: OWNER_SCRIPT, value: REWARD }] } },
    utxos: [{ txid: found.coinbaseTxid, vout: 0, value: REWARD, height: 1000, coinbase: true }],
    ...extra,
  });
}

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tau-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const visitor = createWallet().address;
  return { dir, visitor, opts: (chain, extra = {}) => ({ chain, ownerMnemonic: OWNER_WORDS, ledgerDir: dir, ...extra }) };
}

test('pays the finder exactly 10% of the owner reward, once', async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  const chain = chainWith(found);
  const [r] = await verifyPayout(visitor, opts(chain));
  assert.equal(r.status, 'paid');
  assert.equal(r.blockHash, found.blockHash);
  assert.equal(r.rewardSats, REWARD);
  assert.equal(r.payoutSats, REWARD / 10n);
  const { outputs } = outputsOf(chain.broadcasts[0]);
  assert.deepEqual(outputs[0], { script: addressScript(visitor), amount: REWARD / 10n });
  assert.equal(outputs[1].script, OWNER_SCRIPT, 'change back to the owner');
  const again = await verifyPayout(visitor, opts(chain));
  assert.deepEqual([again[0].status, again[0].txid], ['already-paid', r.txid]);
  assert.equal(chain.broadcasts.length, 1);
  const ledger = readFileSync(join(dir, 'payouts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(ledger.map((p) => p.status), ['pending', 'sent']);
  assert.equal(ledger[0].txid, r.txid);
});

test('someone else gets nothing for that block', async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  const chain = chainWith(found);
  assert.deepEqual(await verifyPayout(createWallet().address, opts(chain)), []);
  assert.deepEqual(await verifyPayout(OWNER, opts(chain)), []);
  assert.equal(chain.broadcasts.length, 0);
});

test('waits for 100 confirmations and never pays blocks outside the best chain', async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  const chain = chainWith(found, { tip: 1098 });
  assert.deepEqual(
    (await verifyPayout(visitor, opts(chain))).map((r) => [r.status, r.confirmations]),
    [['immature', 99]],
  );
  chain.tip = 1099;
  chain.blocks[found.blockHash] = { inBestChain: false, height: 1000 };
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'not-in-chain');
  delete chain.blocks[found.blockHash];
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'not-in-chain');
  assert.equal(chain.broadcasts.length, 0);
  await assert.rejects(verifyPayout(visitor, opts(chain, { minConfirmations: 6 })), /at least 100/);
});

test("refuses a block whose coinbase isn't the share's or doesn't pay the owner", async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  const chain = chainWith(found);
  chain.coinbases[found.blockHash] = { txid: 'ee'.repeat(32), outputs: [{ script: OWNER_SCRIPT, value: REWARD }] };
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'not-ours');
  chain.coinbases[found.blockHash] = { txid: found.coinbaseTxid, outputs: [{ script: addressScript(visitor), value: REWARD }] };
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'not-ours');
  assert.equal(chain.broadcasts.length, 0);
});

test('a share edited in the ledger is rebuilt from its fields, so it proves nothing', async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  const forged = { ...found.record, nonce: 'ffffffff' }; // keeps the real blockHash and isBlock
  writeFileSync(join(dir, 'shares.jsonl'), `${JSON.stringify(forged)}\n`);
  const results = await verifyPayout(visitor, opts(chainWith(found)));
  assert.ok(results.every((r) => r.status !== 'paid' && r.blockHash !== found.blockHash));
});

test('a payout that may have been broadcast is never retried automatically', async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  const chain = chainWith(found, { failBroadcast: 'connection reset' });
  const [first] = await verifyPayout(visitor, opts(chain));
  assert.deepEqual([first.status, first.error], ['needs-review', 'connection reset']);
  chain.failBroadcast = null;
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'needs-review');
  assert.equal(chain.broadcasts.length, 0);
  // After checking that txid isn't on-chain, the operator voids the attempt.
  appendFileSync(join(dir, 'payouts.jsonl'), `${JSON.stringify({ type: 'payout', status: 'void', blockHash: found.blockHash })}\n`);
  const [retry] = await verifyPayout(visitor, opts(chain));
  assert.equal(retry.status, 'paid');
  // Same coin, same outputs, deterministic signature: the very same transaction,
  // so even a first attempt that did reach the network can't pay twice.
  assert.equal(retry.txid, first.txid);
});

test('without funds it reports not-paid-yet and pays later', async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  const chain = chainWith(found, { utxos: [] });
  const [r] = await verifyPayout(visitor, opts(chain));
  assert.equal(r.status, 'not-paid-yet');
  assert.match(r.error, /not enough/);
  chain.utxoList = [{ txid: found.coinbaseTxid, vout: 0, value: REWARD, height: 1000, coinbase: true }];
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'paid');
});

test('concurrent calls pay once', async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  const chain = chainWith(found);
  const results = await Promise.all([verifyPayout(visitor, opts(chain)), verifyPayout(visitor, opts(chain)), verifyPayout(visitor, opts(chain))]);
  assert.deepEqual(results.map((r) => r[0].status).sort(), ['already-paid', 'already-paid', 'paid']);
  assert.equal(chain.broadcasts.length, 1);
});

test('two visitors recorded for one block: held for review', async (t) => {
  const { dir, visitor, opts } = setup(t);
  const found = findBlock(dir, visitor);
  appendFileSync(join(dir, 'shares.jsonl'), `${JSON.stringify({ ...found.record, visitor: createWallet().address })}\n`);
  const [r] = await verifyPayout(visitor, opts(chainWith(found)));
  assert.equal(r.status, 'needs-review');
});
