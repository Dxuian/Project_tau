import type { JobFields } from './block.ts';
/** One share as the bridge's auditor recorded it. */
export interface ShareRecord {
    type: 'share';
    v: 1;
    id: string;
    time: string;
    conn: number;
    peer: string;
    /** The payout address the visitor's connection authorized with. */
    visitor: string;
    jobId: string;
    job: JobFields;
    xn1: string;
    xn2: string;
    ntime: string;
    nonce: string;
    difficulty: number | null;
    blockHash: string;
    isBlock: boolean;
    /** Satoshis the job's coinbase pays the pool user, if it could be parsed. */
    ownerSats: string | null;
}
/** The pool's verdict on a recorded share. */
export interface ShareResult {
    type: 'result';
    v: 1;
    share: string;
    time: string;
    accepted: boolean;
    error: unknown;
}
export interface ShareStore {
    add(record: ShareRecord): Promise<void>;
    addResult?(result: ShareResult): Promise<void>;
    /** Shares recorded for `visitor` that are blocks (isBlock). */
    blocksFor(visitor: string): Promise<ShareRecord[]>;
    /** Distinct visitors with a block share of this hash. */
    claimants(blockHash: string): Promise<string[]>;
    /** Distinct visitors with any block share. */
    visitorsWithBlocks(): Promise<string[]>;
}
export interface PayoutEntry {
    blockHash: string;
    visitor: string;
    status: 'pending' | 'sent';
    rewardSats: string;
    amountSats: string;
    txid: string;
    /** Coins the payment spends ("txid:vout"). */
    inputs: string[];
    time: string;
    sentTime?: string;
}
export type ReserveResult = 'reserved' | 'block-taken' | 'inputs-taken';
export interface PayoutLedger {
    get(blockHash: string): Promise<PayoutEntry | null>;
    /**
     * Atomically records a pending payout and claims its input coins: at most one
     * payout per block and per coin, even across processes.
     */
    reserve(entry: PayoutEntry): Promise<ReserveResult>;
    markSent(blockHash: string, txid: string): Promise<void>;
    /** Coins claimed by pending or sent payouts. */
    usedInputs(): Promise<Set<string>>;
    /**
     * Operator action: forget a pending payout (after checking its txid never
     * reached the chain) and release its coins. Returns false if there was none.
     */
    void(blockHash: string): Promise<boolean>;
}
/** In-memory stores (tests, examples, single short-lived processes). */
export declare function memoryStores(): {
    shares: ShareStore & {
        records: ShareRecord[];
    };
    ledger: PayoutLedger & {
        entries: Map<string, PayoutEntry>;
    };
};
