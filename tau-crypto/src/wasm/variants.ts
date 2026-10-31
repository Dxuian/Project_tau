// The compiled cpuminer-opt variants, embedded as gzip+base64 in lazily
// imported modules (only the variants actually used are downloaded/parsed).
import type { WasmVariant } from '../types.ts';
import { BUILT_VARIANTS, loaders } from './variants/index.ts';

export { BUILT_VARIANTS };

const modules = new Map<WasmVariant, Promise<WebAssembly.Module>>();

function fromBase64(s: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (native) return native(s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is not available in this environment');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Raw .wasm bytes of a variant. */
export async function variantBytes(variant: WasmVariant): Promise<Uint8Array> {
  const load = loaders[variant];
  if (!load) throw new Error(`WASM variant ${variant} was not built`);
  const mod = await load();
  const bytes = await gunzip(fromBase64(mod.gzipBase64));
  if (bytes.length !== mod.size) throw new Error(`corrupt embedded WASM (${variant})`);
  return bytes;
}

/** Compiles a variant once; the Module is posted to workers as-is. */
export function compileVariant(variant: WasmVariant): Promise<WebAssembly.Module> {
  let m = modules.get(variant);
  if (!m) {
    m = variantBytes(variant).then((b) => WebAssembly.compile(b as BufferSource));
    m.catch(() => modules.delete(variant));
    modules.set(variant, m);
  }
  return m;
}
