import type { AlgoSpec } from './types.ts';
export type AlgoStatus = 'ok' | 'node-only' | 'needs-params' | 'unsupported-upstream';
export interface AlgoInfo {
    name: string;
    /** cpuminer-opt enum algos value. */
    id: number;
    aliases: string[];
    status: AlgoStatus;
    notes?: string;
    /** Has hand-written kernels (js, node-crypto, wasm-sha256-*, webgpu). */
    sha256Family: boolean;
}
export declare function listAlgorithms(): AlgoInfo[];
export interface AlgoParams {
    /** --param-n (scrypt N, yespower N...). */
    n?: number;
    /** --param-r. */
    r?: number;
    /** --param-key. */
    key?: string;
}
/**
 * Resolves a name or alias exactly like cpuminer-opt's `-a` option
 * (cpu-miner.c parse_arg): aliases first, then a case-insensitive prefix match
 * against the names, accepting "name" or "name:N" (sets N).
 */
export declare function resolveAlgo(nameOrAlias: string, params?: AlgoParams): AlgoSpec;
export declare function algoInfo(name: string): AlgoInfo | undefined;
