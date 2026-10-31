// Sending BTC from a BIP84 wallet's addresses: our own largest-first coin
// selection (btc-signer's selectUTXO is documented as unaudited), an
// upper-bound fee from the transaction's size, change back to the wallet, and
// each input signed by btc-signer with the key of its address.
import * as btc from '@scure/btc-signer';
import { fromHex } from './bytes.ts';
import type { ChainClient, ChainUtxo } from './chain.ts';
import { addressScript, bitcoinNetwork, walletKeys, type DerivedKey, type NetworkName } from './keys.ts';

const DUST_SATS = 546n;
const COINBASE_MATURITY = 100;

export interface PaymentOptions {
  /** Words of the wallet that pays. Used for this call only; never stored. */
  mnemonic: string;
  chain: ChainClient;
  network?: NetworkName;
  /** sat/vB; default the chain's estimate. */
  feeRate?: number;
  /** Refuse (rather than overpay) above this rate. Default 200 sat/vB. */
  maxFeeRate?: number;
  /** Confirmations a coin needs to be spent (default 1; coinbase outputs always need 100). */
  minConfirmations?: number;
  /** Coins ("txid:vout") not to spend, e.g. ones another payment already uses. */
  exclude?: Set<string>;
  /** Receive indexes of the paying wallet whose coins may be spent. Default [0], its first address. */
  from?: number[];
  /** Receive index the change goes to. Default the first of `from`. */
  changeIndex?: number;
}

export interface Payment {
  txid: string;
  hex: string;
  feeSats: bigint;
  vsize: number;
  amountSats: bigint;
  to: string;
  /** Coins spent, as "txid:vout". */
  inputs: string[];
}

function sats(value: bigint | number): bigint {
  const n = typeof value === 'bigint' ? value : Number.isSafeInteger(value) ? BigInt(value) : null;
  if (n === null || n <= 0n) throw new Error('amount must be a positive whole number of satoshis');
  return n;
}

/** Upper-bound virtual size with P2WPKH inputs (72-byte signatures). */
function estimateVsize(inputs: number, outputScripts: string[]): number {
  const outputs = outputScripts.reduce((w, s) => w + 4 * (8 + 1 + s.length / 2), 0);
  // version, counts, locktime 10 bytes; marker+flag 2 WU; per input 41 bytes + 108-byte witness.
  return Math.ceil((40 + 2 + inputs * (41 * 4 + 108) + outputs) / 4);
}

/** Builds and signs a payment without broadcasting it. */
export async function buildPayment(to: string, amountSats: bigint | number, options: PaymentOptions): Promise<Payment> {
  const { mnemonic, chain, network = 'mainnet', feeRate, maxFeeRate = 200, minConfirmations = 1, exclude = new Set(), from = [0] } = options;
  const amount = sats(amountSats);
  if (amount < DUST_SATS) throw new Error(`amount below the dust limit (${DUST_SATS} sats)`);
  if (!chain) throw new Error('a chain client is required');
  if (!Array.isArray(from) || from.length === 0) throw new Error('from must list at least one receive index');
  const toScript = addressScript(to, network);
  const keys = walletKeys(mnemonic, network);
  const sources = [...new Set(from)].map((index) => keys.key(index));
  const changeKey = keys.key(options.changeIndex ?? from[0]);
  if (toScript === changeKey.script || sources.some((s) => s.script === toScript)) throw new Error('refusing to pay the wallet itself');
  const rate = Number(feeRate ?? (await chain.feeRate()));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('invalid fee rate');
  if (rate > maxFeeRate) throw new Error(`fee rate ${rate} sat/vB is above maxFeeRate (${maxFeeRate})`);
  const feeFor = (inputs: number) => BigInt(Math.ceil(estimateVsize(inputs, [toScript, changeKey.script]) * Math.max(rate, 1)));

  // Spendable coins of every source address: confirmed, not excluded, coinbase
  // outputs only once mature. Largest first.
  const tip = await chain.tipHeight();
  const usable: (ChainUtxo & { key: DerivedKey })[] = [];
  for (const key of sources) {
    for (const u of await chain.utxos(key.address)) {
      if (u.height === null || u.height === undefined) continue;
      const confirmations = tip - u.height + 1;
      if (confirmations < minConfirmations || exclude.has(`${u.txid}:${u.vout}`)) continue;
      if (confirmations < COINBASE_MATURITY && (u.coinbase ?? (await chain.isCoinbase(u.txid, u.height)))) continue;
      usable.push({ ...u, key });
    }
  }
  usable.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

  const chosen: typeof usable = [];
  let total = 0n;
  let fee = 0n;
  for (const u of usable) {
    chosen.push(u);
    total += u.value;
    fee = feeFor(chosen.length);
    if (total >= amount + fee) break;
  }
  if (total < amount + fee) throw new Error(`not enough confirmed funds: have ${total} sats, need ${amount + fee}`);
  let change = total - amount - fee;
  if (change < DUST_SATS) {
    change = 0n; // the remainder goes to the fee
    fee = total - amount;
  }

  const net = bitcoinNetwork(network);
  const tx = new btc.Transaction();
  for (const u of chosen) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: fromHex(u.key.script), amount: u.value } });
  tx.addOutputAddress(to, amount, net);
  if (change > 0n) tx.addOutputAddress(changeKey.address, change, net);
  // Each input with the key of the address it pays.
  chosen.forEach((u, i) => {
    if (!tx.signIdx(u.key.privateKey, i)) throw new Error('internal error: an input was not signed');
  });
  tx.finalize();
  if (tx.fee !== fee) throw new Error('internal error: fee mismatch');
  return { txid: tx.id, hex: tx.hex, feeSats: fee, vsize: tx.vsize, amountSats: amount, to, inputs: chosen.map((u) => `${u.txid}:${u.vout}`) };
}

/**
 * Sends `amountSats` to `to` from the wallet of `options.mnemonic` (which pays
 * the network fee). `broadcast: false` only builds and signs.
 */
export async function payout(to: string, amountSats: bigint | number, options: PaymentOptions & { broadcast?: boolean }): Promise<Payment> {
  const built = await buildPayment(to, amountSats, options);
  if (options.broadcast === false) return built;
  const txid = await options.chain.broadcast(built.hex);
  if (txid !== built.txid) throw new Error(`broadcast returned ${txid}, expected ${built.txid}`);
  return built;
}
