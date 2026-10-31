// The D1 tables, as a Drizzle SQLite schema (the same tables as
// ../tidb/schema.js). To change them, edit this file, run
// `server/dev db generate <name>` (drizzle-kit writes the next migration into
// ./migrations; commit it) and apply it with `wrangler d1 migrations apply`
// before deploying (see wrangler.toml). Never edit an applied migration.
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Every share a visitor submitted, as the auditor recorded it (`record`, JSON). */
export const shares = sqliteTable(
  'shares',
  {
    id: text('id').primaryKey(),
    visitor: text('visitor').notNull(),
    blockHash: text('block_hash').notNull(),
    isBlock: integer('is_block', { mode: 'boolean' }).notNull(),
    time: text('time').notNull(),
    record: text('record').notNull(),
  },
  (t) => [index('shares_blocks').on(t.isBlock, t.visitor), index('shares_block_hash').on(t.blockHash), index('shares_time').on(t.time)],
);

/** The pool's verdict on each share. */
export const shareResults = sqliteTable(
  'share_results',
  {
    share: text('share').notNull(),
    time: text('time').notNull(),
    accepted: integer('accepted', { mode: 'boolean' }).notNull(),
    error: text('error'),
  },
  (t) => [index('share_results_time').on(t.time)],
);

/** A payout per block: the primary key is what makes each block pay once. */
export const payouts = sqliteTable(
  'payouts',
  {
    blockHash: text('block_hash').primaryKey(),
    visitor: text('visitor').notNull(),
    status: text('status', { enum: ['pending', 'sent'] }).notNull(),
    rewardSats: text('reward_sats').notNull(),
    amountSats: text('amount_sats').notNull(),
    txid: text('txid').notNull(),
    inputs: text('inputs').notNull(),
    time: text('time').notNull(),
    sentTime: text('sent_time'),
  },
  (t) => [check('payouts_status', sql`${t.status} IN ('pending', 'sent')`)],
);

/** The coins each payout spends: the primary key keeps a coin out of two payouts. */
export const payoutInputs = sqliteTable(
  'payout_inputs',
  {
    outpoint: text('outpoint').primaryKey(),
    blockHash: text('block_hash').notNull(),
  },
  (t) => [index('payout_inputs_block').on(t.blockHash)],
);
