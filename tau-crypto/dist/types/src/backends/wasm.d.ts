import type { BackendName } from '../types.ts';
/** Expected size of verthash.dat. */
export declare const VERTHASH_SIZE = 1283457024;
/** Which compiled variant a WASM backend runs on (the sha256 kernels use sse41). */
export declare function variantFor(backend: BackendName): 'sse41' | 'sse42' | 'avx2' | null;
