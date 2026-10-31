import type { ChainClient } from '../wallet/chain.ts';
/** A stratum job's fields as mining.notify sends them (hex). */
export interface JobFields {
    /** Word-swapped, as in mining.notify. */
    prevhash: string;
    coinb1: string;
    coinb2: string;
    merkle: string[];
    version: string;
    nbits: string;
}
/** A job plus the share's own fields. */
export interface ShareFields extends JobFields {
    xn1: string;
    xn2: string;
    ntime: string;
    nonce: string;
}
export interface RebuiltBlock {
    header: string;
    /** Display (big-endian) hash. */
    blockHash: string;
    coinbase: string;
    coinbaseTxid: string;
    /** The hash meets the block's own target (nbits). */
    isBlock: boolean;
}
/** Block target from compact nbits (hex); 0n if invalid or negative. */
export declare function nbitsTarget(nbits: string): bigint;
/** Rebuilds and hashes the block header a share describes. Throws on malformed fields. */
export declare function rebuildBlockHeader(f: ShareFields): RebuiltBlock;
/** Outputs of a coinbase transaction (non-witness serialization, as stratum sends it). */
export declare function coinbaseOutputs(coinbaseHex: string): {
    value: bigint;
    script: string;
}[];
/** Satoshis that `outputs` pay to `scriptHex`. */
export declare function paidTo(outputs: {
    value: bigint;
    script: string;
}[], scriptHex: string): bigint;
export type BlockCheck = {
    status: 'verified';
    height: number;
    confirmations: number;
    rewardSats: bigint;
} | {
    status: 'not-in-chain';
} | {
    status: 'immature';
    height: number;
    confirmations: number;
} | {
    status: 'not-ours';
    height: number;
    error: string;
};
/**
 * Checks a rebuilt block against the chain: in the best chain, at least
 * `minConfirmations` deep, its coinbase is exactly the rebuilt one, and it pays
 * `payToScript`. Read-only.
 */
export declare function verifyBlock(block: RebuiltBlock, { chain, payToScript, minConfirmations }: {
    chain: ChainClient;
    payToScript: string;
    minConfirmations?: number;
}): Promise<BlockCheck>;
