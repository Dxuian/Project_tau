// src/env/detect.ts
var g = globalThis;
var SIMD_PROBE = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  5,
  1,
  96,
  0,
  1,
  123,
  3,
  2,
  1,
  0,
  10,
  10,
  1,
  8,
  0,
  65,
  0,
  253,
  15,
  253,
  98,
  11
]);
var RELAXED_SIMD_PROBE = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  5,
  1,
  96,
  0,
  1,
  123,
  3,
  2,
  1,
  0,
  10,
  15,
  1,
  13,
  0,
  65,
  1,
  253,
  15,
  65,
  2,
  253,
  15,
  253,
  128,
  2,
  11
]);
var EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
function detectRuntime() {
  if (typeof g.Deno !== "undefined") return "deno";
  if (typeof g.Bun !== "undefined") return "bun";
  if (typeof g.process?.versions?.node === "string") return "node";
  if (typeof g.document !== "undefined") return "browser";
  if (typeof g.importScripts === "function" || typeof g.WorkerGlobalScope !== "undefined") return "worker";
  return "unknown";
}
async function nodeBuiltin(name) {
  const specifier = `node:${name}`;
  return await import(
    /* @vite-ignore */
    /* webpackIgnore: true */
    specifier
  );
}
function wasmAvailable() {
  if (typeof WebAssembly !== "object" || typeof WebAssembly.Module !== "function") return false;
  try {
    new WebAssembly.Module(EMPTY_MODULE);
    return true;
  } catch {
    return false;
  }
}
function validates(bytes) {
  try {
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}
async function nodeCores() {
  const os = await nodeBuiltin("os");
  return typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
}
async function nodeMemory() {
  const os = await nodeBuiltin("os");
  const total = os.totalmem();
  const limit = typeof g.process?.constrainedMemory === "function" ? Number(g.process.constrainedMemory()) : 0;
  return limit > 0 && limit < total ? limit : total;
}
async function webWorkersWork() {
  if (typeof g.Worker !== "function" || typeof g.Blob !== "function" || typeof g.URL?.createObjectURL !== "function") {
    return false;
  }
  let url = "";
  try {
    url = URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" }));
    const worker = new g.Worker(url);
    const ok = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 2e3);
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
async function gpuInfo() {
  const gpu = g.navigator?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") return null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const legacy = adapter;
    const info = adapter.info ?? (typeof legacy.requestAdapterInfo === "function" ? await legacy.requestAdapterInfo() : {});
    return {
      vendor: info.vendor ?? "",
      architecture: info.architecture ?? "",
      description: info.description ?? "",
      maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
    };
  } catch {
    return null;
  }
}
async function detect(options = {}) {
  const runtime = detectRuntime();
  const isNode = runtime === "node";
  const wasm = wasmAvailable();
  let cores = 1;
  let memoryBytes = null;
  let workers = false;
  let nodeCrypto = false;
  if (isNode) {
    cores = await nodeCores();
    memoryBytes = await nodeMemory();
    try {
      workers = typeof (await nodeBuiltin("worker_threads")).Worker === "function";
    } catch {
      workers = false;
    }
    try {
      nodeCrypto = typeof (await nodeBuiltin("crypto")).createHash === "function";
    } catch {
      nodeCrypto = false;
    }
  } else {
    cores = Math.max(1, Number(g.navigator?.hardwareConcurrency) || 1);
    const gb = Number(g.navigator?.deviceMemory);
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
      relaxedSimd: wasm && validates(RELAXED_SIMD_PROBE)
    },
    workers,
    webgpu: options.gpu === false ? null : await gpuInfo(),
    nodeCrypto,
    crossOriginIsolated: g.crossOriginIsolated === true
  };
}

export {
  detectRuntime,
  nodeBuiltin,
  detect
};
