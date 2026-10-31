// TiDB Cloud through Drizzle, over HTTPS (PingCAP's serverless driver): it
// needs only fetch, so the same code runs in the Cloudflare Worker and on Node.
//
// The connection string is TiDB Cloud's mysql://user:password@host:4000/db
// (the driver talks HTTPS to the host; the port is ignored). The app's tables
// live in a database of its own (`database`, created by ./migrate.js), not in
// the one the string names, which is often a system schema such as `sys`.
import { connect as driverConnect } from '@tidbcloud/serverless';
import { drizzle } from 'drizzle-orm/tidb-serverless';

export const DEFAULT_DATABASE = 'tau';
const SYSTEM_SCHEMAS = new Set(['sys', 'mysql', 'information_schema', 'performance_schema', 'metrics_schema', 'lightning_task_info']);

/** Throws unless `url` looks like TiDB Cloud's connection string and `database` is a plain name of the app's own. */
export function checkTidbSettings(url, database) {
  if (!/^mysql:\/\/[^/@]+@[^/]+/.test(String(url ?? ''))) {
    throw new Error('DB_PASSWORD must be the mysql://user:password@host:4000/database string from TiDB Cloud');
  }
  if (!/^\w+$/.test(database) || SYSTEM_SCHEMAS.has(database.toLowerCase())) throw new Error(`the app's database must be a plain name of your own, not "${database}"`);
}

/**
 * The Drizzle database for tidbStores().
 * @param url        the connection string (the DB_PASSWORD secret)
 * @param database   where the app's tables live (default tau)
 * @param connect    the driver's connect (tests pass a fake)
 */
export function tidbDatabase(url, { database = DEFAULT_DATABASE, connect = driverConnect } = {}) {
  checkTidbSettings(url, database);
  return drizzle({ client: connect({ url, database }) });
}
