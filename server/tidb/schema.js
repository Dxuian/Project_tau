// The TiDB tables, as a Drizzle MySQL schema. To change them, edit this file,
// run `server/dev db generate <name>` (drizzle-kit writes the next migration
// into ./migrations; commit it) and apply it with `npm run db:migrate` before
// deploying (./migrate.js). Never edit an applied migration.
import { boolean, index, mysqlEnum, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';

/** Every share a visitor submitted, as the auditor recorded it (`record`, JSON). */
export const shares = mysqlTable(
  'shares',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    visitor: varchar('visitor', { length: 128 }).notNull(),
    blockHash: varchar('block_hash', { length: 64 }).notNull(),
    isBlock: boolean('is_block').notNull(),
    time: varchar('time', { length: 32 }).notNull(),
    record: text('record').notNull(),
  },
  (t) => [index('shares_blocks').on(t.isBlock, t.visitor), index('shares_block_hash').on(t.blockHash), index('shares_time').on(t.time)],
);

/** The pool's verdict on each share. */
export const shareResults = mysqlTable(
  'share_results',
  {
    share: varchar('share', { length: 128 }).notNull(),
    time: varchar('time', { length: 32 }).notNull(),
    accepted: boolean('accepted').notNull(),
    error: text('error'),
  },
  (t) => [index('share_results_time').on(t.time)],
);

/** A payout per block: the primary key is what makes each block pay once. */
export const payouts = mysqlTable('payouts', {
  blockHash: varchar('block_hash', { length: 64 }).primaryKey(),
  visitor: varchar('visitor', { length: 128 }).notNull(),
  status: mysqlEnum('status', ['pending', 'sent']).notNull(),
  rewardSats: varchar('reward_sats', { length: 32 }).notNull(),
  amountSats: varchar('amount_sats', { length: 32 }).notNull(),
  txid: varchar('txid', { length: 64 }).notNull(),
  inputs: text('inputs').notNull(),
  time: varchar('time', { length: 32 }).notNull(),
  sentTime: varchar('sent_time', { length: 32 }),
});

/** The coins each payout spends: the primary key keeps a coin out of two payouts. */
export const payoutInputs = mysqlTable(
  'payout_inputs',
  {
    outpoint: varchar('outpoint', { length: 80 }).primaryKey(),
    blockHash: varchar('block_hash', { length: 64 }).notNull(),
  },
  (t) => [index('payout_inputs_block').on(t.blockHash)],
);
