// Browser side of webgpu.test.ts (bundled with esbuild): runs the webgpu
// kernel in the page and computes in-page references with crypto.subtle.
// Exposed as window.webgpuTests; results are plain JSON for page.evaluate.
import { createWebGpuKernel, type WebGpuKernelOptions, type WebGpuSha256Kernel } from '../../src/backends/webgpu.ts';
import type { FoundSolution, KernelSetup, ScanOutcome } from '../../src/types.ts';

export interface PlainSolution {
  seq: number;
  nonce: number;
  data: number[];
  hash: number[];
  shareDiff: number;
}

export interface PlainOutcome {
  hashesDone: number;
  solutions: PlainSolution[];
  ms: number;
}

const setup = (name: string): KernelSetup => ({
  backend: 'webgpu',
  algo: { name, id: 0, paramN: 0, paramR: 0, key: null },
});

const passes = (algo: string): number => ({ sha256d: 2, sha256t: 3, sha256q: 4 })[algo] ?? 0;

// Pipelines are slow to build on SwiftShader: one kernel per algo + options.
const kernels = new Map<string, Promise<WebGpuSha256Kernel>>();
function kernel(algo: string, options: WebGpuKernelOptions = {}): Promise<WebGpuSha256Kernel> {
  const key = `${algo} ${JSON.stringify(options)}`;
  let k = kernels.get(key);
  if (!k) {
    k = createWebGpuKernel(setup(algo), options);
    kernels.set(key, k);
  }
  return k;
}

function workData(words: number[]): Uint32Array {
  const d = new Uint32Array(48);
  d.set(words.slice(0, 20));
  d[20] = 0x80000000;
  d[31] = 0x280;
  return d;
}

const plainSolution = (s: FoundSolution): PlainSolution => ({
  seq: s.seq,
  nonce: s.data[19],
  data: Array.from(s.data),
  hash: Array.from(s.hash),
  shareDiff: s.shareDiff,
});

const plain = (o: ScanOutcome, ms: number): PlainOutcome => ({
  hashesDone: o.hashesDone,
  solutions: o.solutions.map(plainSolution),
  ms,
});

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const api = {
  async adapter(): Promise<Record<string, unknown>> {
    const gpu = navigator.gpu;
    if (!gpu) return { error: 'navigator.gpu is missing' };
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { error: 'requestAdapter() returned null' };
    const info = adapter.info;
    return {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      isFallbackAdapter: (info as { isFallbackAdapter?: boolean }).isFallbackAdapter ?? null,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
      userAgent: navigator.userAgent,
    };
  },

  async scan(
    algo: string,
    words: number[],
    target: number[],
    start: number,
    end: number,
    options: WebGpuKernelOptions = {},
  ): Promise<PlainOutcome> {
    const k = await kernel(algo, options);
    const t0 = performance.now();
    const out = await k.scan({ seq: 7, data: workData(words), target: Uint32Array.from(target), start, end });
    return plain(out, performance.now() - t0);
  },

  async kernelInfo(algo: string, options: WebGpuKernelOptions = {}): Promise<Record<string, unknown>> {
    const k = await kernel(algo, options);
    return { granularity: k.granularity, memoryBytes: k.memoryBytes(), adapterInfo: k.adapterInfo, stats: { ...k.stats } };
  },

  /** Final hashes (LE words) of `nonces` via crypto.subtle, nested passes(algo) times. */
  async subtleHashes(algo: string, words: number[], nonces: number[]): Promise<number[][]> {
    const header = new Uint8Array(80);
    const view = new DataView(header.buffer);
    for (let i = 0; i < 19; i++) view.setUint32(i * 4, words[i]);
    const out: number[][] = [];
    for (const n of nonces) {
      view.setUint32(76, n);
      let digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', header);
      for (let p = 1; p < passes(algo); p++) digest = await crypto.subtle.digest('SHA-256', digest);
      const d = new DataView(digest);
      out.push(Array.from({ length: 8 }, (_, i) => d.getUint32(i * 4, true)));
    }
    return out;
  },

  /** Scans after the kernel's own device was destroyed; returns the error message. */
  async afterDeviceLoss(): Promise<string> {
    const k = await createWebGpuKernel(setup('sha256d'));
    k.device.destroy();
    await k.device.lost;
    try {
      await k.scan({ seq: 1, data: workData(new Array(20).fill(1)), target: new Uint32Array(8), start: 0, end: 1024 });
      return 'resolved';
    } catch (err) {
      return message(err);
    } finally {
      k.dispose();
    }
  },

  /** Destroys the device while a dispatch is running; returns the error message. */
  async lossDuringScan(): Promise<string> {
    const k = await createWebGpuKernel(setup('sha256d'));
    const pending = k.scan({ seq: 1, data: workData(new Array(20).fill(2)), target: new Uint32Array(8), start: 0, end: 1 << 25 });
    // Destroy right after the first submission, while the GPU works on it.
    for (let i = 0; i < 1000 && k.stats.submissions === 0; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    const inFlight = k.stats.submissions > 0;
    k.device.destroy();
    try {
      await pending;
      return 'resolved';
    } catch (err) {
      return `${inFlight ? 'in flight: ' : 'not submitted yet: '}${message(err)}`;
    } finally {
      k.dispose();
    }
  },

  /** Two scans on one kernel without waiting for the first (they must queue up). */
  async scanPair(algo: string, a: number[], b: number[], target: number[], start: number, end: number): Promise<PlainOutcome[]> {
    const k = await kernel(algo);
    const t = Uint32Array.from(target);
    const outs = await Promise.all([
      k.scan({ seq: 7, data: workData(a), target: t, start, end }),
      k.scan({ seq: 7, data: workData(b), target: t, start, end }),
    ]);
    return outs.map((o) => plain(o, 0));
  },

  async afterDispose(): Promise<string> {
    const k = await createWebGpuKernel(setup('sha256d'));
    k.dispose();
    try {
      await k.scan({ seq: 1, data: workData(new Array(20).fill(3)), target: new Uint32Array(8), start: 0, end: 64 });
      return 'resolved';
    } catch (err) {
      return message(err);
    }
  },

  async createError(algo: string, options: WebGpuKernelOptions): Promise<string> {
    try {
      const k = await createWebGpuKernel(setup(algo), options);
      k.dispose();
      return 'resolved';
    } catch (err) {
      return message(err);
    }
  },
};

export type WebGpuTestApi = typeof api;
(globalThis as unknown as { webgpuTests: WebGpuTestApi }).webgpuTests = api;
