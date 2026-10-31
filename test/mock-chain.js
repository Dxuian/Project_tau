// An in-memory chain client (the same interface as esplora() / bitcoinCore()).
import * as btc from '@scure/btc-signer';

export function mockChain({ tip = 1099, utxos = [], blocks = {}, coinbases = {}, feeRate = 5, coinbaseTxids = [], failBroadcast = null } = {}) {
  const chain = {
    tip,
    utxoList: utxos,
    blocks,
    coinbases,
    failBroadcast,
    broadcasts: [],
    async tipHeight() {
      return chain.tip;
    },
    async block(hash) {
      return chain.blocks[hash] ?? null;
    },
    async coinbase(hash) {
      return chain.coinbases[hash] ?? null;
    },
    async utxos() {
      return chain.utxoList;
    },
    async isCoinbase(txid) {
      return coinbaseTxids.includes(txid);
    },
    async feeRate() {
      return feeRate;
    },
    async broadcast(hex) {
      if (chain.failBroadcast) throw new Error(chain.failBroadcast);
      chain.broadcasts.push(hex);
      return btc.Transaction.fromRaw(Buffer.from(hex, 'hex')).id;
    },
  };
  return chain;
}

/** Outputs of a raw transaction as [{ script (hex), amount }]. */
export function outputsOf(hex) {
  const tx = btc.Transaction.fromRaw(Buffer.from(hex, 'hex'));
  const out = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    out.push({ script: Buffer.from(o.script).toString('hex'), amount: o.amount });
  }
  return { tx, outputs: out, inputs: tx.inputsLength };
}
