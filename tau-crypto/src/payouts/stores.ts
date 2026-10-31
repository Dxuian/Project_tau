// What the payout engine needs from storage, and an in-memory reference
// implementation. Applications provide real ones (files, a database...).
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
  /** What the connection was logged in to the pool as: the owner address its blocks pay. Older records lack it. */
  poolUser?: string;
  /** That address's receive index in the owner wallet; older records mean 0. */
  ownerIndex?: number;
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
export function memoryStores(): { shares: ShareStore & { records: ShareRecord[] }; ledger: PayoutLedger & { entries: Map<string, PayoutEntry> } } {
  const records: ShareRecord[] = [];
  const entries = new Map<string, PayoutEntry>();
  const claimed = new Map<string, string>(); // coin -> block
  const shares = {
    records,
    async add(r: ShareRecord) {
      records.push(structuredClone(r));
    },
    async addResult() {},
    async blocksFor(visitor: string) {
      return records.filter((r) => r.isBlock && r.visitor === visitor).map((r) => structuredClone(r));
    },
    async claimants(blockHash: string) {
      return [...new Set(records.filter((r) => r.isBlock && r.blockHash === blockHash).map((r) => r.visitor))];
    },
    async visitorsWithBlocks() {
      return [...new Set(records.filter((r) => r.isBlock).map((r) => r.visitor))];
    },
  };
  const ledger = {
    entries,
    async get(blockHash: string) {
      const e = entries.get(blockHash);
      return e ? structuredClone(e) : null;
    },
    async reserve(entry: PayoutEntry): Promise<ReserveResult> {
      if (entries.has(entry.blockHash)) return 'block-taken';
      if (entry.inputs.some((i) => claimed.has(i))) return 'inputs-taken';
      entries.set(entry.blockHash, { ...structuredClone(entry), status: 'pending' });
      for (const i of entry.inputs) claimed.set(i, entry.blockHash);
      return 'reserved';
    },
    async markSent(blockHash: string, txid: string) {
      const e = entries.get(blockHash);
      if (!e || e.txid !== txid) throw new Error(`no pending payout ${txid} for ${blockHash}`);
      e.status = 'sent';
      e.sentTime = new Date().toISOString();
    },
    async usedInputs() {
      return new Set(claimed.keys());
    },
    async void(blockHash: string) {
      const e = entries.get(blockHash);
      if (!e || e.status !== 'pending') return false;
      entries.delete(blockHash);
      for (const i of e.inputs) claimed.delete(i);
      return true;
    },
  };
  return { shares, ledger };
}
