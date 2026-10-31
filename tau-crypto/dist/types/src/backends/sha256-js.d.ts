import type { FoundSolution, ScanJob } from '../types.ts';
export declare const SHA256_IV: Uint32Array;
export declare const SHA256_K: Uint32Array;
/** Most solutions one scan call returns (as upstream's CMO_MAX_SOLUTIONS). */
export declare const MAX_SOLUTIONS = 64;
export declare function bswap32(x: number): number;
/**
 * One SHA-256 compression: out = state + rounds(state, block). Reads 16
 * words of `block` (big-endian message words); `out` may alias either input.
 */
export declare function sha256Compress(state: ArrayLike<number>, block: ArrayLike<number>, out?: Uint32Array): Uint32Array;
/** compress(IV, header words 0..15): the state after the first 64 header bytes. */
export declare function sha256Midstate(data: ArrayLike<number>, out?: Uint32Array): Uint32Array;
/** Nonce-independent values of one work, as in sha256_4x32_prehash_3rounds. */
export interface Sha256Prehash {
    /** State after header words 0..15. */
    midstate: Uint32Array;
    /**
     * Block-1 working variables a..h at the start of round 4, without the nonce:
     * a scanner adds the nonce (W3) to a and e to complete round 3.
     */
    state4: Uint32Array;
    /**
     * Message schedule terms X0..X6: W16 = X0, W17 = X1, W18 = X2 + s0(nonce),
     * W19 = X3 + nonce, and the parts X4 / X5 / X6 of W30 / W31 / W32.
     */
    x: Uint32Array;
}
export declare function sha256Prehash(data: ArrayLike<number>): Sha256Prehash;
/** SHA-256 passes over the header: sha256d 2, sha256t 3, sha256q 4. */
export declare function sha256Passes(algo: string): 2 | 3 | 4;
/**
 * Final hash of `passes` nested SHA-256s over the 80-byte header of `data`
 * with nonce `nonce`, as 8 little-endian words (cpuminer's hash format).
 * Pass the work's midstate to skip hashing the first 64 bytes again.
 */
export declare function sha256HashNonce(data: ArrayLike<number>, nonce: number, passes: number, out?: Uint32Array, midstate?: ArrayLike<number>): Uint32Array;
/** cpuminer-opt valid_hash: hash <= target as 256-bit little-endian integers. */
export declare function validHash(hash: ArrayLike<number>, target: ArrayLike<number>): boolean;
/**
 * cpuminer-opt hash_to_diff: 2^96 / H with H the upper 128 bits of the hash
 * (words 7..4). Computed exactly and rounded once, which is what upstream's
 * 128-bit long double arithmetic gives.
 */
export declare function shareDiff(hash: ArrayLike<number>): number;
/** Display form of a hash (block explorer order: digest bytes reversed). */
export declare function hashHex(hash: ArrayLike<number>): string;
/** Validates a scan job; throws a RangeError for unusable input. */
export declare function checkScanJob(job: ScanJob): void;
/** A solution record for nonce `nonce` of `job` with its (already valid) hash. */
export declare function makeSolution(job: ScanJob, nonce: number, hash: Uint32Array): FoundSolution;
