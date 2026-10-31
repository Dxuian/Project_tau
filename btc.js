// The site's API in one place.
//
//   Library (cpuminer-opt-js), generic mechanisms that take every value as a parameter:
//     mining:   mineBTC, DEFAULT_POOL
//     wallets:  createWallet, walletFromMnemonic, isValidAddress, addressScript
//     payments: payout, buildPayment, esplora, bitcoinCore
//     proofs:   rebuildBlockHeader, verifyBlock, memoryStores
//   App (this repo), your policy, storage and deployment:
//     loadConfig / DEFAULTS, createPayoutService, fileStores, d1Stores,
//     startNodeServer / startPayoutBridge (Node target; worker.js is the Cloudflare one),
//     verifyPayout(address): the library engine with your config, stores and key.
export { DEFAULT_POOL, mineBTC } from './cpuminer-opt-js/dist/index.js';
export { addressScript, bitcoinCore, buildPayment, createWallet, esplora, isValidAddress, payout, walletFromMnemonic } from './cpuminer-opt-js/dist/wallet.js';
export { memoryStores, payoutAll, rebuildBlockHeader, verifyBlock } from './cpuminer-opt-js/dist/payouts.js';
export { DEFAULTS, loadConfig, validateConfig } from './app/config.js';
export { chainFromConfig, createPayoutService, poolTarget, toJson } from './app/service.js';
export { fileStores } from './app/stores/file.js';
export { d1Stores } from './app/stores/d1.js';
export { startNodeServer, startPayoutBridge, storesFromConfig } from './app/node.js';

import { loadConfig } from './app/config.js';
import { chainFromConfig, createPayoutService } from './app/service.js';
import { storesFromConfig } from './app/node.js';

/**
 * Server side (Node): pays `address` its share of every block it provably found
 * through the payout bridge, once per block, using the config from the
 * environment (TAU_*, OWNER_MNEMONIC). `options` may override config values or
 * supply { stores, chain, ownerMnemonic }.
 */
export async function verifyPayout(address, { stores, chain, ownerMnemonic = process.env.OWNER_MNEMONIC, ...overrides } = {}) {
  const config = loadConfig(process.env, overrides);
  const { shares, ledger } = stores ?? storesFromConfig(config);
  const service = createPayoutService(config, { shares, ledger, chain: chain ?? chainFromConfig(config.chain), ownerMnemonic });
  return service.verifyPayout(address);
}
