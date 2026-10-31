-- D1 schema for the Cloudflare target (worker.js also creates it on first use).
-- Apply ahead of time with: npx wrangler d1 execute tau-payouts --remote --file cloudflare/schema.sql -c cloudflare/wrangler.toml (from server/)
CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, visitor TEXT NOT NULL, block_hash TEXT NOT NULL, is_block INTEGER NOT NULL, time TEXT NOT NULL, record TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS shares_blocks ON shares (is_block, visitor);
CREATE INDEX IF NOT EXISTS shares_block_hash ON shares (block_hash);
CREATE TABLE IF NOT EXISTS share_results (share TEXT NOT NULL, time TEXT NOT NULL, accepted INTEGER NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS payouts (block_hash TEXT PRIMARY KEY, visitor TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'sent')), reward_sats TEXT NOT NULL, amount_sats TEXT NOT NULL, txid TEXT NOT NULL, inputs TEXT NOT NULL, time TEXT NOT NULL, sent_time TEXT);
CREATE TABLE IF NOT EXISTS payout_inputs (outpoint TEXT PRIMARY KEY, block_hash TEXT NOT NULL);
