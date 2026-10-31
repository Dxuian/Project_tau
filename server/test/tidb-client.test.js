// tidb/client.js and tidb/migrate.js, the TiDB Cloud glue, with the HTTPS
// driver faked (the real one talks to TiDB Cloud). The stores and the
// migrations themselves run against a local TiDB in stores.test.js; this
// checks which connections are made, what the migrate step sends, refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { tidbDatabase } from '../tidb/client.js';
import { MIGRATIONS, migrateTidb } from '../tidb/migrate.js';

const URL_ = 'mysql://abc123.root:secret@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/sys';

/** A stand-in for @tidbcloud/serverless's connect: logs each statement as "<database>: <sql>". */
function fakeDriver({ applied = [] } = {}) {
  const configs = [];
  const log = [];
  const connect = (config) => {
    configs.push(config);
    const db = config.database ?? 'url';
    const execute = async (query, _params, options) => {
      log.push(`${db}: ${query.replace(/\s+/g, ' ').trim()}`);
      if (options?.fullResult) return { rows: [], rowsAffected: 0, lastInsertId: 0 };
      return /from `__drizzle_migrations`/.test(query) ? applied : [];
    };
    return {
      execute,
      async begin() {
        log.push(`${db}: BEGIN`);
        return { execute, commit: async () => log.push(`${db}: COMMIT`), rollback: async () => log.push(`${db}: ROLLBACK`) };
      },
    };
  };
  return { connect, configs, log };
}

test("the app's database: the connection string as given, the tables in a database of their own", async () => {
  const driver = fakeDriver();
  const db = tidbDatabase(URL_, { connect: driver.connect });
  assert.deepEqual(driver.configs, [{ url: URL_, database: 'tau' }]);
  await db.execute(sql`select 1`);
  assert.deepEqual(driver.log, ['tau: select 1']);
  tidbDatabase(URL_, { connect: driver.connect, database: 'payouts_db' });
  assert.equal(driver.configs[1].database, 'payouts_db');
});

test("db:migrate creates the app's database, then applies each migration once, recording it", async () => {
  const driver = fakeDriver();
  await migrateTidb(URL_, { connect: driver.connect });
  assert.equal(driver.log[0], 'url: CREATE DATABASE IF NOT EXISTS `tau`', 'with the string as given, before using the database');
  assert.match(driver.log[1], /^tau: create table if not exists `__drizzle_migrations`/);
  const tx = driver.log.slice(driver.log.indexOf('tau: BEGIN') + 1, driver.log.indexOf('tau: COMMIT'));
  const tables = tx.flatMap((s) => s.match(/^tau: CREATE TABLE `(\w+)`/)?.[1] ?? []);
  assert.deepEqual(tables, ['payout_inputs', 'payouts', 'share_results', 'shares']);
  assert.match(tx.at(-1), /^tau: insert into `__drizzle_migrations` \(`hash`, `created_at`\)/);

  // Already applied: nothing runs again.
  const { entries } = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
  const again = fakeDriver({ applied: [{ id: 1, hash: 'x', created_at: entries.at(-1).when }] });
  await migrateTidb(URL_, { connect: again.connect });
  assert.deepEqual(again.log.filter((s) => /CREATE TABLE|insert into/.test(s)), []);
});

test('refuses a missing or malformed connection string, and system schemas for the tables', async () => {
  const { connect, configs } = fakeDriver();
  assert.throws(() => tidbDatabase(undefined, { connect }), /DB_PASSWORD must be/);
  assert.throws(() => tidbDatabase('https://gateway01.example.com/sys', { connect }), /DB_PASSWORD must be/);
  await assert.rejects(migrateTidb('', { connect }), /DB_PASSWORD must be/);
  for (const database of ['sys', 'mysql', 'INFORMATION_SCHEMA', 'a-b', '']) {
    assert.throws(() => tidbDatabase(URL_, { connect, database }), /database must be a plain name of your own/);
    await assert.rejects(migrateTidb(URL_, { connect, database }), /database must be a plain name of your own/);
  }
  assert.deepEqual(configs, [], 'nothing connected');
});
