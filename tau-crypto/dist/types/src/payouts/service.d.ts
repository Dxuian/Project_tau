import type { BridgeConnection, BridgeInterceptor } from '../bridge/core.ts';
import type { ChainClient } from '../wallet/chain.ts';
import { type NetworkName } from '../wallet/keys.ts';
import { type PayoutResult } from './engine.ts';
import type { PayoutLedger, ShareStore } from './stores.ts';
export interface PayoutServiceOptions {
    /** The address the pool pays: every visitor is logged in to the pool as this address. */
    ownerAddress: string;
    /**
     * The owner wallet's words; they must give `ownerAddress` as their first
     * address. Without them shares are recorded but nothing is paid.
     */
    ownerMnemonic?: string;
    /** The finder's share of the owner's block reward, whole percent 1..100. */
    sharePercent: number | bigint;
    network?: NetworkName;
    shares: ShareStore;
    ledger: PayoutLedger;
    /** Confirms blocks and sends payments; required with `ownerMnemonic`. */
    chain?: ChainClient;
    /** At least 100 (coinbase maturity); default 100. */
    minConfirmations?: number;
    feeRate?: number;
    maxFeeRate?: number;
    /** The auditor's limit per connection (default 50). */
    maxSharesPer10s?: number;
    log?: (line: string) => void;
}
export interface PayoutService {
    ownerAddress: string;
    network: NetworkName;
    /** Whether it has the owner's words, so verifyPayout and payoutAll can pay. */
    canPay: boolean;
    /** The bridge interceptor (createFetchBridge or createBridge `intercept`). */
    intercept: (connection: BridgeConnection) => BridgeInterceptor;
    /** Pays `address` its share of each block it found, once (see verifyPayout in the engine). */
    verifyPayout(address: string): Promise<PayoutResult[]>;
    /** verifyPayout for every visitor with a recorded block. */
    payoutAll(): Promise<Record<string, PayoutResult[]>>;
}
export declare function createPayoutService(options: PayoutServiceOptions): PayoutService;
