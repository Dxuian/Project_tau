import type { WasmVariant } from '../../types.ts';
export declare const BUILT_VARIANTS: WasmVariant[];
export declare const loaders: Partial<Record<WasmVariant, () => Promise<{
    gzipBase64: string;
    size: number;
}>>>;
