// Cloudflare D1 storage. reserve() is one D1 batch (a transaction): the payout
// row (primary key block_hash) and one row per input coin (primary key
// outpoint) go in together or not at all, so concurrent Workers can never pay
// one block twice or spend one coin in two payouts.
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, visitor TEXT NOT NULL, block_hash TEXT NOT NULL, is_block INTEGER NOT NULL, time TEXT NOT NULL, record TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS shares_blocks ON shares (is_block, visitor)',
  'CREATE INDEX IF NOT EXISTS shares_block_hash ON shares (block_hash)',
  'CREATE TABLE IF NOT EXISTS share_results (share TEXT NOT NULL, time TEXT NOT NULL, accepted INTEGER NOT NULL, error TEXT)',
  "CREATE TABLE IF NOT EXISTS payouts (block_hash TEXT PRIMARY KEY, visitor TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'sent')), reward_sats TEXT NOT NULL, amount_sats TEXT NOT NULL, txid TEXT NOT NULL, inputs TEXT NOT NULL, time TEXT NOT NULL, sent_time TEXT)",
  'CREATE TABLE IF NOT EXISTS payout_inputs (outpoint TEXT PRIMARY KEY, block_hash TEXT NOT NULL)',
];

const toEntry = (row) =>
  row && {
    blockHash: row.block_hash,
    visitor: row.visitor,
    status: row.status,
    rewardSats: row.reward_sats,
    amountSats: row.amount_sats,
    txid: row.txid,
    inputs: JSON.parse(row.inputs),
    time: row.time,
    ...(row.sent_time ? { sentTime: row.sent_time } : {}),
  };

export function d1Stores(db) {
  if (!db?.prepare) throw new Error('d1Stores needs a D1 database binding');
  let ready;
  const schema = () => (ready ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))));
  const all = async (sql, ...args) => {
    await schema();
    return (await db.prepare(sql).bind(...args).all()).results;
  };

  const shares = {
    async add(r) {
      await schema();
      await db
        .prepare('INSERT INTO shares (id, visitor, block_hash, is_block, time, record) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(r.id, r.visitor, r.blockHash, r.isBlock ? 1 : 0, r.time, JSON.stringify(r))
        .run();
    },
    async addResult(r) {
      await schema();
      await db.prepare('INSERT INTO share_results (share, time, accepted, error) VALUES (?, ?, ?, ?)').bind(r.share, r.time, r.accepted ? 1 : 0, r.error === null ? null : JSON.stringify(r.error)).run();
    },
    async blocksFor(visitor) {
      return (await all('SELECT record FROM shares WHERE is_block = 1 AND visitor = ?', visitor)).map((row) => JSON.parse(row.record));
    },
    async claimants(blockHash) {
      return (await all('SELECT DISTINCT visitor FROM shares WHERE is_block = 1 AND block_hash = ?', blockHash)).map((row) => row.visitor);
    },
    async visitorsWithBlocks() {
      return (await all('SELECT DISTINCT visitor FROM shares WHERE is_block = 1')).map((row) => row.visitor);
    },
  };

  const ledger = {
    async get(blockHash) {
      return toEntry((await all('SELECT * FROM payouts WHERE block_hash = ?', blockHash))[0]) ?? null;
    },
    async reserve(e) {
      await schema();
      try {
        await db.batch([
          db
            .prepare("INSERT INTO payouts (block_hash, visitor, status, reward_sats, amount_sats, txid, inputs, time) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)")
            .bind(e.blockHash, e.visitor, e.rewardSats, e.amountSats, e.txid, JSON.stringify(e.inputs), e.time),
          ...e.inputs.map((outpoint) => db.prepare('INSERT INTO payout_inputs (outpoint, block_hash) VALUES (?, ?)').bind(outpoint, e.blockHash)),
        ]);
        return 'reserved';
      } catch (err) {
        const message = String(err?.message ?? err);
        if (message.includes('payouts.block_hash')) return 'block-taken';
        if (message.includes('payout_inputs.outpoint')) return 'inputs-taken';
        throw err;
      }
    },
    async markSent(blockHash, txid) {
      await schema();
      const r = await db.prepare("UPDATE payouts SET status = 'sent', sent_time = ? WHERE block_hash = ? AND txid = ? AND status = 'pending'").bind(new Date().toISOString(), blockHash, txid).run();
      if (r.meta.changes !== 1) throw new Error(`no pending payout ${txid} for ${blockHash}`);
    },
    async usedInputs() {
      return new Set((await all('SELECT outpoint FROM payout_inputs')).map((row) => row.outpoint));
    },
    async void(blockHash) {
      await schema();
      const [, deleted] = await db.batch([
        db.prepare("DELETE FROM payout_inputs WHERE block_hash = ? AND EXISTS (SELECT 1 FROM payouts WHERE block_hash = ? AND status = 'pending')").bind(blockHash, blockHash),
        db.prepare("DELETE FROM payouts WHERE block_hash = ? AND status = 'pending'").bind(blockHash),
      ]);
      return deleted.meta.changes === 1;
    },
  };
  return { shares, ledger, ensureSchema: schema };
}
