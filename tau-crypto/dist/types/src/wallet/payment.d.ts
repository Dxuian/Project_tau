import type { ChainClient } from './chain.ts';
import { type NetworkName } from './keys.ts';
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
/** Builds and signs a payment without broadcasting it. */
export declare function buildPayment(to: string, amountSats: bigint | number, options: PaymentOptions): Promise<Payment>;
/**
 * Sends `amountSats` to `to` from the wallet of `options.mnemonic` (which pays
 * the network fee). `broadcast: false` only builds and signs.
 */
export declare function payout(to: string, amountSats: bigint | number, options: PaymentOptions & {
    broadcast?: boolean;
}): Promise<Payment>;
