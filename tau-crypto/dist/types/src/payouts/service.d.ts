import type { BridgeConnection, BridgeInterceptor } from '../bridge/core.ts';
import type { ChainClient } from '../wallet/chain.ts';
import { type NetworkName } from '../wallet/keys.ts';
import { type PayoutResult } from './engine.ts';
import { type SlotOptions } from './slots.ts';
import type { PayoutLedger, ShareStore } from './stores.ts';
export interface PayoutServiceOptions {
    /** The owner wallet's first address (receive index 0): payout change goes here, and without `addressPeriod` every visitor mines to it. */
    ownerAddress: string;
    /**
     * The owner wallet's words; they must give `ownerAddress` as their first
     * address. Without them shares are recorded but nothing is paid.
     */
    ownerMnemonic?: string;
    /** The owner wallet's account public key (accountXpub): derives the pool logins without the words. */
    ownerXpub?: string;
    /** A fresh owner address per period: slot N (1 + periods since the epoch) is receive index N. */
    addressPeriod?: SlotOptions;
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
    /** Receive index payouts send their change to. Default 0, `ownerAddress`. */
    changeIndex?: number;
    /** The auditor's limit per connection (default 50). */
    maxSharesPer10s?: number;
    log?: (line: string) => void;
    /** The clock, in ms (tests). Default Date.now. */
    now?: () => number;
}
/** An owner address visitors mine to, and the time it's handed out for (null: always). */
export interface MiningAddress {
    address: string;
    index: number;
    from: string | null;
    until: string | null;
}
export interface PayoutService {
    ownerAddress: string;
    network: NetworkName;
    /** Whether it has the owner's words, so verifyPayout and payoutAll can pay. */
    canPay: boolean;
    /** The owner address visitors who connect at `time` mine to. */
    addressFor(time?: number): MiningAddress;
    /** The bridge interceptor (createFetchBridge or createBridge `intercept`). */
    intercept: (connection: BridgeConnection) => BridgeInterceptor;
    /** Pays `address` its share of each block it found, once (see verifyPayout in the engine). */
    verifyPayout(address: string): Promise<PayoutResult[]>;
    /** verifyPayout for every visitor with a recorded block. */
    payoutAll(): Promise<Record<string, PayoutResult[]>>;
}
export declare function createPayoutService(options: PayoutServiceOptions): PayoutService;
