// mineBTC: sha256d mining for an address, through a payout bridge or straight to a pool.
import { createMiner, type Miner, type MinerOptions } from './miner.ts';
import type { NetworkName } from './wallet/keys.ts';

export const DEFAULT_POOL = 'stratum+tcp://solo.ckpool.org:3333';

export interface MineOptions extends Partial<Omit<MinerOptions, 'algo' | 'url' | 'user' | 'bridge'>> {
  /** With a bridge URL: the pool the bridge allows (default solo.ckpool.org:3333). */
  pool?: string;
  /** Network the address must belong to (default mainnet). */
  network?: NetworkName;
}

/**
 * Starts sha256d mining for `address` and returns the running Miner.
 * `url` ws:// or wss://: a bridge (e.g. a payout bridge, which may log in to the
 * pool with another address); stratum+tcp:// or stratum+ssl://: that pool
 * directly (Node only). Nothing starts until this is called.
 */
export async function mineBTC(address: string, url: string, options: MineOptions = {}): Promise<Miner> {
  const { pool = DEFAULT_POOL, network = 'mainnet', ...minerOptions } = options;
  // Loaded on demand so plain mining doesn't carry the wallet code.
  const { addressScript } = await import('./wallet/keys.ts');
  addressScript(address, network);
  if (typeof url !== 'string') throw new Error('url is required');
  const viaBridge = /^wss?:\/\//i.test(url);
  if (!viaBridge && !/^stratum\+/i.test(url)) {
    throw new Error('url must be a bridge (ws:// or wss://) or a pool (stratum+tcp:// or stratum+ssl://)');
  }
  const miner = await createMiner({
    pass: 'x',
    ...minerOptions,
    algo: 'sha256d',
    url: viaBridge ? pool : url,
    bridge: viaBridge ? url : undefined,
    user: address,
  });
  await miner.start();
  return miner;
}
