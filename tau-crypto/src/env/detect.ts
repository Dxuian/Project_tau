// Runtime and capability detection. CPU feature flags (AVX2, SHA-NI...) are
// not observable from WebAssembly, so this reports what the environment can
// run; the autotuner then measures which backend is actually fastest.
import type { Capabilities, GpuInfo, RuntimeName } from '../types.ts';

type AnyGlobal = typeof globalThis & Record<string, any>;
const g = globalThis as AnyGlobal;

// (module (func (result v128) i32.const 0 i8x16.splat i8x16.popcnt))
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);
// (module (func (result v128) i32.const 1 i8x16.splat i32.const 2 i8x16.splat i8x16.relaxed_swizzle))
const RELAXED_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15,
  253, 128, 2, 11,
]);
const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

export function detectRuntime(): RuntimeName {
  if (typeof g.Deno !== 'undefined') return 'deno';
  if (typeof g.Bun !== 'undefined') return 'bun';
  if (typeof g.process?.versions?.node === 'string') return 'node';
  if (typeof g.document !== 'undefined') return 'browser';
  if (typeof g.importScripts === 'function' || typeof g.WorkerGlobalScope !== 'undefined') return 'worker';
  return 'unknown';
}

/** Imports a Node built-in without letting browser bundlers see it. */
export async function nodeBuiltin<T = any>(name: string): Promise<T> {
  const specifier = `node:${name}`;
  return (await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)) as T;
}

function wasmAvailable(): boolean {
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.Module !== 'function') return false;
  try {
    // Compiling (not just validating) is what a CSP without wasm-unsafe-eval blocks.
    new WebAssembly.Module(EMPTY_MODULE);
    return true;
  } catch {
    return false;
  }
}

function validates(bytes: Uint8Array<ArrayBuffer>): boolean {
  try {
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

async function nodeCores(): Promise<number> {
  const os = await nodeBuiltin('os');
  return typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
}

async function nodeMemory(): Promise<number> {
  const os = await nodeBuiltin('os');
  const total = os.totalmem() as number;
  const limit = typeof g.process?.constrainedMemory === 'function' ? Number(g.process.constrainedMemory()) : 0;
  return limit > 0 && limit < total ? limit : total;
}

async function webWorkersWork(): Promise<boolean> {
  if (typeof g.Worker !== 'function' || typeof g.Blob !== 'function' || typeof g.URL?.createObjectURL !== 'function') {
    return false;
  }
  // A CSP worker-src rule can still block Blob workers; try one.
  let url = '';
  try {
    url = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
    const worker = new g.Worker(url);
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      worker.onmessage = () => (clearTimeout(timer), resolve(true));
      worker.onerror = () => (clearTimeout(timer), resolve(false));
    });
    worker.terminate();
    return ok;
  } catch {
    return false;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

async function gpuInfo(): Promise<GpuInfo | null> {
  const gpu = g.navigator?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    // adapter.info (current spec), or the older requestAdapterInfo().
    const legacy = adapter as { requestAdapterInfo?: () => Promise<GPUAdapterInfo> };
    const info = adapter.info ?? (typeof legacy.requestAdapterInfo === 'function' ? await legacy.requestAdapterInfo() : {});
    return {
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      description: info.description ?? '',
      maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    };
  } catch {
    return null;
  }
}

export interface DetectOptions {
  /** Probe WebGPU (requests an adapter). Default true. */
  gpu?: boolean;
}

export async function detect(options: DetectOptions = {}): Promise<Capabilities> {
  const runtime = detectRuntime();
  const isNode = runtime === 'node';
  const wasm = wasmAvailable();

  let cores = 1;
  let memoryBytes: number | null = null;
  let workers = false;
  let nodeCrypto = false;

  if (isNode) {
    cores = await nodeCores();
    memoryBytes = await nodeMemory();
    try {
      workers = typeof (await nodeBuiltin('worker_threads')).Worker === 'function';
    } catch {
      workers = false;
    }
    try {
      nodeCrypto = typeof (await nodeBuiltin('crypto')).createHash === 'function';
    } catch {
      nodeCrypto = false;
    }
  } else {
    cores = Math.max(1, Number(g.navigator?.hardwareConcurrency) || 1);
    // navigator.deviceMemory: Chromium only, in GiB, capped at 8.
    const gb = Number((g.navigator as { deviceMemory?: number } | undefined)?.deviceMemory);
    memoryBytes = gb > 0 ? gb * 2 ** 30 : null;
    workers = await webWorkersWork();
  }

  return {
    runtime,
    cores,
    memoryBytes,
    wasm: {
      available: wasm,
      simd128: wasm && validates(SIMD_PROBE),
      relaxedSimd: wasm && validates(RELAXED_SIMD_PROBE),
    },
    workers,
    webgpu: options.gpu === false ? null : await gpuInfo(),
    nodeCrypto,
    crossOriginIsolated: g.crossOriginIsolated === true,
  };
}
