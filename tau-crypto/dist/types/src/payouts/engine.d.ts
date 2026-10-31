import type { ChainClient } from '../wallet/chain.ts';
import { type NetworkName } from '../wallet/keys.ts';
import type { PayoutLedger, ShareStore } from './stores.ts';
export interface PayoutOptions {
    shares: ShareStore;
    ledger: PayoutLedger;
    chain: ChainClient;
    /**
     * Words of the wallet blocks pay. Each block is checked against, and paid
     * from, the address of its share record's `ownerIndex` (0 when absent).
     */
    ownerMnemonic: string;
    /** The visitor's share of the owner's block reward, whole percent 1..100. */
    sharePercent: number | bigint;
    network?: NetworkName;
    /** At least 100 (coinbase maturity). */
    minConfirmations?: number;
    feeRate?: number;
    maxFeeRate?: number;
    /** Receive index of the owner wallet that payouts send their change to. Default 0, its first address. */
    changeIndex?: number;
}
export type PayoutStatus = 'paid' | 'already-paid' | 'immature' | 'not-in-chain' | 'not-ours' | 'not-paid-yet' | 'needs-review';
export interface PayoutResult {
    blockHash: string;
    status: PayoutStatus;
    height?: number;
    confirmations?: number;
    /** The owner address the block pays. */
    ownerAddress?: string;
    /** What the block paid the owner. */
    rewardSats?: bigint;
    /** The visitor's share of it. */
    payoutSats?: bigint;
    txid?: string;
    feeSats?: bigint;
    error?: string;
}
/** `value` as a bigint percent; throws unless it is a whole number from 1 to 100. */
export declare function checkSharePercent(value: number | bigint): bigint;
/**
 * Pays `address` its share of each block it found, at most once per block.
 * Every block is rebuilt from the recorded raw share fields (never from a stored
 * hash) and must be in the best chain with enough confirmations, with the
 * rebuilt coinbase, paying the owner address of its record's receive index
 * (derived from the words, never taken from the record). The payout spends
 * from that address. Returns one result per block candidate.
 */
export declare function verifyPayout(address: string, options: PayoutOptions): Promise<PayoutResult[]>;
/** verifyPayout for every visitor with a recorded block (e.g. from a scheduled job). */
export declare function payoutAll(options: PayoutOptions): Promise<Record<string, PayoutResult[]>>;
