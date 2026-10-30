// Fastest compiled variant per algorithm, measured with scripts/variant-prefs.mjs
// (V8, dev container, single thread). Lets quick-mode autotune load just one
// variant in browsers. Algorithms not listed default to sse41.
import type { WasmVariant } from '../types.ts';

export const VARIANT_PREFS: Record<string, WasmVariant> = {
  "allium": "avx2",
  "argon2d250": "avx2",
  "argon2d500": "avx2",
  "argon2d1000": "avx2",
  "argon2d16000": "avx2",
  "argon2d4096": "avx2",
  "blake": "avx2",
  "blake2b": "avx2",
  "blake2s": "avx2",
  "blakecoin": "avx2",
  "lbry": "avx2",
  "lyra2h": "avx2",
  "lyra2re": "avx2",
  "lyra2rev3": "avx2",
  "lyra2z": "avx2",
  "lyra2z330": "avx2",
  "phi2": "avx2",
  "sha256d": "avx2",
  "sha256dt": "avx2",
  "sha256q": "avx2",
  "sha256t": "avx2",
  "sha512256d": "avx2",
  "skein": "avx2",
  "vanilla": "avx2",
  "x13": "avx2"
};
