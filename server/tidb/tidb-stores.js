// TiDB Cloud storage (MySQL-compatible), for either target, through Drizzle.
// reserve() is one transaction: the payout row (primary key block_hash) and one
// row per input coin (primary key outpoint) go in together or not at all, so
// separate Workers or processes can never pay one block twice or spend one coin
// in two payouts.
//
// The tables are ./schema.js, created and changed only by the migrations
// (npm run db:migrate). `db` is a Drizzle MySQL database: tidbDatabase() in
// production (./client.js, TiDB Cloud over HTTPS), drizzle-orm/mysql2 against
// a local TiDB in the tests.
import { and, eq, lt, notInArray } from 'drizzle-orm';
import { payoutInputs, payouts, shareResults, shares as shareRows } from './schema.js';

/** Rows per DELETE when purging, so a large purge stays within TiDB's transaction limits. */
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
/** Rows an insert, update or delete changed: TiDB Cloud's driver says rowsAffected, mysql2 (the tests) [{ affectedRows }]. */
const affected = (result) => {
  const head = Array.isArray(result) ? result[0] : result;
  return Number(head?.rowsAffected ?? head?.affectedRows ?? 0);
};
/** The driver's error (Drizzle wraps it in a "Failed query" error). */
const driverMessage = (err) => String(err?.cause?.message ?? err?.message ?? err);
const isDuplicate = (err) => (err?.cause?.errno ?? err?.errno) === 1062 || /Duplicate entry/i.test(driverMessage(err));

export function tidbStores(db) {
  if (typeof db?.select !== 'function' || typeof db?.transaction !== 'function') throw new Error('tidbStores needs a Drizzle MySQL database (tidbDatabase(url))');

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
        await db.transaction(async (tx) => {
          await tx.insert(payouts).values({
            blockHash: e.blockHash,
            visitor: e.visitor,
            status: 'pending',
            rewardSats: e.rewardSats,
            amountSats: e.amountSats,
            txid: e.txid,
            inputs: JSON.stringify(e.inputs),
            time: e.time,
          });
          if (e.inputs.length) await tx.insert(payoutInputs).values(e.inputs.map((outpoint) => ({ outpoint, blockHash: e.blockHash })));
        });
        return 'reserved';
      } catch (err) {
        if (!isDuplicate(err)) throw err;
        // The transaction rolled back: was it the block that was taken, or one of its coins?
        if (/payout_inputs/.test(driverMessage(err))) return 'inputs-taken';
        return (await ledger.get(e.blockHash)) ? 'block-taken' : 'inputs-taken';
      }
    },
    async markSent(blockHash, txid) {
      const result = await db
        .update(payouts)
        .set({ status: 'sent', sentTime: new Date().toISOString() })
        .where(and(pendingPayout(blockHash), eq(payouts.txid, txid)));
      if (affected(result) !== 1) throw new Error(`no pending payout ${txid} for ${blockHash}`);
    },
    async usedInputs() {
      return new Set((await db.select({ outpoint: payoutInputs.outpoint }).from(payoutInputs)).map((row) => row.outpoint));
    },
    async void(blockHash) {
      return db.transaction(async (tx) => {
        const pending = await tx.select({ blockHash: payouts.blockHash }).from(payouts).where(pendingPayout(blockHash)).for('update');
        if (pending.length !== 1) return false;
        await tx.delete(payoutInputs).where(eq(payoutInputs.blockHash, blockHash));
        await tx.delete(payouts).where(pendingPayout(blockHash));
        return true;
      });
    },
  };

  /**
   * Drops ordinary (non-block) shares, and the pool's verdicts on them, recorded
   * before `before` (an ISO time). Block shares and payouts always stay.
   * Returns how many records went.
   */
  async function purge(before) {
    const blockShares = db.select({ id: shareRows.id }).from(shareRows).where(eq(shareRows.isBlock, true));
    let removed = 0;
    for (const batch of [
      () => db.delete(shareResults).where(and(lt(shareResults.time, before), notInArray(shareResults.share, blockShares))).limit(PURGE_BATCH),
      () => db.delete(shareRows).where(and(eq(shareRows.isBlock, false), lt(shareRows.time, before))).limit(PURGE_BATCH),
    ]) {
      for (let n = PURGE_BATCH; n === PURGE_BATCH; ) {
        n = affected(await batch());
        removed += n;
      }
    }
    return removed;
  }

  return { shares, ledger, purge };
}
