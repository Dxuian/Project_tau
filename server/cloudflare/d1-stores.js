// Cloudflare D1 storage, through Drizzle. reserve() is one D1 batch (a
// transaction): the payout row (primary key block_hash) and one row per input
// coin (primary key outpoint) go in together or not at all, so concurrent
// Workers can never pay one block twice or spend one coin in two payouts.
//
// The tables are ./schema.js, created and changed only by the migrations in
// ./migrations (wrangler d1 migrations apply; the tests apply the same files).
import { and, eq, exists, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { payoutInputs, payouts, shareResults, shares as shareRows } from './schema.js';

/** Rows per DELETE when purging. */
const PURGE_BATCH = 5000;

const toEntry = (row) => ({
  blockHash: row.blockHash,
  visitor: row.visitor,
  status: row.status,
  rewardSats: row.rewardSats,
  amountSats: row.amountSats,
  txid: row.txid,
  inputs: JSON.parse(row.inputs),
  time: row.time,
  ...(row.sentTime ? { sentTime: row.sentTime } : {}),
});
/** D1's error (Drizzle wraps single queries in a "Failed query" error). */
const driverMessage = (err) => String(err?.cause?.message ?? err?.message ?? err);

export function d1Stores(binding) {
  if (!binding?.prepare) throw new Error('d1Stores needs a D1 database binding');
  const db = drizzle(binding);

  const shares = {
    async add(r) {
      await db.insert(shareRows).values({ id: r.id, visitor: r.visitor, blockHash: r.blockHash, isBlock: Boolean(r.isBlock), time: r.time, record: JSON.stringify(r) });
    },
    async addResult(r) {
      await db.insert(shareResults).values({ share: r.share, time: r.time, accepted: Boolean(r.accepted), error: r.error === null ? null : JSON.stringify(r.error) });
    },
    async blocksFor(visitor) {
      const rows = await db
        .select({ record: shareRows.record })
        .from(shareRows)
        .where(and(eq(shareRows.isBlock, true), eq(shareRows.visitor, visitor)));
      return rows.map((row) => JSON.parse(row.record));
    },
    async claimants(blockHash) {
      const rows = await db
        .selectDistinct({ visitor: shareRows.visitor })
        .from(shareRows)
        .where(and(eq(shareRows.isBlock, true), eq(shareRows.blockHash, blockHash)));
      return rows.map((row) => row.visitor);
    },
    async visitorsWithBlocks() {
      return (await db.selectDistinct({ visitor: shareRows.visitor }).from(shareRows).where(eq(shareRows.isBlock, true))).map((row) => row.visitor);
    },
  };

  const pendingPayout = (blockHash) => and(eq(payouts.blockHash, blockHash), eq(payouts.status, 'pending'));

  const ledger = {
    async get(blockHash) {
      const [row] = await db.select().from(payouts).where(eq(payouts.blockHash, blockHash));
      return row ? toEntry(row) : null;
    },
    async reserve(e) {
      try {
        await db.batch([
          db.insert(payouts).values({
            blockHash: e.blockHash,
            visitor: e.visitor,
            status: 'pending',
            rewardSats: e.rewardSats,
            amountSats: e.amountSats,
            txid: e.txid,
            inputs: JSON.stringify(e.inputs),
            time: e.time,
          }),
          // One statement per coin: D1 caps the parameters of a single statement.
          ...e.inputs.map((outpoint) => db.insert(payoutInputs).values({ outpoint, blockHash: e.blockHash })),
        ]);
        return 'reserved';
      } catch (err) {
        const message = driverMessage(err);
        if (message.includes('payouts.block_hash')) return 'block-taken';
        if (message.includes('payout_inputs.outpoint')) return 'inputs-taken';
        throw err;
      }
    },
    async markSent(blockHash, txid) {
      const result = await db
        .update(payouts)
        .set({ status: 'sent', sentTime: new Date().toISOString() })
        .where(and(pendingPayout(blockHash), eq(payouts.txid, txid)));
      if (result.meta.changes !== 1) throw new Error(`no pending payout ${txid} for ${blockHash}`);
    },
    async usedInputs() {
      return new Set((await db.select({ outpoint: payoutInputs.outpoint }).from(payoutInputs)).map((row) => row.outpoint));
    },
    async void(blockHash) {
      // One batch: the coins go only if their payout is still pending, then the payout.
      const [, deleted] = await db.batch([
        db.delete(payoutInputs).where(and(eq(payoutInputs.blockHash, blockHash), exists(db.select({ one: sql`1` }).from(payouts).where(pendingPayout(blockHash))))),
        db.delete(payouts).where(pendingPayout(blockHash)),
      ]);
      return deleted.meta.changes === 1;
    },
  };

  /**
   * Drops ordinary (non-block) shares, and the pool's verdicts on them, recorded
   * before `before` (an ISO time). Block shares and payouts always stay.
   * Returns how many records went.
   */
  async function purge(before) {
    const blockShares = db.select({ id: shareRows.id }).from(shareRows).where(eq(shareRows.isBlock, true));
    // D1 has no DELETE ... LIMIT: each batch deletes the rows a limited SELECT names.
    const oldResults = () =>
      db
        .select({ rowid: sql`rowid` })
        .from(shareResults)
        .where(and(lt(shareResults.time, before), notInArray(shareResults.share, blockShares)))
        .limit(PURGE_BATCH);
    const oldShares = () =>
      db
        .select({ id: shareRows.id })
        .from(shareRows)
        .where(and(eq(shareRows.isBlock, false), lt(shareRows.time, before)))
        .limit(PURGE_BATCH);
    let removed = 0;
    for (const batch of [() => db.delete(shareResults).where(inArray(sql`rowid`, oldResults())), () => db.delete(shareRows).where(inArray(shareRows.id, oldShares()))]) {
      for (let n = PURGE_BATCH; n === PURGE_BATCH; ) {
        n = (await batch()).meta.changes;
        removed += n;
      }
    }
    return removed;
  }

  return { shares, ledger, purge };
}
