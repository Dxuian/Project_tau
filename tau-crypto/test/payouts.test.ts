// The payout engine (src/payouts): pays a visitor their share of a provable,
// mature block exactly once, and nothing else. In-memory stores + mock chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShareAuditor } from '../bridge/auditor.ts';
import { memoryStores, payoutAll, rebuildBlockHeader, verifyPayout, type PayoutOptions, type ShareRecord } from '../src/payouts/index.ts';
import { addressScript, createWallet, walletFromMnemonic } from '../src/wallet/index.ts';
import { mockChain, outputsOf, type MockChain } from './mock-chain.ts';

const OWNER_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER = walletFromMnemonic(OWNER_WORDS).address;
const OWNER_SCRIPT = addressScript(OWNER);
const REWARD = 312_500_000n;

function le64(n: bigint): string {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b.toString('hex');
}

type Stores = ReturnType<typeof memoryStores>;

/**
 * A visitor finds a block through the auditor: a job whose coinbase pays the
 * owner, with an easy target (nbits 207fffff) so a block takes a few nonces.
 */
async function findBlock(stores: Stores, visitor: string, seed = 1) {
  const job = {
    prevhash: seed.toString(16).padStart(64, '0'),
    // The height push differs per seed, so every test coinbase has its own txid.
    coinb1: '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + '0c' + '03' + seed.toString(16).padStart(6, '0'),
    coinb2: 'ffffffff' + '01' + le64(REWARD) + '16' + OWNER_SCRIPT + '00000000',
    merkle: [] as string[],
    version: '20000000',
    nbits: '207fffff',
    ntime: '66000000',
  };
  const audit = createShareAuditor({ poolUser: OWNER, onShare: (r) => stores.shares.add(r) })({
    id: seed,
    peer: 'p',
    target: 'pool:3333',
    tls: false,
    origin: null,
    query: new URLSearchParams(),
    reply() {},
    close() {},
  });
  await audit.fromClient!(JSON.stringify({ id: 1, method: 'mining.subscribe', params: [] }));
  audit.fromPool!(JSON.stringify({ id: 1, result: [[], 'abcd0123', 4], error: null }));
  await audit.fromClient!(JSON.stringify({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] }));
  audit.fromPool!(JSON.stringify({ id: null, method: 'mining.notify', params: ['j', job.prevhash, job.coinb1, job.coinb2, [], job.version, job.nbits, job.ntime, true] }));
  let nonce = 0;
  let rebuilt;
  do {
    rebuilt = rebuildBlockHeader({ ...job, xn1: 'abcd0123', xn2: '00000000', nonce: (++nonce).toString(16).padStart(8, '0') });
  } while (!rebuilt.isBlock);
  await audit.fromClient!(JSON.stringify({ id: 3, method: 'mining.submit', params: [visitor, 'j', '00000000', job.ntime, nonce.toString(16).padStart(8, '0')] }));
  const record = stores.shares.records.at(-1) as ShareRecord;
  return { blockHash: rebuilt.blockHash, coinbaseTxid: rebuilt.coinbaseTxid, record };
}

/** A chain on which `found` is a block at height 1000 paying the owner REWARD. */
function chainWith(
  found: { blockHash: string; coinbaseTxid: string },
  extra: Partial<Pick<MockChain, 'tip' | 'utxoList' | 'blocks' | 'coinbases' | 'failBroadcast'>> = {},
): MockChain {
  return mockChain({
    tip: 1099, // 100 confirmations
    blocks: { [found.blockHash]: { inBestChain: true, height: 1000 } },
    coinbases: { [found.blockHash]: { txid: found.coinbaseTxid, outputs: [{ script: OWNER_SCRIPT, value: REWARD }] } },
    utxoList: [{ txid: found.coinbaseTxid, vout: 0, value: REWARD, height: 1000, coinbase: true }],
    ...extra,
  });
}

function setup() {
  const stores = memoryStores();
  const visitor = createWallet().address;
  const opts = (chain: MockChain, extra: Partial<PayoutOptions> = {}): PayoutOptions => ({
    ...stores,
    chain,
    ownerMnemonic: OWNER_WORDS,
    sharePercent: 10,
    ...extra,
  });
  return { stores, visitor, opts };
}

test('pays the finder exactly 10% of the owner reward, once', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
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
  assert.equal(stores.ledger.entries.get(found.blockHash)?.status, 'sent');
});

test('the share percent is a parameter', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  const [r] = await verifyPayout(visitor, opts(chainWith(found), { sharePercent: 25 }));
  assert.equal(r.payoutSats, REWARD / 4n);
  assert.throws(() => verifyPayout(visitor, opts(chainWith(found), { sharePercent: 0 })), /1 to 100/);
  assert.throws(() => verifyPayout(visitor, opts(chainWith(found), { sharePercent: 10.5 })), /1 to 100/);
});

test('someone else gets nothing for that block', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  const chain = chainWith(found);
  assert.deepEqual(await verifyPayout(createWallet().address, opts(chain)), []);
  assert.deepEqual(await verifyPayout(OWNER, opts(chain)), []);
  assert.equal(chain.broadcasts.length, 0);
});

test('waits for 100 confirmations and never pays blocks outside the best chain', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
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
  assert.throws(() => verifyPayout(visitor, opts(chain, { minConfirmations: 6 })), /at least 100/);
});

test("refuses a block whose coinbase isn't the share's or doesn't pay the owner", async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  const chain = chainWith(found);
  chain.coinbases[found.blockHash] = { txid: 'ee'.repeat(32), outputs: [{ script: OWNER_SCRIPT, value: REWARD }] };
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'not-ours');
  chain.coinbases[found.blockHash] = { txid: found.coinbaseTxid, outputs: [{ script: addressScript(visitor), value: REWARD }] };
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'not-ours');
  assert.equal(chain.broadcasts.length, 0);
});

test('a share edited in storage is rebuilt from its fields, so it proves nothing', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  stores.shares.records[0] = { ...found.record, nonce: 'ffffffff' }; // keeps the real blockHash and isBlock
  const results = await verifyPayout(visitor, opts(chainWith(found)));
  assert.ok(results.every((r) => r.status !== 'paid'));
});

test('a payout that may have been broadcast is never retried automatically', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  const chain = chainWith(found, { failBroadcast: 'connection reset' });
  const [first] = await verifyPayout(visitor, opts(chain));
  assert.deepEqual([first.status, first.error], ['needs-review', 'connection reset']);
  chain.failBroadcast = null;
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'needs-review');
  assert.equal(chain.broadcasts.length, 0);
  // After checking that txid isn't on-chain, the operator voids the attempt.
  assert.equal(await stores.ledger.void(found.blockHash), true);
  const [retry] = await verifyPayout(visitor, opts(chain));
  assert.equal(retry.status, 'paid');
  // Same coin, same outputs, deterministic signature: the same transaction,
  // so even a first attempt that did reach the network can't pay twice.
  assert.equal(retry.txid, first.txid);
  assert.equal(await stores.ledger.void(found.blockHash), false, 'a sent payout cannot be voided');
});

test('without funds it reports not-paid-yet and pays later', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  const chain = chainWith(found, { utxoList: [] });
  const [r] = await verifyPayout(visitor, opts(chain));
  assert.equal(r.status, 'not-paid-yet');
  assert.match(r.error ?? '', /not enough/);
  chain.utxoList = [{ txid: found.coinbaseTxid, vout: 0, value: REWARD, height: 1000, coinbase: true }];
  assert.equal((await verifyPayout(visitor, opts(chain)))[0].status, 'paid');
});

test('concurrent calls pay once', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  const chain = chainWith(found);
  const results = await Promise.all([verifyPayout(visitor, opts(chain)), verifyPayout(visitor, opts(chain)), verifyPayout(visitor, opts(chain))]);
  assert.deepEqual(results.map((r) => r[0].status).sort(), ['already-paid', 'already-paid', 'paid']);
  assert.equal(chain.broadcasts.length, 1);
});

test('a reserve conflict from another process is never paid twice', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  const chain = chainWith(found);
  // Another process reserved the block between our check and our reserve.
  const realReserve = stores.ledger.reserve;
  stores.ledger.reserve = async (entry) => {
    await realReserve({ ...entry, txid: 'aa'.repeat(32), inputs: [] });
    return realReserve(entry);
  };
  const [r] = await verifyPayout(visitor, opts(chain));
  assert.equal(r.status, 'needs-review');
  assert.equal(chain.broadcasts.length, 0);
});

test('two visitors recorded for one block: held for review', async () => {
  const { stores, visitor, opts } = setup();
  const found = await findBlock(stores, visitor);
  await stores.shares.add({ ...found.record, visitor: createWallet().address });
  const [r] = await verifyPayout(visitor, opts(chainWith(found)));
  assert.equal(r.status, 'needs-review');
});

test('payoutAll settles every visitor with a block', async () => {
  const { stores, opts } = setup();
  const a = createWallet().address;
  const b = createWallet().address;
  const fa = await findBlock(stores, a, 1);
  const fb = await findBlock(stores, b, 2);
  const chain = mockChain({
    tip: 1099,
    blocks: { [fa.blockHash]: { inBestChain: true, height: 1000 }, [fb.blockHash]: { inBestChain: true, height: 1000 } },
    coinbases: {
      [fa.blockHash]: { txid: fa.coinbaseTxid, outputs: [{ script: OWNER_SCRIPT, value: REWARD }] },
      [fb.blockHash]: { txid: fb.coinbaseTxid, outputs: [{ script: OWNER_SCRIPT, value: REWARD }] },
    },
    utxoList: [
      { txid: fa.coinbaseTxid, vout: 0, value: REWARD, height: 1000, coinbase: true },
      { txid: fb.coinbaseTxid, vout: 0, value: REWARD, height: 1000, coinbase: true },
    ],
  });
  const all = await payoutAll(opts(chain));
  assert.deepEqual(Object.keys(all).sort(), [a, b].sort());
  assert.ok(Object.values(all).every((r) => r[0].status === 'paid'), JSON.stringify(all, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
  // Two payouts, two different coins.
  const inputs = [...stores.ledger.entries.values()].flatMap((e) => e.inputs);
  assert.equal(new Set(inputs).size, 2);
});
