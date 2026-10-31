// An in-memory chain client (the ChainClient interface of src/wallet/chain.ts).
import * as btc from '@scure/btc-signer';
import type { ChainClient, ChainUtxo } from '../src/wallet/chain.ts';

export interface MockChain extends ChainClient {
  tip: number;
  utxoList: ChainUtxo[];
  blocks: Record<string, { inBestChain: boolean; height: number | null }>;
  coinbases: Record<string, { txid: string; outputs: { script: string; value: bigint }[] }>;
  failBroadcast: string | null;
  broadcasts: string[];
}

export function mockChain(init: Partial<Pick<MockChain, 'tip' | 'utxoList' | 'blocks' | 'coinbases' | 'failBroadcast'>> & { feeRate?: number; coinbaseTxids?: string[] } = {}): MockChain {
  const chain: MockChain = {
    tip: init.tip ?? 1099,
    utxoList: init.utxoList ?? [],
    blocks: init.blocks ?? {},
    coinbases: init.coinbases ?? {},
    failBroadcast: init.failBroadcast ?? null,
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
      return (init.coinbaseTxids ?? []).includes(txid);
    },
    async feeRate() {
      return init.feeRate ?? 5;
    },
    async broadcast(hex) {
      if (chain.failBroadcast) throw new Error(chain.failBroadcast);
      chain.broadcasts.push(hex);
      return btc.Transaction.fromRaw(Buffer.from(hex, 'hex')).id;
    },
  };
  return chain;
}

/** Outputs of a raw transaction as { script (hex), amount }. */
export function outputsOf(hex: string): { outputs: { script: string; amount: bigint }[]; inputs: number; id: string } {
  const tx = btc.Transaction.fromRaw(Buffer.from(hex, 'hex'));
  const outputs = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    outputs.push({ script: Buffer.from(o.script as Uint8Array).toString('hex'), amount: o.amount as bigint });
  }
  return { outputs, inputs: tx.inputsLength, id: tx.id };
}
