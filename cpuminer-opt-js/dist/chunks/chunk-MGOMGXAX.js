import {
  Transaction,
  addressScript,
  bitcoinNetwork,
  deriveKey,
  fromHex
} from "./chunk-S62YAEXG.js";

// src/wallet/payment.ts
var DUST_SATS = 546n;
var COINBASE_MATURITY = 100;
function sats(value) {
  const n = typeof value === "bigint" ? value : Number.isSafeInteger(value) ? BigInt(value) : null;
  if (n === null || n <= 0n) throw new Error("amount must be a positive whole number of satoshis");
  return n;
}
function estimateVsize(inputs, outputScripts) {
  const outputs = outputScripts.reduce((w, s) => w + 4 * (8 + 1 + s.length / 2), 0);
  return Math.ceil((40 + 2 + inputs * (41 * 4 + 108) + outputs) / 4);
}
async function buildPayment(to, amountSats, options) {
  const { mnemonic, chain, network = "mainnet", feeRate, maxFeeRate = 200, minConfirmations = 1, exclude = /* @__PURE__ */ new Set() } = options;
  const amount = sats(amountSats);
  if (amount < DUST_SATS) throw new Error(`amount below the dust limit (${DUST_SATS} sats)`);
  if (!chain) throw new Error("a chain client is required");
  const toScript = addressScript(to, network);
  const owner = deriveKey(mnemonic, network);
  if (toScript === owner.script) throw new Error("refusing to pay the wallet itself");
  const rate = Number(feeRate ?? await chain.feeRate());
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("invalid fee rate");
  if (rate > maxFeeRate) throw new Error(`fee rate ${rate} sat/vB is above maxFeeRate (${maxFeeRate})`);
  const feeFor = (inputs) => BigInt(Math.ceil(estimateVsize(inputs, [toScript, owner.script]) * Math.max(rate, 1)));
  const tip = await chain.tipHeight();
  const usable = [];
  for (const u of await chain.utxos(owner.address)) {
    if (u.height === null || u.height === void 0) continue;
    const confirmations = tip - u.height + 1;
    if (confirmations < minConfirmations || exclude.has(`${u.txid}:${u.vout}`)) continue;
    if (confirmations < COINBASE_MATURITY && (u.coinbase ?? await chain.isCoinbase(u.txid, u.height))) continue;
    usable.push(u);
  }
  usable.sort((a, b) => b.value > a.value ? 1 : b.value < a.value ? -1 : 0);
  const chosen = [];
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
    change = 0n;
    fee = total - amount;
  }
  const net = bitcoinNetwork(network);
  const tx = new Transaction();
  for (const u of chosen) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: fromHex(owner.script), amount: u.value } });
  tx.addOutputAddress(to, amount, net);
  if (change > 0n) tx.addOutputAddress(owner.address, change, net);
  tx.sign(owner.privateKey);
  tx.finalize();
  if (tx.fee !== fee) throw new Error("internal error: fee mismatch");
  return { txid: tx.id, hex: tx.hex, feeSats: fee, vsize: tx.vsize, amountSats: amount, to, inputs: chosen.map((u) => `${u.txid}:${u.vout}`) };
}
async function payout(to, amountSats, options) {
  const built = await buildPayment(to, amountSats, options);
  if (options.broadcast === false) return built;
  const txid = await options.chain.broadcast(built.hex);
  if (txid !== built.txid) throw new Error(`broadcast returned ${txid}, expected ${built.txid}`);
  return built;
}

export {
  buildPayment,
  payout
};
