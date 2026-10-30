// Typed wrapper over the cmo_* C API (native/shim/cmo.c). One instance runs
// one algorithm; the work instance builds jobs, scan instances hash.
import { instantiate, type RawExports } from './loader.ts';

export const ABI_VERSION = 1;
export const MAX_SOLUTIONS = 64;
const SOLUTION_BYTES = 240; // cmo_solution_t: u32 data[48], u32 hash[8], f64 sharediff, u32 flags, pad
const SOLUTION_LEGACY = 1;
export const DATA_WORDS = 48;

export interface GateInfo {
  ntimeIndex: number;
  nbitsIndex: number;
  nonceIndex: number;
  workCmpSize: number;
  workDataSize: number;
  targetFactor: number;
}

export interface Solution {
  /** Full work data at the time of the solution (48 words), nonce included. */
  data: Uint32Array;
  /** Hash as eight little-endian words, word 7 most significant (zeros if legacy). */
  hash: Uint32Array;
  shareDiff: number;
  /** Found by a legacy scanhash that reports the nonce but not the hash. */
  legacy: boolean;
}

export interface InitOptions {
  paramN?: number;
  paramR?: number;
  key?: string | null;
  /** Allocate per-thread scratchpads (scan instances). */
  threadInit?: boolean;
}

type Fn = (...args: number[]) => number;

export class Cmo {
  readonly raw: RawExports;
  private fns: Record<string, Fn>;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private scanData = 0;
  private scanTarget = 0;

  private constructor(raw: RawExports) {
    this.raw = raw;
    this.fns = raw as unknown as Record<string, Fn>;
    const abi = this.call('cmo_abi_version');
    if (abi !== ABI_VERSION) throw new Error(`cpuminer-opt-js ABI ${abi}, expected ${ABI_VERSION}`);
  }

  static async create(module: WebAssembly.Module, onOutput?: (line: string) => void): Promise<Cmo> {
    return new Cmo(await instantiate(module, onOutput));
  }

  get memory(): WebAssembly.Memory {
    return this.raw.memory;
  }

  call(name: string, ...args: number[]): number {
    const fn = this.fns[name];
    if (typeof fn !== 'function') throw new Error(`missing export ${name}`);
    return fn(...args);
  }

  // ---------------------------------------------------------------- memory

  malloc(size: number): number {
    const p = this.call('cmo_malloc', size);
    if (!p) throw new RangeError(`WASM allocation of ${size} bytes failed`);
    return p;
  }

  free(ptr: number): void {
    if (ptr) this.call('cmo_free', ptr);
  }

  bytes(ptr: number, len: number): Uint8Array {
    return new Uint8Array(this.memory.buffer, ptr, len);
  }

  u32(ptr: number, words: number): Uint32Array {
    return new Uint32Array(this.memory.buffer, ptr, words);
  }

  cstring(ptr: number): string {
    if (!ptr) return '';
    const mem = new Uint8Array(this.memory.buffer);
    let end = ptr;
    while (mem[end] !== 0) end++;
    return this.decoder.decode(mem.subarray(ptr, end));
  }

  withCString<T>(s: string | null | undefined, fn: (ptr: number) => T): T {
    if (s == null) return fn(0);
    const enc = this.encoder.encode(s);
    const ptr = this.malloc(enc.length + 1);
    try {
      const mem = new Uint8Array(this.memory.buffer, ptr, enc.length + 1);
      mem.set(enc);
      mem[enc.length] = 0;
      return fn(ptr);
    } finally {
      this.free(ptr);
    }
  }

  private withScratch<T>(size: number, fn: (ptr: number) => T): T {
    const ptr = this.malloc(size);
    try {
      return fn(ptr);
    } finally {
      this.free(ptr);
    }
  }

  // ------------------------------------------------------------ algorithms

  algoCount(): number {
    return this.call('cmo_algo_count');
  }

  algoName(id: number): string | null {
    const p = this.call('cmo_algo_name', id);
    return p ? this.cstring(p) : null;
  }

  /** Resolves a name or alias ("scrypt:N" included). */
  resolve(name: string): { id: number; paramN: number } | null {
    return this.withScratch(4, (out) =>
      this.withCString(name, (s) => {
        const id = this.call('cmo_algo_resolve', s, out);
        return id < 0 ? null : { id, paramN: this.u32(out, 1)[0] | 0 };
      }),
    );
  }

  /** Returns 0, -1 (registration failed) or -2 (thread init failed). */
  init(id: number, opts: InitOptions = {}): number {
    return this.withCString(opts.key ?? null, (key) =>
      this.call('cmo_init', id, opts.paramN ?? 0, opts.paramR ?? 0, key, opts.threadInit ? 1 : 0),
    );
  }

  gateInfo(): GateInfo {
    return this.withScratch(20, (out) => {
      this.call('cmo_gate_info', out);
      const w = new Int32Array(this.memory.buffer, out, 5);
      return {
        ntimeIndex: w[0],
        nbitsIndex: w[1],
        nonceIndex: w[2],
        workCmpSize: w[3],
        workDataSize: w[4],
        targetFactor: this.call('cmo_target_factor'),
      };
    });
  }

  /** Pending applog output from the C side (and clears it). */
  drainLog(): string[] {
    return this.withScratch(4, (lenPtr) => {
      const p = this.call('cmo_log_drain', lenPtr);
      const len = this.u32(lenPtr, 1)[0];
      if (!len) return [];
      return this.decoder
        .decode(new Uint8Array(this.memory.buffer, p, len))
        .split('\n')
        .filter(Boolean);
    });
  }

  // ------------------------------------------------- work instance (jobs)

  setUser(user: string): void {
    this.withCString(user, (p) => this.call('cmo_set_user', p));
  }

  subscribed(xnonce1: string, xnonce2Size: number): boolean {
    return this.withCString(xnonce1, (p) => this.call('cmo_stratum_subscribed', p, xnonce2Size)) === 0;
  }

  setExtranonce(xnonce1: string, xnonce2Size: number): boolean {
    return this.withCString(xnonce1, (p) => this.call('cmo_set_extranonce', p, xnonce2Size)) === 0;
  }

  setDifficulty(diff: number): void {
    this.call('cmo_set_difficulty', diff);
  }

  /** mining.notify params (the JSON array). */
  notify(params: unknown[]): boolean {
    return this.withCString(JSON.stringify(params), (p) => this.call('cmo_notify', p)) === 0;
  }

  /** Builds work from the current job and advances extranonce2. 0 = no job. */
  genWork(): number {
    return this.call('cmo_gen_work') >>> 0;
  }

  workData(seq: number): Uint32Array {
    const p = this.call('cmo_work_data', seq);
    if (!p) throw new Error(`work ${seq} is gone`);
    return this.u32(p, DATA_WORDS).slice();
  }

  workTarget(seq: number): Uint32Array {
    const p = this.call('cmo_work_target', seq);
    if (!p) throw new Error(`work ${seq} is gone`);
    return this.u32(p, 8).slice();
  }

  workTargetDiff(seq: number): number {
    return this.call('cmo_work_targetdiff', seq);
  }

  workJobId(seq: number): string {
    return this.cstring(this.call('cmo_work_job_id', seq));
  }

  workHeight(seq: number): number {
    return this.call('cmo_work_height', seq);
  }

  netDiff(): number {
    return this.call('cmo_net_diff');
  }

  /** mining.submit JSON for a solution of work `seq` (null if the work is gone). */
  buildSubmit(seq: number, data: Uint32Array): string | null {
    return this.withScratch(DATA_WORDS * 4 + 1024, (buf) => {
      this.u32(buf, DATA_WORDS).set(data.subarray(0, DATA_WORDS));
      const out = buf + DATA_WORDS * 4;
      const len = this.call('cmo_build_submit', seq, buf, out);
      return len < 0 ? null : this.cstring(out);
    });
  }

  // ------------------------------------------------- scan instance (hashing)

  setScanWork(data: Uint32Array, target: Uint32Array): void {
    if (!this.scanData) {
      this.scanData = this.call('cmo_scan_data');
      this.scanTarget = this.call('cmo_scan_target');
    }
    this.u32(this.scanData, DATA_WORDS).set(data.subarray(0, DATA_WORDS));
    this.u32(this.scanTarget, 8).set(target.subarray(0, 8));
  }

  /** Scans nonces [start, end); returns hashes done. */
  scan(start: number, end: number): number {
    return this.call('cmo_scan', start >>> 0, end >>> 0);
  }

  solutionCount(): number {
    return this.call('cmo_solution_count');
  }

  solutions(): Solution[] {
    const n = Math.min(this.solutionCount(), MAX_SOLUTIONS);
    const base = this.call('cmo_solutions_ptr');
    const out: Solution[] = [];
    for (let i = 0; i < n; i++) {
      const p = base + i * SOLUTION_BYTES;
      out.push({
        data: this.u32(p, DATA_WORDS).slice(),
        hash: this.u32(p + 192, 8).slice(),
        shareDiff: new Float64Array(this.memory.buffer, p + 224, 1)[0],
        legacy: (this.u32(p + 232, 1)[0] & SOLUTION_LEGACY) !== 0,
      });
    }
    return out;
  }

  validHash(hash: Uint32Array, target: Uint32Array): boolean {
    return this.withScratch(64, (p) => {
      this.u32(p, 8).set(hash);
      this.u32(p + 32, 8).set(target);
      return this.call('cmo_valid_hash', p, p + 32) === 1;
    });
  }

  /** Direct single-nonce hash for algorithms with a direct entry point (quark); null otherwise. */
  directHash(data: Uint32Array, nonce: number): Uint32Array | null {
    return this.withScratch(DATA_WORDS * 4 + 32, (p) => {
      this.u32(p, DATA_WORDS).set(data.subarray(0, DATA_WORDS));
      const rc = this.call('cmo_direct_hash', p, nonce >>> 0, p + DATA_WORDS * 4);
      return rc === 0 ? this.u32(p + DATA_WORDS * 4, 8).slice() : null;
    });
  }

  /** The deterministic 48-word input shared with the native golden harness. */
  fixtureData(): Uint32Array {
    return this.withScratch(DATA_WORDS * 4, (p) => {
      this.call('cmo_fixture_data', p);
      return this.u32(p, DATA_WORDS).slice();
    });
  }

  diffToTarget(diff: number): Uint32Array {
    return this.withScratch(32, (p) => {
      this.call('cmo_diff_to_target', diff, p);
      return this.u32(p, 8).slice();
    });
  }

  // ---------------------------------------------------------------- verthash

  /** Allocates `size` bytes in this instance for the verthash dataset. */
  allocVerthash(size: number): number {
    return this.malloc(size);
  }

  setVerthash(ptr: number, size: number): void {
    this.call('cmo_verthash_set', ptr, size);
  }

  generateVerthash(ptr: number, size: number): number {
    return this.call('cmo_verthash_generate', ptr, size);
  }
}
