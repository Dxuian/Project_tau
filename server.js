#!/usr/bin/env node
// Node target: node server.js, configured by TAU_* environment variables and
// OWNER_MNEMONIC (see README). Serves the payout bridge and POST /payout.
import { loadConfig } from './app/config.js';
import { startNodeServer } from './app/node.js';

const log = (line) => console.error(`${new Date().toISOString()} ${line}`);
const config = loadConfig(process.env, { target: 'node' });
const server = await startNodeServer(config, { log });
log(`payout bridge on port ${server.port} for ${config.pool}, paying ${config.clientSharePercent}% of blocks found to their finders`);
if (!process.env.OWNER_MNEMONIC) log('OWNER_MNEMONIC is not set: shares are recorded, payouts are disabled');
const stop = () => server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
