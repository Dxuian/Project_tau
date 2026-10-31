// The payout engine: pays a visitor their share of every block they provably
// found, exactly once. All policy comes in as parameters (who pays, what share,
// where records live); the library stores nothing itself.
import type { ChainClient } from '../wallet/chain.ts';
import { addressScript, MAX_INDEX, walletKeys, type DerivedKey, type NetworkName } from '../wallet/keys.ts';
import { buildPayment, type Payment } from '../wallet/payment.ts';
import { rebuildBlockHeader, verifyBlock, type RebuiltBlock } from './block.ts';
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

const COINBASE_MATURITY = 100;

// Calls sharing a ledger run one at a time in this process (the ledger's
// reserve() covers other processes).
const queues = new WeakMap<object, Promise<unknown>>();
function serialized<T>(key: object, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  queues.set(key, run.catch(() => {}));
  return run;
}

/** `value` as a bigint percent; throws unless it is a whole number from 1 to 100. */
export function checkSharePercent(value: number | bigint): bigint {
  const p = typeof value === 'bigint' ? value : Number.isInteger(value) ? BigInt(value) : -1n;
  if (p < 1n || p > 100n) throw new Error('sharePercent must be a whole number from 1 to 100');
  return p;
}

/**
 * Pays `address` its share of each block it found, at most once per block.
 * Every block is rebuilt from the recorded raw share fields (never from a stored
 * hash) and must be in the best chain with enough confirmations, with the
 * rebuilt coinbase, paying the owner address of its record's receive index
 * (derived from the words, never taken from the record). The payout spends
 * from that address. Returns one result per block candidate.
 */
export function verifyPayout(address: string, options: PayoutOptions): Promise<PayoutResult[]> {
  const network = options.network ?? 'mainnet';
  addressScript(address, network);
  const share = checkSharePercent(options.sharePercent);
  const minConfirmations = options.minConfirmations ?? COINBASE_MATURITY;
  if (minConfirmations < COINBASE_MATURITY) throw new Error(`minConfirmations must be at least ${COINBASE_MATURITY}`);
  if (!options.shares || !options.ledger || !options.chain) throw new Error('shares, ledger and chain are required');
  const keys = walletKeys(options.ownerMnemonic, network);
  return serialized(options.ledger, () => settle(address, { ...options, network, minConfirmations }, keys, share));
}

async function settle(
  address: string,
  options: PayoutOptions & { network: NetworkName; minConfirmations: number },
  keys: { key(index: number): DerivedKey },
  share: bigint,
): Promise<PayoutResult[]> {
  const { shares, ledger, chain } = options;
  const blocks = new Map<string, { rebuilt: RebuiltBlock; index: number; poolUser?: string }>();
  for (const r of await shares.blocksFor(address)) {
    if (r.visitor !== address || !r.job) continue;
    const index = r.ownerIndex ?? 0;
    if (!Number.isSafeInteger(index) || index < 0 || index > MAX_INDEX) continue;
    let rebuilt: RebuiltBlock;
    try {
      rebuilt = rebuildBlockHeader({ ...r.job, xn1: r.xn1, xn2: r.xn2, ntime: r.ntime, nonce: r.nonce });
    } catch {
      continue;
    }
    if (rebuilt.isBlock && rebuilt.blockHash === r.blockHash) blocks.set(rebuilt.blockHash, { rebuilt, index, poolUser: r.poolUser });
  }
  const owners = new Map<number, DerivedKey>();
  const ownerAt = (index: number) => {
    let key = owners.get(index);
    if (!key) owners.set(index, (key = keys.key(index)));
    return key;
  };

  const results: PayoutResult[] = [];
  for (const [blockHash, { rebuilt, index, poolUser }] of blocks) {
    const prior = await ledger.get(blockHash);
    if (prior) {
      results.push(
        prior.status === 'sent'
          ? { blockHash, status: 'already-paid', txid: prior.txid, payoutSats: BigInt(prior.amountSats) }
          : { blockHash, status: 'needs-review', txid: prior.txid, error: 'a payout was started but not confirmed as sent' },
      );
      continue;
    }
    if ((await shares.claimants(blockHash)).length > 1) {
      results.push({ blockHash, status: 'needs-review', error: 'more than one visitor recorded for this block' });
      continue;
    }
    const owner = ownerAt(index);
    if (poolUser !== undefined && poolUser !== owner.address) {
      results.push({ blockHash, status: 'not-ours', error: `the recorded pool login is not the owner wallet's address ${index}` });
      continue;
    }
    const check = await verifyBlock(rebuilt, { chain, payToScript: owner.script, minConfirmations: options.minConfirmations });
    if (check.status !== 'verified') {
      results.push({ blockHash, ownerAddress: owner.address, ...check });
      continue;
    }
    const base = { blockHash, ownerAddress: owner.address, height: check.height, confirmations: check.confirmations, rewardSats: check.rewardSats };
    const payoutSats = (check.rewardSats * share) / 100n;
    results.push(await pay(address, payoutSats, base, index, options));
  }
  return results;
}

async function pay(
  address: string,
  payoutSats: bigint,
  base: { blockHash: string; ownerAddress: string; height: number; confirmations: number; rewardSats: bigint },
  fromIndex: number,
  options: PayoutOptions & { network: NetworkName },
): Promise<PayoutResult> {
  const { ledger, chain } = options;
  const entry = { ...base, payoutSats };
  // Build (deterministically) and reserve; if a concurrent payout took our coins, pick others.
  let built: Payment | undefined;
  for (let attempt = 0; attempt < 3 && !built; attempt++) {
    let candidate: Payment;
    try {
      candidate = await buildPayment(address, payoutSats, {
        mnemonic: options.ownerMnemonic,
        chain,
        network: options.network,
        feeRate: options.feeRate,
        maxFeeRate: options.maxFeeRate,
        exclude: await ledger.usedInputs(),
        // The block's own reward pays the visitor; the rest goes to the change address.
        from: [fromIndex],
        changeIndex: options.changeIndex ?? 0,
      });
    } catch (err) {
      return { ...entry, status: 'not-paid-yet', error: (err as Error).message };
    }
    const reserved = await ledger.reserve({
      blockHash: base.blockHash,
      visitor: address,
      status: 'pending',
      rewardSats: String(base.rewardSats),
      amountSats: String(payoutSats),
      txid: candidate.txid,
      inputs: candidate.inputs,
      time: new Date().toISOString(),
    });
    if (reserved === 'reserved') built = candidate;
    else if (reserved === 'block-taken') {
      const now = await ledger.get(base.blockHash);
      return now?.status === 'sent'
        ? { ...entry, status: 'already-paid', txid: now.txid }
        : { ...entry, status: 'needs-review', txid: now?.txid, error: 'another payout run is paying this block' };
    }
  }
  if (!built) return { ...entry, status: 'not-paid-yet', error: 'coins kept being claimed by concurrent payouts' };
  // Reserved (pending) before broadcasting: a crash or an unclear broadcast can never pay twice.
  try {
    const txid = await chain.broadcast(built.hex);
    if (txid !== built.txid) throw new Error(`broadcast returned ${txid}`);
  } catch (err) {
    return { ...entry, status: 'needs-review', txid: built.txid, error: (err as Error).message };
  }
  await ledger.markSent(base.blockHash, built.txid);
  return { ...entry, status: 'paid', txid: built.txid, feeSats: built.feeSats };
}

/** verifyPayout for every visitor with a recorded block (e.g. from a scheduled job). */
export async function payoutAll(options: PayoutOptions): Promise<Record<string, PayoutResult[]>> {
  const out: Record<string, PayoutResult[]> = {};
  for (const visitor of await options.shares.visitorsWithBlocks()) {
    try {
      out[visitor] = await verifyPayout(visitor, options);
    } catch (err) {
      out[visitor] = [{ blockHash: '', status: 'needs-review', error: (err as Error).message }];
    }
  }
  return out;
}
