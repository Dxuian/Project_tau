import { type AlgoParams } from './algos.ts';
/**
 * Hashes a block header with cpuminer-opt's implementation of `algo` and
 * returns the 32-byte digest in cpuminer's byte order (reverse it for the
 * block-explorer display form). The nonce is header bytes 76..79.
 */
export declare function hash(algo: string, header: Uint8Array, params?: AlgoParams): Promise<Uint8Array>;
