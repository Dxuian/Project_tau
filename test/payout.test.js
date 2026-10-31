// payout(): coin selection, fees, change and refusals, against a mock chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressScript, createWallet, payout, walletFromMnemonic } from '../btc.js';
import { mockChain, outputsOf } from './mock-chain.js';

const OWNER_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER = walletFromMnemonic(OWNER_WORDS).address;
const visitor = createWallet().address;
const txid = (n) => n.toString(16).padStart(64, '0');
const opts = (chain, extra = {}) => ({ chain, ownerMnemonic: OWNER_WORDS, ...extra });

test('pays the amount, returns change to the owner, fee covers the rate', async () => {
  const chain = mockChain({ utxos: [{ txid: txid(1), vout: 0, value: 100_000_000n, height: 900, coinbase: true }] });
  const r = await payout(visitor, 10_000_000n, opts(chain));
  assert.equal(chain.broadcasts.length, 1);
  const { tx, outputs, inputs } = outputsOf(chain.broadcasts[0]);
  assert.equal(tx.id, r.txid);
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
    utxos: [
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
  const chain = mockChain({ utxos: [{ txid: txid(1), vout: 0, value: 1_000_805n, height: 1000, coinbase: false }] });
  const r = await payout(visitor, 1_000_000n, opts(chain));
  const { outputs } = outputsOf(chain.broadcasts[0]);
  assert.equal(outputs.length, 1);
  assert.equal(r.feeSats, 805n);
});

test('only spends mature coinbase coins and confirmed coins', async () => {
  const young = { txid: txid(1), vout: 0, value: 100_000_000n, height: 1050, coinbase: true }; // 50 confirmations
  const pending = { txid: txid(2), vout: 0, value: 100_000_000n, height: null };
  const chain = mockChain({ utxos: [young, pending] });
  await assert.rejects(payout(visitor, 1_000_000n, opts(chain)), /not enough confirmed funds/);
  // Esplora doesn't say which coins are coinbase: the client is asked.
  const asked = mockChain({ utxos: [{ ...young, coinbase: undefined }], coinbaseTxids: [txid(1)] });
  await assert.rejects(payout(visitor, 1_000_000n, opts(asked)), /not enough/);
  const ordinary = mockChain({ utxos: [{ ...young, coinbase: false }] });
  assert.ok((await payout(visitor, 1_000_000n, opts(ordinary))).txid);
});

test('refuses unsafe or invalid payments', async () => {
  const chain = mockChain({ utxos: [{ txid: txid(1), vout: 0, value: 100_000_000n, height: 900, coinbase: true }] });
  await assert.rejects(payout(OWNER, 1_000_000n, opts(chain)), /owner address itself/);
  await assert.rejects(payout('nonsense', 1_000_000n, opts(chain)), /invalid mainnet address/);
  await assert.rejects(payout(createWallet({ network: 'testnet' }).address, 1_000_000n, opts(chain)), /invalid mainnet address/);
  await assert.rejects(payout(visitor, 100n, opts(chain)), /dust/);
  await assert.rejects(payout(visitor, 1.5, opts(chain)), /whole number/);
  await assert.rejects(payout(visitor, 1_000_000n, opts(chain, { feeRate: 500 })), /above maxFeeRate/);
  await assert.rejects(payout(visitor, 1_000_000n, { chain }), /OWNER_MNEMONIC/);
  await assert.rejects(payout(visitor, 200_000_000n, opts(chain)), /not enough confirmed funds/);
  assert.equal(chain.broadcasts.length, 0);
});
