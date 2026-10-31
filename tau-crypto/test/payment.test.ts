// payout() / buildPayment(): coin selection, fees, change and refusals, against a mock chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { addressScript, createWallet, newAddress, payout, walletFromMnemonic } from '../src/wallet/index.ts';
import type { ChainUtxo } from '../src/wallet/index.ts';
import { mockChain, outputsOf, type MockChain } from './mock-chain.ts';

const OWNER_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER = walletFromMnemonic(OWNER_WORDS).address;
const visitor = createWallet().address;
const txid = (n: number) => n.toString(16).padStart(64, '0');
const opts = (chain: MockChain, extra: object = {}) => ({ chain, mnemonic: OWNER_WORDS, ...extra });

test('pays the amount, returns change to the owner, fee covers the rate', async () => {
  const chain = mockChain({ utxoList: [{ txid: txid(1), vout: 0, value: 100_000_000n, height: 900, coinbase: true }] });
  const r = await payout(visitor, 10_000_000n, opts(chain));
  assert.equal(chain.broadcasts.length, 1);
  const { id, outputs, inputs } = outputsOf(chain.broadcasts[0]);
  assert.equal(id, r.txid);
  assert.equal(inputs, 1);
  assert.deepEqual(outputs, [
    { script: addressScript(visitor), amount: 10_000_000n },
    { script: addressScript(OWNER), amount: 100_000_000n - 10_000_000n - r.feeSats },
  ]);
  assert.ok(r.feeSats >= BigInt(r.vsize * 5), `fee ${r.feeSats} for ${r.vsize} vB`);
  assert.ok(r.feeSats <= BigInt(r.vsize * 5 + 10));
  assert.deepEqual(r.inputs, [`${txid(1)}:0`]);
});

test('largest coin first, as few inputs as possible', async () => {
  const chain = mockChain({
    utxoList: [
      { txid: txid(1), vout: 0, value: 20_000n, height: 1000, coinbase: false },
      { txid: txid(2), vout: 1, value: 50_000_000n, height: 1000, coinbase: false },
      { txid: txid(3), vout: 0, value: 5_000_000n, height: 1000, coinbase: false },
    ],
  });
  const r = await payout(visitor, 1_000_000n, opts(chain, { broadcast: false }));
  assert.deepEqual(r.inputs, [`${txid(2)}:1`]);
  assert.equal(chain.broadcasts.length, 0, 'broadcast: false only signs');
  const two = await payout(visitor, 52_000_000n, opts(chain, { broadcast: false }));
  assert.deepEqual(two.inputs, [`${txid(2)}:1`, `${txid(3)}:0`]);
});

test('change below dust goes to the fee', async () => {
  // 1 input, 2 outputs at 5 sat/vB: 141 vB -> 705 sats; 100 sats of change is dust.
  const chain = mockChain({ utxoList: [{ txid: txid(1), vout: 0, value: 1_000_805n, height: 1000, coinbase: false }] });
  const r = await payout(visitor, 1_000_000n, opts(chain));
  const { outputs } = outputsOf(chain.broadcasts[0]);
  assert.equal(outputs.length, 1);
  assert.equal(r.feeSats, 805n);
});

test('only spends mature coinbase coins and confirmed coins', async () => {
  const young = { txid: txid(1), vout: 0, value: 100_000_000n, height: 1050, coinbase: true }; // 50 confirmations
  const pending = { txid: txid(2), vout: 0, value: 100_000_000n, height: null };
  const chain = mockChain({ utxoList: [young, pending] });
  await assert.rejects(payout(visitor, 1_000_000n, opts(chain)), /not enough confirmed funds/);
  // Esplora doesn't say which coins are coinbase: the client is asked.
  const asked = mockChain({ utxoList: [{ ...young, coinbase: undefined }], coinbaseTxids: [txid(1)] });
  await assert.rejects(payout(visitor, 1_000_000n, opts(asked)), /not enough/);
  const ordinary = mockChain({ utxoList: [{ ...young, coinbase: false }] });
  assert.ok((await payout(visitor, 1_000_000n, opts(ordinary))).txid);
});

test('refuses unsafe or invalid payments', async () => {
  const chain = mockChain({ utxoList: [{ txid: txid(1), vout: 0, value: 100_000_000n, height: 900, coinbase: true }] });
  await assert.rejects(payout(OWNER, 1_000_000n, opts(chain)), /the wallet itself/);
  await assert.rejects(payout('nonsense', 1_000_000n, opts(chain)), /invalid mainnet address/);
  await assert.rejects(payout(createWallet({ network: 'testnet' }).address, 1_000_000n, opts(chain)), /invalid mainnet address/);
  await assert.rejects(payout(visitor, 100n, opts(chain)), /dust/);
  await assert.rejects(payout(visitor, 1.5, opts(chain)), /whole number/);
  await assert.rejects(payout(visitor, 1_000_000n, opts(chain, { feeRate: 500 })), /above maxFeeRate/);
  await assert.rejects(payout(visitor, 1_000_000n, { chain, mnemonic: '' }), /invalid mnemonic/);
  await assert.rejects(payout(visitor, 200_000_000n, opts(chain)), /not enough confirmed funds/);
  assert.equal(chain.broadcasts.length, 0);
});

/** A chain whose coins belong to particular addresses. */
function chainOf(byAddress: Record<string, ChainUtxo[]>): MockChain {
  const chain = mockChain();
  chain.utxos = async (address: string) => byAddress[address] ?? [];
  return chain;
}
const at = (index: number) => newAddress({ mnemonic: OWNER_WORDS }, { index }).address;
const publicKeyAt = (index: number) =>
  Buffer.from(HDKey.fromMasterSeed(mnemonicToSeedSync(OWNER_WORDS)).derive(`m/84'/0'/0'/0/${index}`).publicKey!).toString('hex');

test('spends from the chosen receive indexes, signing each input with its own key; change to changeIndex', async () => {
  const chain = chainOf({
    [at(5)]: [{ txid: txid(5), vout: 0, value: 30_000n, height: 1000, coinbase: false }],
    [at(9)]: [{ txid: txid(9), vout: 1, value: 40_000n, height: 1000, coinbase: false }],
    [OWNER]: [{ txid: txid(1), vout: 0, value: 100_000_000n, height: 1000, coinbase: false }], // not a source here
  });
  const r = await payout(visitor, 60_000n, opts(chain, { from: [5, 9], changeIndex: 0 }));
  assert.deepEqual(r.inputs, [`${txid(9)}:1`, `${txid(5)}:0`], 'largest first, only from the sources');
  const { outputs } = outputsOf(chain.broadcasts[0]);
  assert.deepEqual(outputs, [
    { script: addressScript(visitor), amount: 60_000n },
    { script: addressScript(OWNER), amount: 70_000n - 60_000n - r.feeSats },
  ]);
  // Each witness carries the public key of the address its coin belongs to.
  const tx = btc.Transaction.fromRaw(Buffer.from(chain.broadcasts[0], 'hex'));
  const witnessKey = (i: number) => Buffer.from(tx.getInput(i).finalScriptWitness![1]).toString('hex');
  assert.deepEqual([witnessKey(0), witnessKey(1)], [publicKeyAt(9), publicKeyAt(5)]);
});

test('change goes back to the first source by default; refuses paying any of its own addresses', async () => {
  const chain = chainOf({ [at(3)]: [{ txid: txid(3), vout: 0, value: 1_000_000n, height: 1000, coinbase: false }] });
  await payout(visitor, 100_000n, opts(chain, { from: [3] }));
  assert.equal(outputsOf(chain.broadcasts[0]).outputs[1].script, addressScript(at(3)));
  await assert.rejects(payout(at(3), 100_000n, opts(chain, { from: [3] })), /the wallet itself/);
  await assert.rejects(payout(OWNER, 100_000n, opts(chain, { from: [3], changeIndex: 0 })), /the wallet itself/);
  await assert.rejects(payout(visitor, 100_000n, opts(chain, { from: [] })), /at least one receive index/);
  await assert.rejects(payout(visitor, 100_000n, opts(chain, { from: [-1] })), /index must be a whole number/);
  // Index 0 has nothing on this chain.
  await assert.rejects(payout(visitor, 100_000n, opts(chain)), /not enough confirmed funds/);
});
