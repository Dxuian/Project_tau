import { type Miner, type MinerOptions } from './miner.ts';
import type { NetworkName } from './wallet/keys.ts';
export declare const DEFAULT_POOL = "stratum+tcp://solo.ckpool.org:3333";
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
export declare function mineBTC(address: string, url: string, options?: MineOptions): Promise<Miner>;
