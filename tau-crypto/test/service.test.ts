// createPayoutService (src/payouts/service.ts): the auditor and the engine
// wired to one owner. A visitor mines through the service's own interceptor;
// the pool sees the owner's login, and the visitor is paid sharePercent, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayoutService, memoryStores, rebuildBlockHeader, type PayoutService, type ShareRecord } from '../src/payouts/index.ts';
import { accountXpub, addressScript, createWallet, newAddress, walletFromMnemonic } from '../src/wallet/index.ts';
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
async function findBlockThrough(service: PayoutService, visitor: string, { payTo = OWNER_SCRIPT, query = new URLSearchParams() } = {}) {
  const job = {
    prevhash: '00'.repeat(31) + '01',
    coinb1: '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + '0c' + '03' + '0003e8',
    coinb2: 'ffffffff' + '01' + le64(REWARD) + '16' + payTo + '00000000',
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
    query,
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

const HOUR = 3_600_000;
const EPOCH = Date.UTC(2026, 0, 1);
const hourly = { periodMs: HOUR, epochMs: EPOCH };
const ownerAt = (index: number) => newAddress({ mnemonic: OWNER_WORDS }, { index }).address;

/** A service with a hand-set clock. */
function hourlyService(extra: Partial<Parameters<typeof createPayoutService>[0]> = {}) {
  const clock = { t: Date.UTC(2026, 9, 31, 13, 30) }; // slot 7286
  const stores = memoryStores();
  const chain = mockChain();
  const service = createPayoutService({
    ownerAddress: OWNER,
    ownerMnemonic: OWNER_WORDS,
    sharePercent: 10,
    addressPeriod: hourly,
    ...stores,
    chain,
    now: () => clock.t,
    ...extra,
  });
  return { clock, stores, chain, service };
}

test('a fresh owner address per hour: the same in one hour, a new one the next', async () => {
  const { clock, stores, service } = hourlyService();
  assert.deepEqual(service.addressFor(), {
    address: ownerAt(7286),
    index: 7286,
    from: '2026-10-31T13:00:00.000Z',
    until: '2026-10-31T14:00:00.000Z',
  });
  const a = await findBlockThrough(service, createWallet().address);
  clock.t += 20 * 60_000; // 13:50, same hour
  const b = await findBlockThrough(service, createWallet().address);
  clock.t += 20 * 60_000; // 14:10
  const c = await findBlockThrough(service, createWallet().address);
  const logins = [a, b, c].map((x) => JSON.parse(x.toPool[1]!).params[0]);
  assert.deepEqual(logins, [ownerAt(7286), ownerAt(7286), ownerAt(7287)]);
  assert.deepEqual(stores.shares.records.map((r) => [r.poolUser, r.ownerIndex]), [
    [ownerAt(7286), 7286],
    [ownerAt(7286), 7286],
    [ownerAt(7287), 7287],
  ]);
  assert.equal(service.addressFor(Date.UTC(2026, 9, 31, 14, 59)).index, 7287);
});

test('a connection keeps the slot its page showed if it is the current or the previous one', async () => {
  const { clock, service } = hourlyService();
  clock.t = Date.UTC(2026, 9, 31, 14, 0, 5); // just after the hour turned: slot 7287
  const login = async (slot: string | null) => {
    const query = new URLSearchParams(slot === null ? {} : { slot });
    const found = await findBlockThrough(service, createWallet().address, { query });
    return JSON.parse(found.toPool[1]!).params[0];
  };
  assert.equal(await login('7286'), ownerAt(7286), 'shown just before the hour turned');
  assert.equal(await login('7287'), ownerAt(7287));
  assert.equal(await login('7285'), ownerAt(7287), 'too old: the current slot');
  assert.equal(await login('9999'), ownerAt(7287), 'not yet: the current slot');
  assert.equal(await login('0'), ownerAt(7287), "never the owner's first address");
  assert.equal(await login('abc'), ownerAt(7287));
  assert.equal(await login(null), ownerAt(7287));
});

test("a slot's block is paid from its address", async () => {
  const { service, chain } = hourlyService();
  const visitor = createWallet().address;
  const found = await findBlockThrough(service, visitor, { payTo: addressScript(ownerAt(7286)) });
  chain.blocks[found.blockHash] = { inBestChain: true, height: 1000 };
  chain.coinbases[found.blockHash] = { txid: found.coinbaseTxid, outputs: [{ script: addressScript(ownerAt(7286)), value: REWARD }] };
  const coin = { txid: found.coinbaseTxid, vout: 0, value: REWARD, height: 1000, coinbase: true };
  chain.utxos = async (address: string) => (address === ownerAt(7286) ? [coin] : []);
  const [paid] = await service.verifyPayout(visitor);
  assert.equal(paid.status, 'paid', paid.error);
  assert.equal(paid.ownerAddress, ownerAt(7286));
  const { outputs } = outputsOf(chain.broadcasts[0]);
  assert.deepEqual(outputs[0], { script: addressScript(visitor), amount: REWARD / 10n });
  assert.equal(outputs[1].script, OWNER_SCRIPT);
});

test('with only the xpub it hands out the same addresses and records shares, but cannot pay', async () => {
  const xpub = accountXpub(OWNER_WORDS);
  const { stores, service } = hourlyService({ ownerMnemonic: undefined, ownerXpub: xpub, chain: undefined });
  assert.equal(service.canPay, false);
  assert.equal(service.addressFor().address, ownerAt(7286));
  await findBlockThrough(service, createWallet().address);
  assert.equal(stores.shares.records[0].poolUser, ownerAt(7286));
  await assert.rejects(service.payoutAll(), /cannot pay/);
});

test('refuses keys that are not the wallet of ownerAddress, and fresh addresses without keys', () => {
  const someone = createWallet();
  assert.throws(() => hourlyService({ ownerXpub: accountXpub(someone.mnemonic) }), /ownerXpub is not the wallet of ownerAddress/);
  assert.throws(() => hourlyService({ ownerMnemonic: undefined, chain: undefined }), /need ownerXpub or ownerMnemonic/);
  assert.throws(() => hourlyService({ addressPeriod: { periodMs: 10, epochMs: EPOCH } }), /at least 1000/);
  // Without addressPeriod everyone mines to ownerAddress.
  const single = createPayoutService({ ownerAddress: OWNER, sharePercent: 10, ...memoryStores() });
  assert.deepEqual(single.addressFor(), { address: OWNER, index: 0, from: null, until: null });
});
