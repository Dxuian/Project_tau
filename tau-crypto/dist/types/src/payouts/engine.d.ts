import type { ChainClient } from '../wallet/chain.ts';
import { type NetworkName } from '../wallet/keys.ts';
import type { PayoutLedger, ShareStore } from './stores.ts';
export interface PayoutOptions {
    shares: ShareStore;
    ledger: PayoutLedger;
    chain: ChainClient;
    /** Words of the wallet blocks pay (the bridge's pool user); it signs the payouts. */
    ownerMnemonic: string;
    /** The visitor's share of the owner's block reward, whole percent 1..100. */
    sharePercent: number | bigint;
    network?: NetworkName;
    /** At least 100 (coinbase maturity). */
    minConfirmations?: number;
    feeRate?: number;
    maxFeeRate?: number;
}
export type PayoutStatus = 'paid' | 'already-paid' | 'immature' | 'not-in-chain' | 'not-ours' | 'not-paid-yet' | 'needs-review';
export interface PayoutResult {
    blockHash: string;
    status: PayoutStatus;
    height?: number;
    confirmations?: number;
    /** What the block paid the owner. */
    rewardSats?: bigint;
    /** The visitor's share of it. */
    payoutSats?: bigint;
    txid?: string;
    feeSats?: bigint;
    error?: string;
}
/**
 * Pays `address` its share of each block it found, at most once per block.
 * Every block is rebuilt from the recorded raw share fields (never from a stored
 * hash) and must be in the best chain with enough confirmations, with the
 * rebuilt coinbase, paying the owner. Returns one result per block candidate.
 */
export declare function verifyPayout(address: string, options: PayoutOptions): Promise<PayoutResult[]>;
/** verifyPayout for every visitor with a recorded block (e.g. from a scheduled job). */
export declare function payoutAll(options: PayoutOptions): Promise<Record<string, PayoutResult[]>>;
