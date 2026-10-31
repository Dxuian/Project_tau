// createPayoutService (src/payouts/service.ts): the auditor and the engine
// wired to one owner. A visitor mines through the service's own interceptor;
// the pool sees the owner's login, and the visitor is paid sharePercent, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayoutService, memoryStores, rebuildBlockHeader, type PayoutService, type ShareRecord } from '../src/payouts/index.ts';
import { addressScript, createWallet, walletFromMnemonic } from '../src/wallet/index.ts';
import { mockChain, outputsOf } from './mock-chain.ts';

const OWNER_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER = walletFromMnemonic(OWNER_WORDS).address;
const OWNER_SCRIPT = addressScript(OWNER);
const REWARD = 312_500_000n;

function le64(n: bigint): string {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b.toString('hex');
}

/** `visitor` finds a block (easy nbits) through `service.intercept`; returns the block and the lines the pool got. */
async function findBlockThrough(service: PayoutService, visitor: string) {
  const job = {
    prevhash: '00'.repeat(31) + '01',
    coinb1: '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + '0c' + '03' + '0003e8',
    coinb2: 'ffffffff' + '01' + le64(REWARD) + '16' + OWNER_SCRIPT + '00000000',
    merkle: [] as string[],
    version: '20000000',
    nbits: '207fffff',
    ntime: '66000000',
  };
  const icp = service.intercept({
    id: 1,
    peer: 'p',
    target: 'pool:3333',
    tls: false,
    origin: null,
    query: new URLSearchParams(),
    reply() {},
    close() {},
  });
  const toPool: (string | null)[] = [];
  toPool.push(await icp.fromClient!(JSON.stringify({ id: 1, method: 'mining.subscribe', params: [] })));
  await icp.fromPool!(JSON.stringify({ id: 1, result: [[], 'abcd0123', 4], error: null }));
  toPool.push(await icp.fromClient!(JSON.stringify({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] })));
  await icp.fromPool!(JSON.stringify({ id: null, method: 'mining.notify', params: ['j', job.prevhash, job.coinb1, job.coinb2, [], job.version, job.nbits, job.ntime, true] }));
  let nonce = 0;
  let rebuilt;
  do {
    rebuilt = rebuildBlockHeader({ ...job, xn1: 'abcd0123', xn2: '00000000', nonce: (++nonce).toString(16).padStart(8, '0') });
  } while (!rebuilt.isBlock);
  toPool.push(await icp.fromClient!(JSON.stringify({ id: 3, method: 'mining.submit', params: [visitor, 'j', '00000000', job.ntime, nonce.toString(16).padStart(8, '0')] })));
  return { blockHash: rebuilt.blockHash, coinbaseTxid: rebuilt.coinbaseTxid, toPool };
}

test('one owner for the pool login and the payouts: the finder gets sharePercent, once', async () => {
  const stores = memoryStores();
  const chain = mockChain();
  const service = createPayoutService({ ownerAddress: OWNER, ownerMnemonic: OWNER_WORDS, sharePercent: 10, ...stores, chain });
  assert.equal(service.canPay, true);
  const visitor = createWallet().address;
  const found = await findBlockThrough(service, visitor);

  // The pool saw the owner, never the visitor.
  const authorize = JSON.parse(found.toPool[1]!);
  assert.equal(authorize.params[0], OWNER);
  const submit = JSON.parse(found.toPool[2]!);
  assert.equal(submit.params[0], OWNER);
  // The share was recorded, as the visitor's, before it was forwarded.
  const record = stores.shares.records.at(-1) as ShareRecord;
  assert.equal(record.visitor, visitor);
  assert.equal(record.blockHash, found.blockHash);

  chain.blocks[found.blockHash] = { inBestChain: true, height: 1000 };
  chain.coinbases[found.blockHash] = { txid: found.coinbaseTxid, outputs: [{ script: OWNER_SCRIPT, value: REWARD }] };
  chain.utxoList = [{ txid: found.coinbaseTxid, vout: 0, value: REWARD, height: 1000, coinbase: true }];
  const [paid] = await service.verifyPayout(visitor);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.payoutSats, REWARD / 10n);
  assert.deepEqual(outputsOf(chain.broadcasts[0]).outputs[0], { script: addressScript(visitor), amount: REWARD / 10n });
  assert.equal((await service.verifyPayout(visitor))[0].status, 'already-paid');
  assert.deepEqual(Object.keys(await service.payoutAll()), [visitor]);
  assert.equal(chain.broadcasts.length, 1);
});

test('without the owner words it records shares but cannot pay', async () => {
  const stores = memoryStores();
  const service = createPayoutService({ ownerAddress: OWNER, sharePercent: 10, ...stores });
  assert.equal(service.canPay, false);
  const visitor = createWallet().address;
  await findBlockThrough(service, visitor);
  assert.equal(stores.shares.records.length, 1);
  await assert.rejects(service.verifyPayout(visitor), /cannot pay/);
  await assert.rejects(service.payoutAll(), /cannot pay/);
});

test('refuses settings that would pay the wrong wallet or nobody', () => {
  const stores = memoryStores();
  const chain = mockChain();
  const base = { ownerAddress: OWNER, sharePercent: 10, ...stores, chain };
  assert.throws(() => createPayoutService({ ...base, ownerMnemonic: createWallet().mnemonic }), /not the wallet of ownerAddress/);
  assert.throws(() => createPayoutService({ ...base, ownerMnemonic: OWNER_WORDS, chain: undefined }), /chain client/);
  assert.throws(() => createPayoutService({ ...base, ownerAddress: 'nope' }), /ownerAddress/);
  assert.throws(() => createPayoutService({ ...base, ownerAddress: createWallet({ network: 'regtest' }).address }), /mainnet address/);
  assert.throws(() => createPayoutService({ ...base, sharePercent: 0 }), /1 to 100/);
  assert.throws(() => createPayoutService({ ...base, sharePercent: 10.5 }), /1 to 100/);
  assert.throws(() => createPayoutService({ ...base, shares: undefined as never }), /shares and ledger/);
  // The owner's words on another network belong to another address.
  const regtestOwner = createWallet({ network: 'regtest' });
  assert.equal(
    createPayoutService({ ...base, network: 'regtest', ownerAddress: regtestOwner.address, ownerMnemonic: regtestOwner.mnemonic }).canPay,
    true,
  );
});
