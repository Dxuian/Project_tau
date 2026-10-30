import type { WasmVariant } from '../types.ts';
import { BUILT_VARIANTS } from './variants/index.ts';
export { BUILT_VARIANTS };
/** Raw .wasm bytes of a variant. */
export declare function variantBytes(variant: WasmVariant): Promise<Uint8Array>;
/** Compiles a variant once; the Module is posted to workers as-is. */
export declare function compileVariant(variant: WasmVariant): Promise<WebAssembly.Module>;
