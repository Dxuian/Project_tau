// Backend 'webgpu': sha256d / sha256t / sha256q compute kernel, one nonce per
// invocation.
//
// The host precomputes per work what doesn't depend on the nonce (midstate,
// block-1 rounds 0..3 without the nonce, schedule terms X0..X6: sha256Prehash)
// and passes it in a uniform. The shader finishes block 1, runs the extra
// passes of sha256t / sha256q, then the final pass to round 60 only: its e
// is the final hash word 7, so most nonces stop there; on a tie with
// target[7], round 61 gives word 6. Survivors are appended to a storage
// buffer through an atomic counter, read back, and every one is re-hashed on
// the CPU (sha256-js) and checked with valid_hash before it is reported.
//
// A scan is split into dispatches of at most `dispatchNonces` nonces (2D grids
// past maxComputeWorkgroupsPerDimension), several per queue submission with a
// dynamic uniform offset each. A dispatch that finds more candidates than its
// buffer holds is scanned again in halves, so a scan always reports the first
// solutions in nonce order, like the CPU kernels.
//
// The WGSL is generated here at kernel creation (straight-line rounds with the
// constant message words and IV terms folded into literals), so the library
// needs no separate shader file.
import type { AlgoSpec, Capabilities, FoundSolution, Kernel, KernelSetup, ScanJob, ScanOutcome } from '../types.ts';
import { registerBackend, SHA256_FAMILY, type BackendFactory } from './registry.ts';
import {
  checkScanJob,
  makeSolution,
  MAX_SOLUTIONS,
  SHA256_IV,
  SHA256_K,
  sha256HashNonce,
  sha256Passes,
  sha256Prehash,
  validHash,
  type Sha256Prehash,
} from './sha256-js.ts';

/** Invocations per workgroup (one nonce each); tune per GPU. */
export const WORKGROUP_SIZE = 256;
/** Candidates one dispatch can report; more make it re-scan in halves. */
export const CANDIDATE_CAP = 64;
/** Nonces per dispatch. */
export const DISPATCH_NONCES = 1 << 24;
/** Dispatches per queue submission (one readback each). */
export const DISPATCHES_PER_SUBMIT = 16;

export interface WebGpuKernelOptions {
  /** Device to use instead of requesting one; it is not destroyed by dispose(). */
  device?: GPUDevice;
  workgroupSize?: number;
  dispatchNonces?: number;
  dispatchesPerSubmit?: number;
  candidateCap?: number;
  /** Lower cap on workgroups per grid dimension than the device's (tests). */
  maxWorkgroupsPerDimension?: number;
}

// WebGPU flag values, so this module loads where the globals don't exist.
const BUFFER_MAP_READ = 0x1;
const BUFFER_COPY_SRC = 0x4;
const BUFFER_COPY_DST = 0x8;
const BUFFER_UNIFORM = 0x40;
const BUFFER_STORAGE = 0x80;
const MAP_READ = 0x1;
const STAGE_COMPUTE = 0x4;

/** Uniform block per dispatch (WGSL Params): 32 words. */
const PARAM_WORDS = 32;

// ------------------------------------------------------------------- shader

type Sym = number | string; // a constant, or a WGSL identifier / expression

const isNum = (v: Sym): v is number => typeof v === 'number';
const hex = (v: number): string => `0x${(v >>> 0).toString(16).padStart(8, '0')}u`;
const lit = (v: Sym): string => (isNum(v) ? hex(v) : v);
const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;
const FOLD: Record<string, (x: number) => number> = {
  bsig0: (x) => (rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22)) >>> 0,
  bsig1: (x) => (rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25)) >>> 0,
  ssig0: (x) => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0,
  ssig1: (x) => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0,
};
const fn1 = (name: string, v: Sym): Sym => (isNum(v) ? FOLD[name](v) : `${name}(${v})`);
const ch = (e: Sym, f: Sym, g: Sym): Sym =>
  isNum(e) && isNum(f) && isNum(g) ? (g ^ (e & (f ^ g))) >>> 0 : `ch(${lit(e)}, ${lit(f)}, ${lit(g)})`;
const maj = (a: Sym, b: Sym, c: Sym): Sym =>
  isNum(a) && isNum(b) && isNum(c) ? ((a & b) | (c & (a | b))) >>> 0 : `maj(${lit(a)}, ${lit(b)}, ${lit(c)})`;

/** Sum with the constants folded (on the host: WGSL rejects overflowing constant expressions). */
function sum(terms: Sym[]): Sym {
  let c = 0;
  let at = -1;
  let vars = 0;
  const parts: string[] = [];
  for (const t of terms) {
    if (isNum(t)) {
      if (at < 0) {
        at = parts.length;
        parts.push('');
      }
      c = (c + t) >>> 0;
    } else {
      parts.push(t);
      vars++;
    }
  }
  if (!vars) return c;
  if (at >= 0) {
    if (c) parts[at] = hex(c);
    else parts.splice(at, 1);
  }
  return parts.join(' + ');
}

const LETTERS = 'abcdefgh';

/**
 * Emits SHA-256 rounds. Round r keeps working variable j (a = 0 .. h = 7) in
 * letter (j - r) mod 8, so a round assigns two variables; letters holding a
 * constant or a uniform value are substituted until first assigned. W[t] lives
 * in w(t mod 16) unless it is constant.
 */
class Rounds {
  readonly out: string[] = [];
  readonly w: Sym[] = [];
  private val = new Map<string, Sym>();
  private ind: string;

  constructor(indent: string) {
    this.ind = indent;
  }

  line(s: string): void {
    this.out.push(this.ind + s);
  }

  letter(j: number, r: number): string {
    return LETTERS[(j - r) & 7];
  }

  get(name: string): Sym {
    return this.val.get(name) ?? name;
  }

  private set(name: string, v: Sym): void {
    if (isNum(v)) {
      this.val.set(name, v);
      return;
    }
    this.val.delete(name);
    this.line(`${name} = ${v};`);
  }

  /** Starts at round r; a null value means its letter already holds it. */
  start(r: number, values: (Sym | null)[]): void {
    this.val.clear();
    values.forEach((v, j) => {
      if (v !== null) this.val.set(this.letter(j, r), v);
    });
  }

  round(r: number, eOnly = false): void {
    const v = (j: number): Sym => this.get(this.letter(j, r));
    const w = this.w[r];
    const kw = isNum(w) ? [(SHA256_K[r] + w) >>> 0] : [SHA256_K[r], w];
    const t1 = sum([v(7), ...kw, ch(v(4), v(5), v(6)), fn1('bsig1', v(4))]);
    let t: Sym = t1;
    if (!isNum(t1)) {
      this.line(`t = ${t1};`);
      t = 't';
    }
    this.set(this.letter(3, r), sum([v(3), t]));
    if (!eOnly) this.set(this.letter(7, r), sum([fn1('bsig0', v(0)), maj(v(0), v(1), v(2)), t]));
  }

  /** W[t] = s1(W[t-2]) + W[t-7] + s0(W[t-15]) + W[t-16], zero terms dropped. */
  expand(t: number): void {
    const W = this.w;
    this.assignW(t, sum([W[t - 16], W[t - 7], fn1('ssig0', W[t - 15]), fn1('ssig1', W[t - 2])]));
  }

  assignW(t: number, s: Sym): void {
    if (isNum(s)) {
      this.w[t] = s;
      return;
    }
    const name = `w${t & 15}`;
    this.line(`${name} = ${s};`);
    this.w[t] = name;
  }
}

/** Rounds over a 32-byte message in w0..w7 from the IV, up to (not including) round `last`. */
function pass32Rounds(g: Rounds, last: number, eOnlyFrom: number): void {
  g.start(0, Array.from(SHA256_IV));
  for (let i = 0; i < 8; i++) g.w[i] = `w${i}`;
  g.w[8] = 0x80000000;
  for (let i = 9; i < 15; i++) g.w[i] = 0;
  g.w[15] = 256;
  for (let r = 0; r < last; r++) {
    if (r >= 16) g.expand(r);
    g.round(r, r >= eOnlyFrom);
  }
}

const SHADER_HEAD = `struct Params {
  mid: array<vec4<u32>, 2>, // midstate
  st: array<vec4<u32>, 2>,  // block-1 a..h at round 4, without the nonce
  x: array<vec4<u32>, 2>,   // schedule terms X0..X6
  job: vec4<u32>,           // target[7], target[6], first nonce, nonce count
  grid: vec4<u32>,          // invocations per grid row, output slot
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> found: array<atomic<u32>>;

fn rotr(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }
fn bsig0(x: u32) -> u32 { return rotr(x, 2u) ^ rotr(x, 13u) ^ rotr(x, 22u); }
fn bsig1(x: u32) -> u32 { return rotr(x, 6u) ^ rotr(x, 11u) ^ rotr(x, 25u); }
fn ssig0(x: u32) -> u32 { return rotr(x, 7u) ^ rotr(x, 18u) ^ (x >> 3u); }
fn ssig1(x: u32) -> u32 { return rotr(x, 17u) ^ rotr(x, 19u) ^ (x >> 10u); }
fn ch(e: u32, f: u32, g: u32) -> u32 { return g ^ (e & (f ^ g)); }
fn maj(a: u32, b: u32, c: u32) -> u32 { return (a & b) | (c & (a | b)); }
fn bswap(x: u32) -> u32 { return (x << 24u) | ((x & 0xff00u) << 8u) | ((x >> 8u) & 0xff00u) | (x >> 24u); }
`;

const VARS = [
  'var a = 0u; var b = 0u; var c = 0u; var d = 0u; var e = 0u; var f = 0u; var g = 0u; var h = 0u; var t = 0u;',
  'var w8 = 0u; var w9 = 0u; var w10 = 0u; var w11 = 0u; var w12 = 0u; var w13 = 0u; var w14 = 0u; var w15 = 0u;',
];

/** WGSL for `passes` nested SHA-256s (2, 3 or 4) of the header with each invocation's nonce. */
export function shaderSource(passes: number, workgroupSize: number, cap: number): string {
  const L: string[] = [SHADER_HEAD];
  if (passes > 2) {
    // SHA-256 of a 32-byte message, for sha256t / sha256q's middle passes.
    const g = new Rounds('  ');
    pass32Rounds(g, 64, 64);
    L.push(
      'fn pass32(m: array<u32, 8>) -> array<u32, 8> {',
      '  var w0 = m[0]; var w1 = m[1]; var w2 = m[2]; var w3 = m[3]; var w4 = m[4]; var w5 = m[5]; var w6 = m[6]; var w7 = m[7];',
      ...VARS.map((v) => '  ' + v),
      ...g.out,
      `  return array<u32, 8>(${Array.from(SHA256_IV, (iv, j) => `${g.get(LETTERS[j])} + ${hex(iv)}`).join(', ')});`,
      '}',
      '',
    );
  }
  const g = new Rounds('  ');
  g.line('// Block 1: round 3 gets the nonce, then rounds 4..63.');
  g.line(`${g.letter(0, 4)} = p.st[0].x + nonce;`);
  g.line(`${g.letter(4, 4)} = p.st[1].x + nonce;`);
  g.start(4, [null, 'p.st[0].y', 'p.st[0].z', 'p.st[0].w', null, 'p.st[1].y', 'p.st[1].z', 'p.st[1].w']);
  const W = g.w;
  W[3] = 'w3';
  W[4] = 0x80000000;
  for (let i = 5; i < 15; i++) W[i] = 0;
  W[15] = 640;
  W[16] = 'x0';
  W[17] = 'x1';
  for (let r = 4; r < 18; r++) g.round(r);
  // W18..W32 from the precomputed terms (upstream sha256_4x32_final_rounds).
  const s0 = (v: string): Sym => fn1('ssig0', v);
  const s1 = (v: string): Sym => fn1('ssig1', v);
  const plan: [number, Sym[]][] = [
    [18, ['x2', s0('w3')]],
    [19, ['x3', 'w3']],
    [20, [0x80000000, s1('w2')]],
    [21, [s1('w3')]],
    [22, [640, s1('w4')]],
    [23, ['x0', s1('w5')]],
    [24, ['x1', s1('w6')]],
    [25, ['w2', s1('w7')]],
    [26, ['w3', s1('w8')]],
    [27, ['w4', s1('w9')]],
    [28, ['w5', s1('w10')]],
    [29, ['w6', s1('w11')]],
    [30, ['x4', 'w7', s1('w12')]],
    [31, ['x5', 'w8', s1('w13')]],
    [32, ['x6', 'w9', s1('w14')]],
  ];
  for (const [r, terms] of plan) {
    g.assignW(r, sum(terms));
    g.round(r);
  }
  for (let r = 33; r < 64; r++) {
    g.expand(r);
    g.round(r);
  }
  for (let j = 0; j < 8; j++) g.line(`w${j} = m${j} + ${g.get(LETTERS[j])};`);
  if (passes > 2) {
    g.line('var m = array<u32, 8>(w0, w1, w2, w3, w4, w5, w6, w7);');
    for (let i = 2; i < passes; i++) g.line('m = pass32(m);');
    g.line('w0 = m[0]; w1 = m[1]; w2 = m[2]; w3 = m[3]; w4 = m[4]; w5 = m[5]; w6 = m[6]; w7 = m[7];');
  }
  g.line('// Final pass to round 60 (58..60 only need e): its e is the final word 7.');
  pass32Rounds(g, 61, 58);
  const e60 = g.letter(3, 60);
  g.line(`let h7 = bswap(${e60} + ${hex(SHA256_IV[7])});`);
  g.line('if (h7 > p.job.x) {');
  g.line('  return;');
  g.line('}');
  g.line('if (h7 == p.job.x) {');
  const tie = new Rounds('    ');
  // Continue the same state: round 61's e is the final word 6.
  tie.w.push(...g.w);
  tie.expand(61);
  tie.round(61, true);
  g.out.push(...tie.out);
  g.line(`  if (bswap(${tie.letter(3, 61)} + ${hex(SHA256_IV[6])}) > p.job.y) {`);
  g.line('    return;');
  g.line('  }');
  g.line('}');
  g.line(`let slot = p.grid.y * ${cap + 1}u;`);
  g.line('let k = atomicAdd(&found[slot], 1u);');
  g.line(`if (k < ${cap}u) {`);
  g.line('  atomicStore(&found[slot + 1u + k], nonce);');
  g.line('}');
  L.push(
    `@compute @workgroup_size(${workgroupSize})`,
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {',
    '  let i = gid.y * p.grid.x + gid.x;',
    '  if (i >= p.job.w) {',
    '    return;',
    '  }',
    '  let nonce = p.job.z + i;',
    '  let m0 = p.mid[0].x; let m1 = p.mid[0].y; let m2 = p.mid[0].z; let m3 = p.mid[0].w;',
    '  let m4 = p.mid[1].x; let m5 = p.mid[1].y; let m6 = p.mid[1].z; let m7 = p.mid[1].w;',
    '  let x0 = p.x[0].x; let x1 = p.x[0].y; let x2 = p.x[0].z; let x3 = p.x[0].w;',
    '  let x4 = p.x[1].x; let x5 = p.x[1].y; let x6 = p.x[1].z;',
    '  var w0 = 0u; var w1 = 0u; var w2 = 0u; var w3 = nonce; var w4 = 0u; var w5 = 0u; var w6 = 0u; var w7 = 0u;',
    ...VARS.map((v) => '  ' + v),
    ...g.out,
    '}',
    '',
  );
  return L.join('\n');
}

// ------------------------------------------------------------------- kernel

interface DispatchResult {
  count: number;
  nonces: Uint32Array;
}

type Range = [lo: number, hi: number];

export class WebGpuSha256Kernel implements Kernel {
  readonly backend = 'webgpu' as const;
  readonly granularity: number;
  readonly device: GPUDevice;
  readonly adapterInfo: { vendor: string; architecture: string; description: string };
  /** Work done so far: queue submissions, dispatches, 2D-grid dispatches, overflow re-scans, candidates. */
  readonly stats = { submissions: 0, dispatches: 0, grids2d: 0, rescans: 0, candidates: 0 };
  private readonly passes: number;
  private readonly ownsDevice: boolean;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniform: GPUBuffer;
  private readonly found: GPUBuffer;
  private readonly readback: GPUBuffer;
  private readonly params: Uint32Array;
  private readonly slotWords: number;
  private readonly cap: number;
  private readonly dispatchNonces: number;
  private readonly perSubmit: number;
  private readonly maxGroups: number;
  private readonly hash = new Uint32Array(8);
  private tail: Promise<unknown> = Promise.resolve();
  private readonly lost: Promise<unknown>;
  private lostReason: string | null = null;
  private uncaptured: string | null = null;
  private disposed = false;

  private constructor(init: {
    passes: number;
    device: GPUDevice;
    ownsDevice: boolean;
    adapterInfo: WebGpuSha256Kernel['adapterInfo'];
    pipeline: GPUComputePipeline;
    layout: GPUBindGroupLayout;
    workgroupSize: number;
    cap: number;
    dispatchNonces: number;
    perSubmit: number;
    maxGroups: number;
  }) {
    const { device } = init;
    this.passes = init.passes;
    this.device = device;
    this.ownsDevice = init.ownsDevice;
    this.adapterInfo = init.adapterInfo;
    this.pipeline = init.pipeline;
    this.granularity = init.workgroupSize;
    this.cap = init.cap;
    this.dispatchNonces = init.dispatchNonces;
    this.perSubmit = init.perSubmit;
    this.maxGroups = init.maxGroups;
    this.slotWords = Math.max(256, device.limits.minUniformBufferOffsetAlignment) / 4;
    this.params = new Uint32Array(this.slotWords * this.perSubmit);
    const foundBytes = this.perSubmit * (this.cap + 1) * 4;
    this.uniform = device.createBuffer({ size: this.params.byteLength, usage: BUFFER_UNIFORM | BUFFER_COPY_DST });
    this.found = device.createBuffer({ size: foundBytes, usage: BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST });
    this.readback = device.createBuffer({ size: foundBytes, usage: BUFFER_MAP_READ | BUFFER_COPY_DST });
    this.bindGroup = device.createBindGroup({
      layout: init.layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniform, size: PARAM_WORDS * 4 } },
        { binding: 1, resource: { buffer: this.found } },
      ],
    });
    this.lost = device.lost.then((info) => {
      this.lostReason = info.message || info.reason || 'unknown reason';
    });
    device.addEventListener('uncapturederror', (ev) => {
      this.uncaptured = (ev as GPUUncapturedErrorEvent).error.message;
    });
  }

  static async create(setup: KernelSetup, options: WebGpuKernelOptions = {}): Promise<WebGpuSha256Kernel> {
    if (!SHA256_FAMILY.has(setup.algo.name)) throw new Error(`webgpu backend does not implement ${setup.algo.name}`);
    const passes = sha256Passes(setup.algo.name);
    let device = options.device;
    let info: Partial<GPUAdapterInfo> | undefined = (device as { adapterInfo?: GPUAdapterInfo } | undefined)?.adapterInfo;
    if (!device) {
      const gpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu;
      if (!gpu) throw new Error('WebGPU is not available (no navigator.gpu)');
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('WebGPU: no adapter available');
      info = adapter.info;
      device = await adapter.requestDevice();
    }
    const adapterInfo = { vendor: info?.vendor ?? '', architecture: info?.architecture ?? '', description: info?.description ?? '' };
    const ownsDevice = !options.device;
    let kernel: WebGpuSha256Kernel | undefined;
    let failure: unknown;
    device.pushErrorScope('validation');
    try {
      kernel = await WebGpuSha256Kernel.build(device, ownsDevice, adapterInfo, passes, setup.algo.name, options);
    } catch (err) {
      failure = err;
    }
    const scope = await device.popErrorScope();
    if (!failure && scope) failure = new Error(`WebGPU setup failed: ${scope.message}`);
    if (failure) {
      kernel?.dispose();
      if (ownsDevice && !kernel) device.destroy();
      throw failure;
    }
    return kernel!;
  }

  private static async build(
    device: GPUDevice,
    ownsDevice: boolean,
    adapterInfo: WebGpuSha256Kernel['adapterInfo'],
    passes: number,
    label: string,
    options: WebGpuKernelOptions,
  ): Promise<WebGpuSha256Kernel> {
    const limits = device.limits;
    const workgroupSize = options.workgroupSize ?? Math.min(WORKGROUP_SIZE, limits.maxComputeWorkgroupSizeX);
    if (workgroupSize > limits.maxComputeWorkgroupSizeX || workgroupSize > limits.maxComputeInvocationsPerWorkgroup) {
      throw new Error(`WebGPU: workgroup size ${workgroupSize} exceeds the device limits`);
    }
    const maxGroups = Math.min(options.maxWorkgroupsPerDimension ?? Infinity, limits.maxComputeWorkgroupsPerDimension);
    const cap = options.candidateCap ?? CANDIDATE_CAP;
    // At most 2^31 per dispatch keeps the u32 invocation index from wrapping.
    const dispatchNonces = Math.min(options.dispatchNonces ?? DISPATCH_NONCES, 2 ** 31, workgroupSize * maxGroups * maxGroups);
    const perSubmit = options.dispatchesPerSubmit ?? DISPATCHES_PER_SUBMIT;
    if (!(workgroupSize >= 1 && cap >= 1 && dispatchNonces >= 1 && perSubmit >= 1 && maxGroups >= 1)) {
      throw new Error('WebGPU: invalid kernel options');
    }
    const module = device.createShaderModule({ code: shaderSource(passes, workgroupSize, cap), label: `${label} scan` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length) {
      throw new Error(`WebGPU shader compilation failed: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
    }
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: STAGE_COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAM_WORDS * 4 } },
        { binding: 1, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const pipeline = await device
      .createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint: 'main' },
      })
      .catch((err: Error) => {
        throw new Error(`WebGPU pipeline creation failed: ${err.message}`);
      });
    return new WebGpuSha256Kernel({
      passes,
      device,
      ownsDevice,
      adapterInfo,
      pipeline,
      layout,
      workgroupSize,
      cap,
      dispatchNonces,
      perSubmit,
      maxGroups,
    });
  }

  scan(job: ScanJob): Promise<ScanOutcome> {
    // One scan at a time: they share the uniform and result buffers.
    const run = this.tail.then(() => this.run(job));
    this.tail = run.catch(() => {});
    return run;
  }

  memoryBytes(): number {
    return this.uniform.size + this.found.size + this.readback.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.uniform.destroy();
    this.found.destroy();
    this.readback.destroy();
    if (this.ownsDevice) this.device.destroy();
  }

  private usable(): void {
    if (this.disposed) throw new Error('webgpu kernel is disposed');
    if (this.lostReason !== null) throw new Error(`WebGPU device lost: ${this.lostReason}`);
    const uncaptured = this.uncaptured;
    if (uncaptured !== null) {
      this.uncaptured = null;
      throw new Error(`WebGPU error: ${uncaptured}`);
    }
  }

  private async run(job: ScanJob): Promise<ScanOutcome> {
    checkScanJob(job);
    this.usable();
    const { start, end } = job;
    const pre = sha256Prehash(job.data);
    this.setWork(pre, job.target);
    const ranges: Range[] = [];
    for (let lo = start; lo < end; lo += this.dispatchNonces) ranges.push([lo, Math.min(end, lo + this.dispatchNonces)]);
    const solutions: FoundSolution[] = [];
    await this.scanRanges(ranges, job, pre, solutions);
    return { hashesDone: end - start, solutions };
  }

  /** Writes the per-work part of every dispatch slot. */
  private setWork(pre: Sha256Prehash, target: Uint32Array): void {
    for (let s = 0; s < this.perSubmit; s++) {
      const o = s * this.slotWords;
      this.params.set(pre.midstate, o);
      this.params.set(pre.state4, o + 8);
      this.params.set(pre.x, o + 16);
      this.params[o + 24] = target[7];
      this.params[o + 25] = target[6];
    }
  }

  private async scanRanges(ranges: Range[], job: ScanJob, pre: Sha256Prehash, solutions: FoundSolution[]): Promise<void> {
    for (let i = 0; i < ranges.length; i += this.perSubmit) {
      const batch = ranges.slice(i, i + this.perSubmit);
      const results = await this.dispatch(batch);
      for (let j = 0; j < batch.length; j++) {
        if (solutions.length >= MAX_SOLUTIONS) break;
        const [lo, hi] = batch[j];
        const { count, nonces } = results[j];
        if (count > this.cap) {
          // Candidates were dropped: scan this range again in halves, in order.
          this.stats.rescans++;
          const mid = lo + Math.floor((hi - lo) / 2);
          await this.scanRanges([[lo, mid], [mid, hi]], job, pre, solutions);
          continue;
        }
        this.stats.candidates += count;
        nonces.sort();
        for (const n of nonces) {
          const hash = sha256HashNonce(job.data, n, this.passes, this.hash, pre.midstate);
          if (validHash(hash, job.target)) {
            solutions.push(makeSolution(job, n, hash));
            if (solutions.length >= MAX_SOLUTIONS) break;
          }
        }
      }
    }
  }

  /** Runs up to perSubmit ranges in one submission and reads their candidates. */
  private async dispatch(batch: Range[]): Promise<DispatchResult[]> {
    this.usable();
    const { device, params, slotWords } = this;
    const workgroupSize = this.granularity;
    const grids: [number, number][] = [];
    batch.forEach(([lo, hi], s) => {
      const groups = Math.ceil((hi - lo) / workgroupSize);
      const gx = Math.min(groups, this.maxGroups);
      const gy = Math.ceil(groups / gx);
      const o = s * slotWords;
      params[o + 26] = lo;
      params[o + 27] = hi - lo;
      params[o + 28] = gx * workgroupSize;
      params[o + 29] = s;
      grids.push([gx, gy]);
    });
    const foundBytes = batch.length * (this.cap + 1) * 4;
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    device.queue.writeBuffer(this.uniform, 0, params, 0, batch.length * slotWords);
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer(this.found, 0, foundBytes);
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    grids.forEach(([gx, gy], s) => {
      pass.setBindGroup(0, this.bindGroup, [s * slotWords * 4]);
      pass.dispatchWorkgroups(gx, gy);
    });
    pass.end();
    encoder.copyBufferToBuffer(this.found, 0, this.readback, 0, foundBytes);
    device.queue.submit([encoder.finish()]);
    this.stats.submissions++;
    this.stats.dispatches += grids.length;
    this.stats.grids2d += grids.filter(([, gy]) => gy > 1).length;
    const scopes = Promise.all([device.popErrorScope(), device.popErrorScope()]);
    scopes.catch(() => {}); // awaited below unless the readback fails first
    let words: Uint32Array;
    try {
      await this.readback.mapAsync(MAP_READ, 0, foundBytes);
      words = new Uint32Array(this.readback.getMappedRange(0, foundBytes).slice(0));
      this.readback.unmap();
    } catch (err) {
      // A lost device fails the readback; its lost promise may settle a bit later.
      await Promise.race([this.lost, new Promise((resolve) => setTimeout(resolve, 100))]);
      if (this.disposed) throw new Error('webgpu kernel is disposed');
      if (this.lostReason !== null) throw new Error(`WebGPU device lost: ${this.lostReason}`);
      throw new Error(`WebGPU readback failed: ${(err as Error).message}`);
    }
    const errors = (await scopes).filter((e) => e !== null);
    if (errors.length) throw new Error(`WebGPU dispatch failed: ${errors.map((e) => e!.message).join('; ')}`);
    return batch.map((_, s) => {
      const o = s * (this.cap + 1);
      const count = words[o];
      return { count, nonces: words.slice(o + 1, o + 1 + Math.min(count, this.cap)) };
    });
  }
}

export function createWebGpuKernel(setup: KernelSetup, options?: WebGpuKernelOptions): Promise<WebGpuSha256Kernel> {
  return WebGpuSha256Kernel.create(setup, options);
}

export const webgpuBackend: BackendFactory = {
  name: 'webgpu',
  kind: 'gpu',
  priority: 5,
  unsupported(algo: AlgoSpec, caps: Capabilities): string | null {
    if (!caps.webgpu) return 'WebGPU is not available';
    return SHA256_FAMILY.has(algo.name) ? null : `webgpu implements ${[...SHA256_FAMILY].join(', ')} only`;
  },
  create: (setup) => createWebGpuKernel(setup),
};

registerBackend(webgpuBackend);
