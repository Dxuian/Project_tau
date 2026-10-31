import {
  Emitter,
  LineDecoder,
  MAX_LINE_BYTES,
  StratumClientImpl,
  detect,
  detectRuntime,
  formatHostPort,
  nodeBuiltin,
  parseStratumUrl
} from "./chunk-4FZYJI2W.js";

// src/algos.generated.ts
var ALGO_NAMES = [null, "allium", "anime", "argon2d250", "argon2d500", "argon2d1000", "argon2d16000", "argon2d4096", "axiom", "blake", "blake2b", "blake2s", "blakecoin", "bmw", "bmw512", "c11", "deep", "dmd-gr", "groestl", "hex", "hmq1725", "jha", "keccak", "keccakc", "lbry", "lyra2h", "lyra2re", "lyra2rev2", "lyra2rev3", "lyra2z", "lyra2z330", "m7m", "minotaur", "minotaurx", "myr-gr", "neoscrypt", "nist5", "pentablake", "phi1612", "phi2", "polytimos", "power2b", "quark", "qubit", "scrypt", "sha256d", "sha256dt", "sha256q", "sha256t", "sha3d", "sha512256d", "skein", "skein2", "skunk", "sonoa", "timetravel", "timetravel10", "tribus", "vanilla", "veltor", "verthash", "whirlpool", "whirlpoolx", "x11", "x11evo", "x11gost", "x12", "x13", "x13bcd", "x13sm3", "x14", "x15", "x16r", "x16rv2", "x16rt", "x16rt-veil", "x16s", "x17", "x20r", "x21s", "x22i", "x25x", "xevan", "yescrypt", "yescryptr8", "yescryptr8g", "yescryptr16", "yescryptr32", "yespower", "yespowerr16", "yespower-b2b", "zr5"];
var ALGO_ALIASES = {
  "bcd": "x13bcd",
  "bitcore": "timetravel10",
  "bitzeny": "yescryptr8",
  "blake256r8": "blakecoin",
  "blake256r8vnl": "vanilla",
  "blake256r14": "blake",
  "diamond": "dmd-gr",
  "espers": "hmq1725",
  "flax": "c11",
  "hsr": "x13sm3",
  "jackpot": "jha",
  "lyra2": "lyra2re",
  "lyra2v2": "lyra2rev2",
  "lyra2v3": "lyra2rev3",
  "myrgr": "myr-gr",
  "myriad": "myr-gr",
  "neo": "neoscrypt",
  "phi": "phi1612",
  "scryptn2": "scrypt:1048576",
  "sib": "x11gost",
  "timetravel8": "timetravel",
  "veil": "x16rt-veil",
  "x16r-hex": "hex",
  "yenten": "yescryptr16",
  "ziftr": "zr5"
};

// src/algos.ts
var STATUS = {
  bmw: {
    status: "unsupported-upstream",
    notes: "cpuminer-opt v26.1 lists bmw but never registers it (no register_gate case)."
  },
  verthash: {
    status: "node-only",
    notes: "Needs the 1.28 GB verthash.dat dataset per worker (generated on first use); Node only."
  },
  "yespower-b2b": {
    status: "needs-params",
    notes: 'Generic yespower+blake2b: pass params { n, r, key } (e.g. power2b: n=2048, r=32, key="Now I am become Death, the destroyer of worlds").'
  }
};
var SHA256_FAMILY = /* @__PURE__ */ new Set(["sha256d", "sha256t", "sha256q"]);
function listAlgorithms() {
  const aliasesOf = /* @__PURE__ */ new Map();
  for (const [alias, proper] of Object.entries(ALGO_ALIASES)) {
    const base = proper.split(":")[0];
    aliasesOf.set(base, [...aliasesOf.get(base) ?? [], alias]);
  }
  const out = [];
  ALGO_NAMES.forEach((name, id) => {
    if (!name) return;
    const s = STATUS[name];
    out.push({
      name,
      id,
      aliases: aliasesOf.get(name) ?? [],
      status: s?.status ?? "ok",
      ...s ? { notes: s.notes } : {},
      sha256Family: SHA256_FAMILY.has(name)
    });
  });
  return out;
}
function resolveAlgo(nameOrAlias, params = {}) {
  let arg = nameOrAlias;
  const alias = Object.keys(ALGO_ALIASES).find((a) => a.toLowerCase() === arg.toLowerCase());
  if (alias) arg = ALGO_ALIASES[alias];
  for (let id = 1; id < ALGO_NAMES.length; id++) {
    const name = ALGO_NAMES[id];
    if (!name || arg.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue;
    const rest = arg.slice(name.length);
    let n = 0;
    if (rest === "") {
    } else if (rest[0] === ":" && /^\d+$/.test(rest.slice(1)) && Number(rest.slice(1)) >= 2) {
      n = Number(rest.slice(1));
    } else {
      continue;
    }
    return { name, id, paramN: params.n ?? n, paramR: params.r ?? 0, key: params.key ?? null };
  }
  throw new Error(`unknown algorithm "${nameOrAlias}" (see listAlgorithms())`);
}
function algoInfo(name) {
  return listAlgorithms().find((a) => a.name === name);
}

// src/wasm/loader.ts
var CmoExit = class extends Error {
  code;
  constructor(code) {
    super(`cpuminer-opt called exit(${code})`);
    this.code = code;
  }
};
var ESPIPE = 70;
var decoder = new TextDecoder();
async function instantiate(module, onOutput = () => {
}) {
  let memory;
  const pending2 = /* @__PURE__ */ new Map();
  const imports = {
    env: {
      emscripten_notify_memory_growth: () => {
      }
    },
    wasi_snapshot_preview1: {
      fd_write(fd, iovs, iovsLen, nwritten) {
        const view = new DataView(memory.buffer);
        const bytes = new Uint8Array(memory.buffer);
        let total = 0;
        let text = pending2.get(fd) ?? "";
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          text += decoder.decode(bytes.subarray(ptr, ptr + len));
          total += len;
        }
        const lines = text.split("\n");
        pending2.set(fd, lines.pop() ?? "");
        for (const line of lines) if (line.trim()) onOutput(line);
        view.setUint32(nwritten, total, true);
        return 0;
      },
      fd_close: () => 0,
      fd_seek: () => ESPIPE,
      proc_exit(code) {
        throw new CmoExit(code);
      }
    }
  };
  const instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports;
  memory = exports.memory;
  exports._initialize?.();
  return exports;
}

// src/wasm/api.ts
var ABI_VERSION = 1;
var MAX_SOLUTIONS = 64;
var SOLUTION_BYTES = 240;
var SOLUTION_LEGACY = 1;
var DATA_WORDS = 48;
var Cmo = class _Cmo {
  raw;
  fns;
  encoder = new TextEncoder();
  decoder = new TextDecoder();
  scanData = 0;
  scanTarget = 0;
  constructor(raw) {
    this.raw = raw;
    this.fns = raw;
    const abi = this.call("cmo_abi_version");
    if (abi !== ABI_VERSION) throw new Error(`cpuminer-opt-js ABI ${abi}, expected ${ABI_VERSION}`);
  }
  static async create(module, onOutput) {
    return new _Cmo(await instantiate(module, onOutput));
  }
  get memory() {
    return this.raw.memory;
  }
  call(name, ...args) {
    const fn = this.fns[name];
    if (typeof fn !== "function") throw new Error(`missing export ${name}`);
    return fn(...args);
  }
  // ---------------------------------------------------------------- memory
  malloc(size) {
    const p = this.call("cmo_malloc", size);
    if (!p) throw new RangeError(`WASM allocation of ${size} bytes failed`);
    return p;
  }
  free(ptr) {
    if (ptr) this.call("cmo_free", ptr);
  }
  bytes(ptr, len) {
    return new Uint8Array(this.memory.buffer, ptr, len);
  }
  u32(ptr, words) {
    return new Uint32Array(this.memory.buffer, ptr, words);
  }
  cstring(ptr) {
    if (!ptr) return "";
    const mem = new Uint8Array(this.memory.buffer);
    let end = ptr;
    while (mem[end] !== 0) end++;
    return this.decoder.decode(mem.subarray(ptr, end));
  }
  withCString(s, fn) {
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
  withScratch(size, fn) {
    const ptr = this.malloc(size);
    try {
      return fn(ptr);
    } finally {
      this.free(ptr);
    }
  }
  // ------------------------------------------------------------ algorithms
  algoCount() {
    return this.call("cmo_algo_count");
  }
  algoName(id) {
    const p = this.call("cmo_algo_name", id);
    return p ? this.cstring(p) : null;
  }
  /** Resolves a name or alias ("scrypt:N" included). */
  resolve(name) {
    return this.withScratch(
      4,
      (out) => this.withCString(name, (s) => {
        const id = this.call("cmo_algo_resolve", s, out);
        return id < 0 ? null : { id, paramN: this.u32(out, 1)[0] | 0 };
      })
    );
  }
  /** Returns 0, -1 (registration failed) or -2 (thread init failed). */
  init(id, opts = {}) {
    return this.withCString(
      opts.key ?? null,
      (key) => this.call("cmo_init", id, opts.paramN ?? 0, opts.paramR ?? 0, key, opts.threadInit ? 1 : 0)
    );
  }
  gateInfo() {
    return this.withScratch(20, (out) => {
      this.call("cmo_gate_info", out);
      const w = new Int32Array(this.memory.buffer, out, 5);
      return {
        ntimeIndex: w[0],
        nbitsIndex: w[1],
        nonceIndex: w[2],
        workCmpSize: w[3],
        workDataSize: w[4],
        targetFactor: this.call("cmo_target_factor")
      };
    });
  }
  /** Pending applog output from the C side (and clears it). */
  drainLog() {
    return this.withScratch(4, (lenPtr) => {
      const p = this.call("cmo_log_drain", lenPtr);
      const len = this.u32(lenPtr, 1)[0];
      if (!len) return [];
      return this.decoder.decode(new Uint8Array(this.memory.buffer, p, len)).split("\n").filter(Boolean);
    });
  }
  // ------------------------------------------------- work instance (jobs)
  setUser(user) {
    this.withCString(user, (p) => this.call("cmo_set_user", p));
  }
  subscribed(xnonce1, xnonce2Size) {
    return this.withCString(xnonce1, (p) => this.call("cmo_stratum_subscribed", p, xnonce2Size)) === 0;
  }
  setExtranonce(xnonce1, xnonce2Size) {
    return this.withCString(xnonce1, (p) => this.call("cmo_set_extranonce", p, xnonce2Size)) === 0;
  }
  setDifficulty(diff) {
    this.call("cmo_set_difficulty", diff);
  }
  /** mining.notify params (the JSON array). */
  notify(params) {
    return this.withCString(JSON.stringify(params), (p) => this.call("cmo_notify", p)) === 0;
  }
  /** Builds work from the current job and advances extranonce2. 0 = no job. */
  genWork() {
    return this.call("cmo_gen_work") >>> 0;
  }
  workData(seq) {
    const p = this.call("cmo_work_data", seq);
    if (!p) throw new Error(`work ${seq} is gone`);
    return this.u32(p, DATA_WORDS).slice();
  }
  workTarget(seq) {
    const p = this.call("cmo_work_target", seq);
    if (!p) throw new Error(`work ${seq} is gone`);
    return this.u32(p, 8).slice();
  }
  workTargetDiff(seq) {
    return this.call("cmo_work_targetdiff", seq);
  }
  workJobId(seq) {
    return this.cstring(this.call("cmo_work_job_id", seq));
  }
  workHeight(seq) {
    return this.call("cmo_work_height", seq);
  }
  netDiff() {
    return this.call("cmo_net_diff");
  }
  /** mining.submit JSON for a solution of work `seq` (null if the work is gone). */
  buildSubmit(seq, data) {
    return this.withScratch(DATA_WORDS * 4 + 1024, (buf) => {
      this.u32(buf, DATA_WORDS).set(data.subarray(0, DATA_WORDS));
      const out = buf + DATA_WORDS * 4;
      const len = this.call("cmo_build_submit", seq, buf, out);
      return len < 0 ? null : this.cstring(out);
    });
  }
  // ------------------------------------------------- scan instance (hashing)
  setScanWork(data, target) {
    if (!this.scanData) {
      this.scanData = this.call("cmo_scan_data");
      this.scanTarget = this.call("cmo_scan_target");
    }
    this.u32(this.scanData, DATA_WORDS).set(data.subarray(0, DATA_WORDS));
    this.u32(this.scanTarget, 8).set(target.subarray(0, 8));
  }
  /** Scans nonces [start, end); returns hashes done. */
  scan(start, end) {
    return this.call("cmo_scan", start >>> 0, end >>> 0);
  }
  solutionCount() {
    return this.call("cmo_solution_count");
  }
  solutions() {
    const n = Math.min(this.solutionCount(), MAX_SOLUTIONS);
    const base = this.call("cmo_solutions_ptr");
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = base + i * SOLUTION_BYTES;
      out.push({
        data: this.u32(p, DATA_WORDS).slice(),
        hash: this.u32(p + 192, 8).slice(),
        shareDiff: new Float64Array(this.memory.buffer, p + 224, 1)[0],
        legacy: (this.u32(p + 232, 1)[0] & SOLUTION_LEGACY) !== 0
      });
    }
    return out;
  }
  validHash(hash2, target) {
    return this.withScratch(64, (p) => {
      this.u32(p, 8).set(hash2);
      this.u32(p + 32, 8).set(target);
      return this.call("cmo_valid_hash", p, p + 32) === 1;
    });
  }
  /** Direct single-nonce hash for algorithms with a direct entry point (quark); null otherwise. */
  directHash(data, nonce) {
    return this.withScratch(DATA_WORDS * 4 + 32, (p) => {
      this.u32(p, DATA_WORDS).set(data.subarray(0, DATA_WORDS));
      const rc = this.call("cmo_direct_hash", p, nonce >>> 0, p + DATA_WORDS * 4);
      return rc === 0 ? this.u32(p + DATA_WORDS * 4, 8).slice() : null;
    });
  }
  /** The deterministic 48-word input shared with the native golden harness. */
  fixtureData() {
    return this.withScratch(DATA_WORDS * 4, (p) => {
      this.call("cmo_fixture_data", p);
      return this.u32(p, DATA_WORDS).slice();
    });
  }
  diffToTarget(diff) {
    return this.withScratch(32, (p) => {
      this.call("cmo_diff_to_target", diff, p);
      return this.u32(p, 8).slice();
    });
  }
  // ---------------------------------------------------------------- verthash
  /** Allocates `size` bytes in this instance for the verthash dataset. */
  allocVerthash(size) {
    return this.malloc(size);
  }
  setVerthash(ptr, size) {
    this.call("cmo_verthash_set", ptr, size);
  }
  generateVerthash(ptr, size) {
    return this.call("cmo_verthash_generate", ptr, size);
  }
};

// src/backends/registry.ts
var factories = /* @__PURE__ */ new Map();
function registerBackend(factory) {
  factories.set(factory.name, factory);
}
function getBackend(name) {
  const f = factories.get(name);
  if (!f) throw new Error(`unknown backend ${name}`);
  return f;
}
function listBackends() {
  return [...factories.values()].sort((a, b) => a.priority - b.priority);
}
var SHA256_FAMILY2 = /* @__PURE__ */ new Set(["sha256d", "sha256t", "sha256q"]);

// src/backends/wasm.ts
var MAX_NONCE = 4294967295;
var SHA256_KIND = { sha256d: 2, sha256t: 3, sha256q: 4 };
var VERTHASH_SIZE = 1283457024;
async function loadVerthash(cmo, file) {
  const fs = await nodeBuiltin("fs");
  const size = fs.statSync(file).size;
  if (size !== VERTHASH_SIZE) throw new Error(`${file} is ${size} bytes, expected ${VERTHASH_SIZE}`);
  const ptr = cmo.allocVerthash(size);
  const fd = fs.openSync(file, "r");
  try {
    for (let off = 0; off < size; ) {
      const len = Math.min(1 << 26, size - off);
      const n = fs.readSync(fd, cmo.bytes(ptr + off, len), 0, len, off);
      if (n <= 0) throw new Error(`short read of ${file}`);
      off += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  cmo.setVerthash(ptr, size);
}
var WasmKernel = class {
  backend;
  granularity = 16;
  cmo;
  fast;
  constructor(backend, cmo, fast) {
    this.backend = backend;
    this.cmo = cmo;
    this.fast = fast;
  }
  scan(job) {
    this.cmo.setScanWork(job.data, job.target);
    const hashesDone = this.fast ? this.cmo.call("cmo_sha256_fast_scan", this.fast.kind, this.fast.lanes, job.start >>> 0, job.end) : this.cmo.scan(job.start, Math.min(job.end, MAX_NONCE));
    const solutions = this.cmo.solutions().map((s) => ({
      seq: job.seq,
      data: s.data,
      hash: s.hash,
      shareDiff: s.shareDiff
    }));
    return { hashesDone, solutions };
  }
  memoryBytes() {
    return this.cmo.memory.buffer.byteLength;
  }
  dispose() {
  }
};
async function createKernel(setup, fastLanes) {
  if (!setup.module) throw new Error(`${setup.backend}: no compiled module supplied`);
  const cmo = await Cmo.create(setup.module);
  const algo = setup.algo;
  if (algo.name === "verthash") {
    if (!setup.verthash) throw new Error("verthash needs a dataset file (verthashFile option)");
    await loadVerthash(cmo, setup.verthash.file);
  }
  const rc = cmo.init(algo.id, { paramN: algo.paramN, paramR: algo.paramR, key: algo.key, threadInit: true });
  if (rc !== 0) {
    const log = cmo.drainLog().join(" | ");
    throw new Error(`cpuminer-opt failed to initialise ${algo.name} (${rc})${log ? `: ${log}` : ""}`);
  }
  const fast = fastLanes ? { kind: SHA256_KIND[algo.name], lanes: fastLanes } : null;
  return new WasmKernel(setup.backend, cmo, fast);
}
function wasmUnsupported(algo, caps) {
  if (!caps.wasm.available) return "WebAssembly is unavailable (or blocked by a Content Security Policy)";
  if (!caps.wasm.simd128) return "needs WebAssembly SIMD (Chrome 91+, Firefox 89+, Safari 16.4+, Node 16.4+)";
  if (algo.name === "verthash" && caps.runtime !== "node") return "verthash needs Node (1.28 GB dataset per worker)";
  if (algo.name === "bmw") return "bmw is not registered by cpuminer-opt v26.1";
  return null;
}
var variantPriority = { avx2: 20, sse42: 21, sse41: 22 };
for (const v of ["avx2", "sse42", "sse41"]) {
  registerBackend({
    name: `wasm-${v}`,
    kind: "cpu",
    priority: variantPriority[v],
    unsupported: wasmUnsupported,
    create: (setup) => createKernel(setup, null)
  });
}
for (const lanes of [8, 4]) {
  registerBackend({
    name: `wasm-sha256-x${lanes}`,
    kind: "cpu",
    priority: lanes === 8 ? 10 : 11,
    unsupported: (algo, caps) => !SHA256_FAMILY2.has(algo.name) ? "only sha256d, sha256t and sha256q" : wasmUnsupported(algo, caps),
    create: (setup) => createKernel(setup, lanes)
  });
}
function variantFor(backend) {
  if (backend === "wasm-avx2") return "avx2";
  if (backend === "wasm-sse42") return "sse42";
  if (backend === "wasm-sse41" || backend.startsWith("wasm-sha256")) return "sse41";
  return null;
}

// src/backends/sha256-js.ts
var SHA256_IV = Uint32Array.of(
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
);
var SHA256_K = Uint32Array.of(
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
);
var MAX_SOLUTIONS2 = 64;
var rotr = (x, n) => x >>> n | x << 32 - n;
var bsig0 = (x) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
var bsig1 = (x) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
var ssig0 = (x) => rotr(x, 7) ^ rotr(x, 18) ^ x >>> 3;
var ssig1 = (x) => rotr(x, 17) ^ rotr(x, 19) ^ x >>> 10;
function bswap32(x) {
  return (x << 24 | (x & 65280) << 8 | x >>> 8 & 65280 | x >>> 24) >>> 0;
}
var W = new Int32Array(64);
function sha256Compress(state, block2, out = new Uint32Array(8)) {
  for (let i = 0; i < 16; i++) W[i] = block2[i];
  for (let i = 16; i < 64; i++) W[i] = ssig1(W[i - 2]) + W[i - 7] + ssig0(W[i - 15]) + W[i - 16] | 0;
  let a = state[0] | 0, b = state[1] | 0, c = state[2] | 0, d = state[3] | 0;
  let e = state[4] | 0, f = state[5] | 0, g = state[6] | 0, h = state[7] | 0;
  for (let i = 0; i < 64; i++) {
    const t1 = h + bsig1(e) + (g ^ e & (f ^ g)) + SHA256_K[i] + W[i] | 0;
    const t2 = bsig0(a) + (a & b | c & (a | b)) | 0;
    h = g;
    g = f;
    f = e;
    e = d + t1 | 0;
    d = c;
    c = b;
    b = a;
    a = t1 + t2 | 0;
  }
  out[0] = state[0] + a;
  out[1] = state[1] + b;
  out[2] = state[2] + c;
  out[3] = state[3] + d;
  out[4] = state[4] + e;
  out[5] = state[5] + f;
  out[6] = state[6] + g;
  out[7] = state[7] + h;
  return out;
}
function sha256Midstate(data, out) {
  return sha256Compress(SHA256_IV, data, out);
}
var BLOCK1_W4 = 2147483648;
var BLOCK1_W15 = 640;
function sha256Prehash(data) {
  const midstate = sha256Midstate(data);
  const w0 = data[16] | 0, w1 = data[17] | 0, w2 = data[18] | 0;
  let a = midstate[0] | 0, b = midstate[1] | 0, c = midstate[2] | 0, d = midstate[3] | 0;
  let e = midstate[4] | 0, f = midstate[5] | 0, g = midstate[6] | 0, h = midstate[7] | 0;
  const w = [w0, w1, w2];
  for (let i = 0; i < 3; i++) {
    const t12 = h + bsig1(e) + (g ^ e & (f ^ g)) + SHA256_K[i] + w[i] | 0;
    const t22 = bsig0(a) + (a & b | c & (a | b)) | 0;
    h = g;
    g = f;
    f = e;
    e = d + t12 | 0;
    d = c;
    c = b;
    b = a;
    a = t12 + t22 | 0;
  }
  const t1 = h + bsig1(e) + (g ^ e & (f ^ g)) + SHA256_K[3] | 0;
  const t2 = bsig0(a) + (a & b | c & (a | b)) | 0;
  const state4 = Uint32Array.of(t1 + t2, a, b, c, d + t1, e, f, g);
  const x0 = ssig0(w1) + w0 | 0;
  const x1 = ssig1(BLOCK1_W15) + ssig0(w2) + w1 | 0;
  const x = Uint32Array.of(
    x0,
    x1,
    ssig1(x0) + w2,
    ssig1(x1) + ssig0(BLOCK1_W4),
    ssig0(BLOCK1_W15),
    ssig0(x0) + BLOCK1_W15,
    ssig0(x1) + x0
  );
  return { midstate, state4, x };
}
function sha256Passes(algo) {
  switch (algo) {
    case "sha256d":
      return 2;
    case "sha256t":
      return 3;
    case "sha256q":
      return 4;
    default:
      throw new Error(`not a sha256 family algorithm: ${algo}`);
  }
}
var block = new Uint32Array(16);
function sha256HashNonce(data, nonce, passes, out = new Uint32Array(8), midstate) {
  if (midstate) out.set(midstate);
  else sha256Midstate(data, out);
  block.fill(0);
  block[0] = data[16];
  block[1] = data[17];
  block[2] = data[18];
  block[3] = nonce;
  block[4] = BLOCK1_W4;
  block[15] = BLOCK1_W15;
  sha256Compress(out, block, out);
  for (let i = 1; i < passes; i++) {
    block.set(out);
    block[8] = 2147483648;
    block.fill(0, 9, 15);
    block[15] = 256;
    sha256Compress(SHA256_IV, block, out);
  }
  for (let i = 0; i < 8; i++) out[i] = bswap32(out[i]);
  return out;
}
function validHash(hash2, target) {
  for (let i = 7; i >= 0; i--) {
    const h = hash2[i] >>> 0, t = target[i] >>> 0;
    if (h !== t) return h < t;
  }
  return true;
}
var TWO_224 = 1n << 224n;
function shareDiff(hash2) {
  const h = BigInt(hash2[7] >>> 0) << 96n | BigInt(hash2[6] >>> 0) << 64n | BigInt(hash2[5] >>> 0) << 32n | BigInt(hash2[4] >>> 0);
  if (h === 0n) return Infinity;
  let q = TWO_224 / h;
  if (q * h !== TWO_224) q |= 1n;
  return Number(q) * 2 ** -128;
}
function checkScanJob(job) {
  const { start, end } = job;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > 2 ** 32) {
    throw new RangeError(`invalid nonce range [${start}, ${end})`);
  }
  if (!job.data || job.data.length < 20) throw new RangeError("work data needs at least 20 words");
  if (!job.target || job.target.length < 8) throw new RangeError("target needs 8 words");
}
function makeSolution(job, nonce, hash2) {
  const data = job.data.slice();
  data[19] = nonce;
  return { seq: job.seq, data, hash: hash2.slice(), shareDiff: shareDiff(hash2) };
}

// src/backends/js.ts
var PARAM_WORDS = 24;
var JsSha256Kernel = class {
  backend = "js";
  granularity = 1;
  passes;
  params = new Int32Array(PARAM_WORDS);
  io = new Int32Array(8);
  hash = new Uint32Array(8);
  constructor(algo) {
    this.passes = sha256Passes(algo);
  }
  scan(job) {
    checkScanJob(job);
    const { data, target, start, end } = job;
    const pre = sha256Prehash(data);
    const p = this.params;
    p.set(pre.midstate, 0);
    p.set(pre.state4, 8);
    p.set(pre.x, 16);
    p[23] = target[7] ^ 2147483648;
    const extra = this.passes - 2;
    const solutions = [];
    for (let n = start; n < end; ) {
      const c = scanRange(p, n, end, extra, this.io);
      if (c < 0) break;
      if (solutions.length < MAX_SOLUTIONS2) {
        const hash2 = sha256HashNonce(data, c, this.passes, this.hash, pre.midstate);
        if (validHash(hash2, target)) solutions.push(makeSolution(job, c, hash2));
      }
      n = c + 1;
    }
    return { hashesDone: end - start, solutions };
  }
  memoryBytes() {
    return (PARAM_WORDS + 16) * 4;
  }
  dispose() {
  }
};
function createJsKernel(setup) {
  if (!SHA256_FAMILY2.has(setup.algo.name)) throw new Error(`js backend does not implement ${setup.algo.name}`);
  return new JsSha256Kernel(setup.algo.name);
}
var jsBackend = {
  name: "js",
  kind: "cpu",
  priority: 50,
  unsupported(algo) {
    return SHA256_FAMILY2.has(algo.name) ? null : `js implements ${[...SHA256_FAMILY2].join(", ")} only`;
  },
  async create(setup) {
    return createJsKernel(setup);
  }
};
registerBackend(jsBackend);
function pass32(io) {
  let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, t = 0, x = 0, y = 0;
  let w0 = io[0], w1 = io[1], w2 = io[2], w3 = io[3], w4 = io[4], w5 = io[5], w6 = io[6], w7 = io[7];
  let w8 = 0, w9 = 0, w10 = 0, w11 = 0, w12 = 0, w13 = 0, w14 = 0, w15 = 0;
  t = 4084723048 + w0 | 0;
  d = 2773480762 + t | 0;
  h = 143694565 + t | 0;
  t = 2428182076 + w1 + (2600822924 ^ d & 3389733619) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
  c = 1013904242 + t | 0;
  x = h ^ 1779033703;
  g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (1779033703 ^ x & 3513665762) + t | 0;
  t = 1355179099 + w2 + (1359893119 ^ c & (d ^ 1359893119)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
  b = 3144134277 + t | 0;
  y = g ^ h;
  f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
  t = 985935396 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
  a = 1779033703 + t | 0;
  x = f ^ g;
  e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
  t = d + 961987163 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
  h = h + t | 0;
  y = e ^ f;
  d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
  t = c + 1508970993 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
  g = g + t | 0;
  x = d ^ e;
  c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
  t = b + 2453635748 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
  f = f + t | 0;
  y = c ^ d;
  b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
  t = a + 2870763221 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
  e = e + t | 0;
  x = b ^ c;
  a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
  t = h + 1476897432 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
  d = d + t | 0;
  y = a ^ b;
  h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
  t = g + 310598401 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
  c = c + t | 0;
  x = h ^ a;
  g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
  t = f + 607225278 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
  b = b + t | 0;
  y = g ^ h;
  f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
  t = e + 1426881987 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
  a = a + t | 0;
  x = f ^ g;
  e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
  t = d + 1925078388 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
  h = h + t | 0;
  y = e ^ f;
  d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
  t = c + 2162078206 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
  g = g + t | 0;
  x = d ^ e;
  c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
  t = b + 2614888103 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
  f = f + t | 0;
  y = c ^ d;
  b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
  t = a + 3248222836 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
  e = e + t | 0;
  x = b ^ c;
  a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
  w0 = w0 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) | 0;
  t = h + 3835390401 + w0 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
  d = d + t | 0;
  y = a ^ b;
  h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
  w1 = w1 + 10485760 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) | 0;
  t = g + 4022224774 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
  c = c + t | 0;
  x = h ^ a;
  g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
  w2 = w2 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;
  t = f + 264347078 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
  b = b + t | 0;
  y = g ^ h;
  f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
  w3 = w3 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;
  t = e + 604807628 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
  a = a + t | 0;
  x = f ^ g;
  e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
  w4 = w4 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
  t = d + 770255983 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
  h = h + t | 0;
  y = e ^ f;
  d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
  w5 = w5 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;
  t = c + 1249150122 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
  g = g + t | 0;
  x = d ^ e;
  c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
  w6 = w6 + 256 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
  t = b + 1555081692 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
  f = f + t | 0;
  y = c ^ d;
  b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
  w7 = w7 + w0 + 285220864 + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
  t = a + 1996064986 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
  e = e + t | 0;
  x = b ^ c;
  a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
  w8 = 2147483648 + w1 + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
  t = h + 2554220882 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
  d = d + t | 0;
  y = a ^ b;
  h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
  w9 = w2 + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
  t = g + 2821834349 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
  c = c + t | 0;
  x = h ^ a;
  g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
  w10 = w3 + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
  t = f + 2952996808 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
  b = b + t | 0;
  y = g ^ h;
  f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
  w11 = w4 + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
  t = e + 3210313671 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
  a = a + t | 0;
  x = f ^ g;
  e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
  w12 = w5 + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
  t = d + 3336571891 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
  h = h + t | 0;
  y = e ^ f;
  d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
  w13 = w6 + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;
  t = c + 3584528711 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
  g = g + t | 0;
  x = d ^ e;
  c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
  w14 = 4194338 + w7 + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;
  t = b + 113926993 + w14 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
  f = f + t | 0;
  y = c ^ d;
  b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
  w15 = 256 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;
  t = a + 338241895 + w15 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
  e = e + t | 0;
  x = b ^ c;
  a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
  w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;
  t = h + 666307205 + w0 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
  d = d + t | 0;
  y = a ^ b;
  h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
  w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;
  t = g + 773529912 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
  c = c + t | 0;
  x = h ^ a;
  g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
  w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;
  t = f + 1294757372 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
  b = b + t | 0;
  y = g ^ h;
  f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
  w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;
  t = e + 1396182291 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
  a = a + t | 0;
  x = f ^ g;
  e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
  w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
  t = d + 1695183700 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
  h = h + t | 0;
  y = e ^ f;
  d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
  w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;
  t = c + 1986661051 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
  g = g + t | 0;
  x = d ^ e;
  c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
  w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
  t = b + 2177026350 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
  f = f + t | 0;
  y = c ^ d;
  b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
  w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
  t = a + 2456956037 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
  e = e + t | 0;
  x = b ^ c;
  a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
  w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
  t = h + 2730485921 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
  d = d + t | 0;
  y = a ^ b;
  h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
  w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
  t = g + 2820302411 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
  c = c + t | 0;
  x = h ^ a;
  g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
  w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
  t = f + 3259730800 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
  b = b + t | 0;
  y = g ^ h;
  f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
  w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
  t = e + 3345764771 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
  a = a + t | 0;
  x = f ^ g;
  e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
  w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
  t = d + 3516065817 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
  h = h + t | 0;
  y = e ^ f;
  d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
  w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;
  t = c + 3600352804 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
  g = g + t | 0;
  x = d ^ e;
  c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
  w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;
  t = b + 4094571909 + w14 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
  f = f + t | 0;
  y = c ^ d;
  b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
  w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;
  t = a + 275423344 + w15 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
  e = e + t | 0;
  x = b ^ c;
  a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
  w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;
  t = h + 430227734 + w0 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
  d = d + t | 0;
  y = a ^ b;
  h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
  w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;
  t = g + 506948616 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
  c = c + t | 0;
  x = h ^ a;
  g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
  w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;
  t = f + 659060556 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
  b = b + t | 0;
  y = g ^ h;
  f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
  w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;
  t = e + 883997877 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
  a = a + t | 0;
  x = f ^ g;
  e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
  w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
  t = d + 958139571 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
  h = h + t | 0;
  y = e ^ f;
  d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
  w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;
  t = c + 1322822218 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
  g = g + t | 0;
  x = d ^ e;
  c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
  w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
  t = b + 1537002063 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
  f = f + t | 0;
  y = c ^ d;
  b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
  w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
  t = a + 1747873779 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
  e = e + t | 0;
  x = b ^ c;
  a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
  w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
  t = h + 1955562222 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
  d = d + t | 0;
  y = a ^ b;
  h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
  w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
  t = g + 2024104815 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
  c = c + t | 0;
  x = h ^ a;
  g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
  w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
  t = f + 2227730452 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
  b = b + t | 0;
  y = g ^ h;
  f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
  w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
  t = e + 2361852424 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
  a = a + t | 0;
  x = f ^ g;
  e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
  w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
  t = d + 2428436474 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
  h = h + t | 0;
  y = e ^ f;
  d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
  w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;
  t = c + 2756734187 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
  g = g + t | 0;
  x = d ^ e;
  c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
  w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;
  t = b + 3204031479 + w14 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
  f = f + t | 0;
  y = c ^ d;
  b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
  w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;
  t = a + 3329325298 + w15 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
  e = e + t | 0;
  x = b ^ c;
  a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
  w0 = a + 1779033703 | 0;
  w1 = b + 3144134277 | 0;
  w2 = c + 1013904242 | 0;
  w3 = d + 2773480762 | 0;
  w4 = e + 1359893119 | 0;
  w5 = f + 2600822924 | 0;
  w6 = g + 528734635 | 0;
  w7 = h + 1541459225 | 0;
  io[0] = w0;
  io[1] = w1;
  io[2] = w2;
  io[3] = w3;
  io[4] = w4;
  io[5] = w5;
  io[6] = w6;
  io[7] = w7;
}
function scanRange(p, n, end, extra, io) {
  const m0 = p[0], m1 = p[1], m2 = p[2], m3 = p[3], m4 = p[4], m5 = p[5], m6 = p[6], m7 = p[7];
  const sa = p[8], sb = p[9], sc = p[10], sd = p[11], se = p[12], sf = p[13], sg = p[14], sh = p[15];
  const x0 = p[16], x1 = p[17], x2 = p[18], x3 = p[19], x4 = p[20], x5 = p[21], x6 = p[22];
  const t7 = p[23];
  const kx16 = x0 + 3835390401 | 0, kx17 = x1 + 4022224774 | 0, bc = sb ^ sc;
  let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, t = 0, x = 0, y = 0;
  let w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0;
  let w8 = 0, w9 = 0, w10 = 0, w11 = 0, w12 = 0, w13 = 0, w14 = 0, w15 = 0;
  for (; n < end; n++) {
    w3 = n | 0;
    e = sa + w3 | 0;
    a = se + w3 | 0;
    t = sh + 3109470811 + (sg ^ a & (sf ^ sg)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = sd + t | 0;
    x = e ^ sb;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (sb ^ x & bc) + t | 0;
    t = sg + 1508970993 + (sf ^ h & (a ^ sf)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = sc + t | 0;
    y = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;
    t = sf + 2453635748 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = sb + t | 0;
    x = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;
    t = a + 2870763221 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    y = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;
    t = h + 3624381080 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    x = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;
    t = g + 310598401 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    y = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;
    t = f + 607225278 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    x = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ x & y) + t | 0;
    t = e + 1426881987 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    y = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ y & x) + t | 0;
    t = d + 1925078388 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    x = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;
    t = c + 2162078206 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    y = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;
    t = b + 2614888103 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    x = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;
    t = a + 3248223220 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    y = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;
    t = h + kx16 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    x = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;
    t = g + kx17 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    y = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;
    w2 = x2 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) | 0;
    t = f + 264347078 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    x = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ x & y) + t | 0;
    w3 = x3 + w3 | 0;
    t = e + 604807628 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    y = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ y & x) + t | 0;
    w4 = 2147483648 + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
    t = d + 770255983 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    x = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;
    w5 = (w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10;
    t = c + 1249150122 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    y = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;
    w6 = 640 + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
    t = b + 1555081692 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    x = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;
    w7 = x0 + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
    t = a + 1996064986 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    y = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;
    w8 = x1 + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
    t = h + 2554220882 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    x = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;
    w9 = w2 + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
    t = g + 2821834349 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    y = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;
    w10 = w3 + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
    t = f + 2952996808 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    x = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ x & y) + t | 0;
    w11 = w4 + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
    t = e + 3210313671 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    y = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ y & x) + t | 0;
    w12 = w5 + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
    t = d + 3336571891 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    x = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;
    w13 = w6 + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;
    t = c + 3584528711 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    y = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;
    w14 = x4 + w7 + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;
    t = b + 113926993 + w14 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    x = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;
    w15 = x5 + w8 + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;
    t = a + 338241895 + w15 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    y = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;
    w0 = x6 + w9 + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;
    t = h + 666307205 + w0 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    x = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;
    w1 = x1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;
    t = g + 773529912 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    y = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;
    w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;
    t = f + 1294757372 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    x = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ x & y) + t | 0;
    w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;
    t = e + 1396182291 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    y = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ y & x) + t | 0;
    w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
    t = d + 1695183700 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    x = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;
    w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;
    t = c + 1986661051 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    y = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;
    w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
    t = b + 2177026350 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    x = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;
    w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
    t = a + 2456956037 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    y = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;
    w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
    t = h + 2730485921 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    x = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;
    w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
    t = g + 2820302411 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    y = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;
    w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
    t = f + 3259730800 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    x = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ x & y) + t | 0;
    w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
    t = e + 3345764771 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    y = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ y & x) + t | 0;
    w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
    t = d + 3516065817 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    x = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;
    w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;
    t = c + 3600352804 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    y = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;
    w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;
    t = b + 4094571909 + w14 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    x = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;
    w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;
    t = a + 275423344 + w15 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    y = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;
    w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;
    t = h + 430227734 + w0 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    x = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;
    w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;
    t = g + 506948616 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    y = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;
    w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;
    t = f + 659060556 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    x = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ x & y) + t | 0;
    w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;
    t = e + 883997877 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    y = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ y & x) + t | 0;
    w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
    t = d + 958139571 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    x = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;
    w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;
    t = c + 1322822218 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    y = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;
    w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
    t = b + 1537002063 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    x = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;
    w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
    t = a + 1747873779 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    y = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;
    w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
    t = h + 1955562222 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    x = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;
    w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
    t = g + 2024104815 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    y = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;
    w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
    t = f + 2227730452 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    x = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ x & y) + t | 0;
    w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
    t = e + 2361852424 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    y = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ y & x) + t | 0;
    w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
    t = d + 2428436474 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    x = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;
    w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;
    t = c + 2756734187 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    y = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;
    w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;
    t = b + 3204031479 + w14 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    x = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;
    w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;
    t = a + 3329325298 + w15 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    y = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;
    w0 = m0 + a | 0;
    w1 = m1 + b | 0;
    w2 = m2 + c | 0;
    w3 = m3 + d | 0;
    w4 = m4 + e | 0;
    w5 = m5 + f | 0;
    w6 = m6 + g | 0;
    w7 = m7 + h | 0;
    if (extra > 0) {
      io[0] = w0;
      io[1] = w1;
      io[2] = w2;
      io[3] = w3;
      io[4] = w4;
      io[5] = w5;
      io[6] = w6;
      io[7] = w7;
      for (let i = 0; i < extra; i++) pass32(io);
      w0 = io[0];
      w1 = io[1];
      w2 = io[2];
      w3 = io[3];
      w4 = io[4];
      w5 = io[5];
      w6 = io[6];
      w7 = io[7];
    }
    t = 4084723048 + w0 | 0;
    d = 2773480762 + t | 0;
    h = 143694565 + t | 0;
    t = 2428182076 + w1 + (2600822924 ^ d & 3389733619) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = 1013904242 + t | 0;
    x = h ^ 1779033703;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (1779033703 ^ x & 3513665762) + t | 0;
    t = 1355179099 + w2 + (1359893119 ^ c & (d ^ 1359893119)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = 3144134277 + t | 0;
    y = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
    t = 985935396 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = 1779033703 + t | 0;
    x = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
    t = d + 961987163 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    y = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
    t = c + 1508970993 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    x = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
    t = b + 2453635748 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    y = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
    t = a + 2870763221 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    x = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
    t = h + 1476897432 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    y = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
    t = g + 310598401 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    x = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
    t = f + 607225278 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    y = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
    t = e + 1426881987 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    x = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
    t = d + 1925078388 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    y = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
    t = c + 2162078206 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    x = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
    t = b + 2614888103 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    y = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
    t = a + 3248222836 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    x = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
    w0 = w0 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) | 0;
    t = h + 3835390401 + w0 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    y = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
    w1 = w1 + 10485760 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) | 0;
    t = g + 4022224774 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    x = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
    w2 = w2 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;
    t = f + 264347078 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    y = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
    w3 = w3 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;
    t = e + 604807628 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    x = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
    w4 = w4 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
    t = d + 770255983 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    y = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
    w5 = w5 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;
    t = c + 1249150122 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    x = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
    w6 = w6 + 256 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
    t = b + 1555081692 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    y = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
    w7 = w7 + w0 + 285220864 + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
    t = a + 1996064986 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    x = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
    w8 = 2147483648 + w1 + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
    t = h + 2554220882 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    y = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
    w9 = w2 + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
    t = g + 2821834349 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    x = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
    w10 = w3 + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
    t = f + 2952996808 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    y = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
    w11 = w4 + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
    t = e + 3210313671 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    x = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
    w12 = w5 + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
    t = d + 3336571891 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    y = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
    w13 = w6 + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;
    t = c + 3584528711 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    x = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
    w14 = 4194338 + w7 + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;
    t = b + 113926993 + w14 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    y = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
    w15 = 256 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;
    t = a + 338241895 + w15 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    x = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
    w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;
    t = h + 666307205 + w0 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    y = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
    w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;
    t = g + 773529912 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    x = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
    w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;
    t = f + 1294757372 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    y = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
    w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;
    t = e + 1396182291 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    x = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
    w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
    t = d + 1695183700 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    y = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
    w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;
    t = c + 1986661051 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    x = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
    w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
    t = b + 2177026350 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    y = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
    w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
    t = a + 2456956037 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    x = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
    w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
    t = h + 2730485921 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    y = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
    w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
    t = g + 2820302411 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    x = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
    w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
    t = f + 3259730800 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    y = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
    w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
    t = e + 3345764771 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    x = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
    w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
    t = d + 3516065817 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    y = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
    w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;
    t = c + 3600352804 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    x = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
    w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;
    t = b + 4094571909 + w14 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    y = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
    w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;
    t = a + 275423344 + w15 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    x = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
    w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;
    t = h + 430227734 + w0 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    y = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
    w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;
    t = g + 506948616 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    x = h ^ a;
    g = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;
    w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;
    t = f + 659060556 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    y = g ^ h;
    f = ((g >>> 2 | g << 30) ^ (g >>> 13 | g << 19) ^ (g >>> 22 | g << 10)) + (h ^ y & x) + t | 0;
    w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;
    t = e + 883997877 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    x = f ^ g;
    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g ^ x & y) + t | 0;
    w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;
    t = d + 958139571 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    y = e ^ f;
    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;
    w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;
    t = c + 1322822218 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;
    g = g + t | 0;
    x = d ^ e;
    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;
    w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;
    t = b + 1537002063 + w6 + (a ^ g & (h ^ a)) + ((g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7)) | 0;
    f = f + t | 0;
    y = c ^ d;
    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;
    w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;
    t = a + 1747873779 + w7 + (h ^ f & (g ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;
    e = e + t | 0;
    x = b ^ c;
    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;
    w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;
    t = h + 1955562222 + w8 + (g ^ e & (f ^ g)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;
    d = d + t | 0;
    y = a ^ b;
    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;
    w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;
    t = g + 2024104815 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;
    c = c + t | 0;
    w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;
    t = f + 2227730452 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;
    b = b + t | 0;
    w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;
    t = e + 2361852424 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;
    a = a + t | 0;
    w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;
    t = d + 2428436474 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;
    h = h + t | 0;
    t = h + 1541459225 | 0;
    if (((t << 24 | (t & 65280) << 8 | t >>> 8 & 65280 | t >>> 24) ^ 2147483648) <= t7) return n;
  }
  return -1;
}

// src/backends/node-crypto.ts
var NodeCryptoKernel = class {
  backend = "node-crypto";
  granularity = 1;
  passes;
  sha256;
  header = new Uint8Array(80);
  view = new DataView(this.header.buffer);
  hash = new Uint32Array(8);
  constructor(algo, sha256) {
    this.passes = sha256Passes(algo);
    this.sha256 = sha256;
  }
  scan(job) {
    checkScanJob(job);
    const { data, target, start, end } = job;
    const { header, view, sha256, passes, hash: hash2 } = this;
    for (let i = 0; i < 19; i++) view.setUint32(i * 4, data[i]);
    const t7 = target[7];
    const solutions = [];
    for (let n = start; n < end; n++) {
      view.setUint32(76, n);
      let digest = sha256(header);
      for (let p = 1; p < passes; p++) digest = sha256(digest);
      if (digest.readUInt32LE(28) > t7 || solutions.length >= MAX_SOLUTIONS2) continue;
      for (let i = 0; i < 8; i++) hash2[i] = digest.readUInt32LE(i * 4);
      if (validHash(hash2, target)) solutions.push(makeSolution(job, n, hash2));
    }
    return { hashesDone: end - start, solutions };
  }
  memoryBytes() {
    return this.header.byteLength + this.hash.byteLength;
  }
  dispose() {
  }
};
async function createNodeCryptoKernel(setup) {
  if (!SHA256_FAMILY2.has(setup.algo.name)) throw new Error(`node-crypto backend does not implement ${setup.algo.name}`);
  const crypto = await nodeBuiltin("crypto");
  const one = crypto.hash;
  const sha256 = typeof one === "function" ? (b) => one("sha256", b, "buffer") : (b) => crypto.createHash("sha256").update(b).digest();
  return new NodeCryptoKernel(setup.algo.name, sha256);
}
var nodeCryptoBackend = {
  name: "node-crypto",
  kind: "cpu",
  priority: 40,
  unsupported(algo, caps) {
    if (!caps.nodeCrypto) return "node:crypto is not available";
    return SHA256_FAMILY2.has(algo.name) ? null : `node-crypto implements ${[...SHA256_FAMILY2].join(", ")} only`;
  },
  create: createNodeCryptoKernel
};
registerBackend(nodeCryptoBackend);

// src/backends/webgpu.ts
var WORKGROUP_SIZE = 256;
var CANDIDATE_CAP = 64;
var DISPATCH_NONCES = 1 << 24;
var DISPATCHES_PER_SUBMIT = 16;
var BUFFER_MAP_READ = 1;
var BUFFER_COPY_SRC = 4;
var BUFFER_COPY_DST = 8;
var BUFFER_UNIFORM = 64;
var BUFFER_STORAGE = 128;
var MAP_READ = 1;
var STAGE_COMPUTE = 4;
var PARAM_WORDS2 = 32;
var isNum = (v) => typeof v === "number";
var hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, "0")}u`;
var lit = (v) => isNum(v) ? hex(v) : v;
var rotr2 = (x, n) => (x >>> n | x << 32 - n) >>> 0;
var FOLD = {
  bsig0: (x) => (rotr2(x, 2) ^ rotr2(x, 13) ^ rotr2(x, 22)) >>> 0,
  bsig1: (x) => (rotr2(x, 6) ^ rotr2(x, 11) ^ rotr2(x, 25)) >>> 0,
  ssig0: (x) => (rotr2(x, 7) ^ rotr2(x, 18) ^ x >>> 3) >>> 0,
  ssig1: (x) => (rotr2(x, 17) ^ rotr2(x, 19) ^ x >>> 10) >>> 0
};
var fn1 = (name, v) => isNum(v) ? FOLD[name](v) : `${name}(${v})`;
var ch = (e, f, g) => isNum(e) && isNum(f) && isNum(g) ? (g ^ e & (f ^ g)) >>> 0 : `ch(${lit(e)}, ${lit(f)}, ${lit(g)})`;
var maj = (a, b, c) => isNum(a) && isNum(b) && isNum(c) ? (a & b | c & (a | b)) >>> 0 : `maj(${lit(a)}, ${lit(b)}, ${lit(c)})`;
function sum(terms) {
  let c = 0;
  let at = -1;
  let vars = 0;
  const parts = [];
  for (const t of terms) {
    if (isNum(t)) {
      if (at < 0) {
        at = parts.length;
        parts.push("");
      }
      c = c + t >>> 0;
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
  return parts.join(" + ");
}
var LETTERS = "abcdefgh";
var Rounds = class {
  out = [];
  w = [];
  val = /* @__PURE__ */ new Map();
  ind;
  constructor(indent) {
    this.ind = indent;
  }
  line(s) {
    this.out.push(this.ind + s);
  }
  letter(j, r) {
    return LETTERS[j - r & 7];
  }
  get(name) {
    return this.val.get(name) ?? name;
  }
  set(name, v) {
    if (isNum(v)) {
      this.val.set(name, v);
      return;
    }
    this.val.delete(name);
    this.line(`${name} = ${v};`);
  }
  /** Starts at round r; a null value means its letter already holds it. */
  start(r, values) {
    this.val.clear();
    values.forEach((v, j) => {
      if (v !== null) this.val.set(this.letter(j, r), v);
    });
  }
  round(r, eOnly = false) {
    const v = (j) => this.get(this.letter(j, r));
    const w = this.w[r];
    const kw = isNum(w) ? [SHA256_K[r] + w >>> 0] : [SHA256_K[r], w];
    const t1 = sum([v(7), ...kw, ch(v(4), v(5), v(6)), fn1("bsig1", v(4))]);
    let t = t1;
    if (!isNum(t1)) {
      this.line(`t = ${t1};`);
      t = "t";
    }
    this.set(this.letter(3, r), sum([v(3), t]));
    if (!eOnly) this.set(this.letter(7, r), sum([fn1("bsig0", v(0)), maj(v(0), v(1), v(2)), t]));
  }
  /** W[t] = s1(W[t-2]) + W[t-7] + s0(W[t-15]) + W[t-16], zero terms dropped. */
  expand(t) {
    const W2 = this.w;
    this.assignW(t, sum([W2[t - 16], W2[t - 7], fn1("ssig0", W2[t - 15]), fn1("ssig1", W2[t - 2])]));
  }
  assignW(t, s) {
    if (isNum(s)) {
      this.w[t] = s;
      return;
    }
    const name = `w${t & 15}`;
    this.line(`${name} = ${s};`);
    this.w[t] = name;
  }
};
function pass32Rounds(g, last, eOnlyFrom) {
  g.start(0, Array.from(SHA256_IV));
  for (let i = 0; i < 8; i++) g.w[i] = `w${i}`;
  g.w[8] = 2147483648;
  for (let i = 9; i < 15; i++) g.w[i] = 0;
  g.w[15] = 256;
  for (let r = 0; r < last; r++) {
    if (r >= 16) g.expand(r);
    g.round(r, r >= eOnlyFrom);
  }
}
var SHADER_HEAD = `struct Params {
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
var VARS = [
  "var a = 0u; var b = 0u; var c = 0u; var d = 0u; var e = 0u; var f = 0u; var g = 0u; var h = 0u; var t = 0u;",
  "var w8 = 0u; var w9 = 0u; var w10 = 0u; var w11 = 0u; var w12 = 0u; var w13 = 0u; var w14 = 0u; var w15 = 0u;"
];
function shaderSource(passes, workgroupSize, cap) {
  const L = [SHADER_HEAD];
  if (passes > 2) {
    const g2 = new Rounds("  ");
    pass32Rounds(g2, 64, 64);
    L.push(
      "fn pass32(m: array<u32, 8>) -> array<u32, 8> {",
      "  var w0 = m[0]; var w1 = m[1]; var w2 = m[2]; var w3 = m[3]; var w4 = m[4]; var w5 = m[5]; var w6 = m[6]; var w7 = m[7];",
      ...VARS.map((v) => "  " + v),
      ...g2.out,
      `  return array<u32, 8>(${Array.from(SHA256_IV, (iv, j) => `${g2.get(LETTERS[j])} + ${hex(iv)}`).join(", ")});`,
      "}",
      ""
    );
  }
  const g = new Rounds("  ");
  g.line("// Block 1: round 3 gets the nonce, then rounds 4..63.");
  g.line(`${g.letter(0, 4)} = p.st[0].x + nonce;`);
  g.line(`${g.letter(4, 4)} = p.st[1].x + nonce;`);
  g.start(4, [null, "p.st[0].y", "p.st[0].z", "p.st[0].w", null, "p.st[1].y", "p.st[1].z", "p.st[1].w"]);
  const W2 = g.w;
  W2[3] = "w3";
  W2[4] = 2147483648;
  for (let i = 5; i < 15; i++) W2[i] = 0;
  W2[15] = 640;
  W2[16] = "x0";
  W2[17] = "x1";
  for (let r = 4; r < 18; r++) g.round(r);
  const s0 = (v) => fn1("ssig0", v);
  const s1 = (v) => fn1("ssig1", v);
  const plan = [
    [18, ["x2", s0("w3")]],
    [19, ["x3", "w3"]],
    [20, [2147483648, s1("w2")]],
    [21, [s1("w3")]],
    [22, [640, s1("w4")]],
    [23, ["x0", s1("w5")]],
    [24, ["x1", s1("w6")]],
    [25, ["w2", s1("w7")]],
    [26, ["w3", s1("w8")]],
    [27, ["w4", s1("w9")]],
    [28, ["w5", s1("w10")]],
    [29, ["w6", s1("w11")]],
    [30, ["x4", "w7", s1("w12")]],
    [31, ["x5", "w8", s1("w13")]],
    [32, ["x6", "w9", s1("w14")]]
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
    g.line("var m = array<u32, 8>(w0, w1, w2, w3, w4, w5, w6, w7);");
    for (let i = 2; i < passes; i++) g.line("m = pass32(m);");
    g.line("w0 = m[0]; w1 = m[1]; w2 = m[2]; w3 = m[3]; w4 = m[4]; w5 = m[5]; w6 = m[6]; w7 = m[7];");
  }
  g.line("// Final pass to round 60 (58..60 only need e): its e is the final word 7.");
  pass32Rounds(g, 61, 58);
  const e60 = g.letter(3, 60);
  g.line(`let h7 = bswap(${e60} + ${hex(SHA256_IV[7])});`);
  g.line("if (h7 > p.job.x) {");
  g.line("  return;");
  g.line("}");
  g.line("if (h7 == p.job.x) {");
  const tie = new Rounds("    ");
  tie.w.push(...g.w);
  tie.expand(61);
  tie.round(61, true);
  g.out.push(...tie.out);
  g.line(`  if (bswap(${tie.letter(3, 61)} + ${hex(SHA256_IV[6])}) > p.job.y) {`);
  g.line("    return;");
  g.line("  }");
  g.line("}");
  g.line(`let slot = p.grid.y * ${cap + 1}u;`);
  g.line("let k = atomicAdd(&found[slot], 1u);");
  g.line(`if (k < ${cap}u) {`);
  g.line("  atomicStore(&found[slot + 1u + k], nonce);");
  g.line("}");
  L.push(
    `@compute @workgroup_size(${workgroupSize})`,
    "fn main(@builtin(global_invocation_id) gid: vec3<u32>) {",
    "  let i = gid.y * p.grid.x + gid.x;",
    "  if (i >= p.job.w) {",
    "    return;",
    "  }",
    "  let nonce = p.job.z + i;",
    "  let m0 = p.mid[0].x; let m1 = p.mid[0].y; let m2 = p.mid[0].z; let m3 = p.mid[0].w;",
    "  let m4 = p.mid[1].x; let m5 = p.mid[1].y; let m6 = p.mid[1].z; let m7 = p.mid[1].w;",
    "  let x0 = p.x[0].x; let x1 = p.x[0].y; let x2 = p.x[0].z; let x3 = p.x[0].w;",
    "  let x4 = p.x[1].x; let x5 = p.x[1].y; let x6 = p.x[1].z;",
    "  var w0 = 0u; var w1 = 0u; var w2 = 0u; var w3 = nonce; var w4 = 0u; var w5 = 0u; var w6 = 0u; var w7 = 0u;",
    ...VARS.map((v) => "  " + v),
    ...g.out,
    "}",
    ""
  );
  return L.join("\n");
}
var WebGpuSha256Kernel = class _WebGpuSha256Kernel {
  backend = "webgpu";
  granularity;
  device;
  adapterInfo;
  /** Work done so far: queue submissions, dispatches, 2D-grid dispatches, overflow re-scans, candidates. */
  stats = { submissions: 0, dispatches: 0, grids2d: 0, rescans: 0, candidates: 0 };
  passes;
  ownsDevice;
  pipeline;
  bindGroup;
  uniform;
  found;
  readback;
  params;
  slotWords;
  cap;
  dispatchNonces;
  perSubmit;
  maxGroups;
  hash = new Uint32Array(8);
  tail = Promise.resolve();
  lost;
  lostReason = null;
  uncaptured = null;
  disposed = false;
  constructor(init) {
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
        { binding: 0, resource: { buffer: this.uniform, size: PARAM_WORDS2 * 4 } },
        { binding: 1, resource: { buffer: this.found } }
      ]
    });
    this.lost = device.lost.then((info) => {
      this.lostReason = info.message || info.reason || "unknown reason";
    });
    device.addEventListener("uncapturederror", (ev) => {
      this.uncaptured = ev.error.message;
    });
  }
  static async create(setup, options = {}) {
    if (!SHA256_FAMILY2.has(setup.algo.name)) throw new Error(`webgpu backend does not implement ${setup.algo.name}`);
    const passes = sha256Passes(setup.algo.name);
    let device = options.device;
    let info = device?.adapterInfo;
    if (!device) {
      const gpu = globalThis.navigator?.gpu;
      if (!gpu) throw new Error("WebGPU is not available (no navigator.gpu)");
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("WebGPU: no adapter available");
      info = adapter.info;
      device = await adapter.requestDevice();
    }
    const adapterInfo = { vendor: info?.vendor ?? "", architecture: info?.architecture ?? "", description: info?.description ?? "" };
    const ownsDevice = !options.device;
    let kernel;
    let failure;
    device.pushErrorScope("validation");
    try {
      kernel = await _WebGpuSha256Kernel.build(device, ownsDevice, adapterInfo, passes, setup.algo.name, options);
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
    return kernel;
  }
  static async build(device, ownsDevice, adapterInfo, passes, label, options) {
    const limits = device.limits;
    const workgroupSize = options.workgroupSize ?? Math.min(WORKGROUP_SIZE, limits.maxComputeWorkgroupSizeX);
    if (workgroupSize > limits.maxComputeWorkgroupSizeX || workgroupSize > limits.maxComputeInvocationsPerWorkgroup) {
      throw new Error(`WebGPU: workgroup size ${workgroupSize} exceeds the device limits`);
    }
    const maxGroups = Math.min(options.maxWorkgroupsPerDimension ?? Infinity, limits.maxComputeWorkgroupsPerDimension);
    const cap = options.candidateCap ?? CANDIDATE_CAP;
    const dispatchNonces = Math.min(options.dispatchNonces ?? DISPATCH_NONCES, 2 ** 31, workgroupSize * maxGroups * maxGroups);
    const perSubmit = options.dispatchesPerSubmit ?? DISPATCHES_PER_SUBMIT;
    if (!(workgroupSize >= 1 && cap >= 1 && dispatchNonces >= 1 && perSubmit >= 1 && maxGroups >= 1)) {
      throw new Error("WebGPU: invalid kernel options");
    }
    const module = device.createShaderModule({ code: shaderSource(passes, workgroupSize, cap), label: `${label} scan` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === "error");
    if (errors.length) {
      throw new Error(`WebGPU shader compilation failed: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("; ")}`);
    }
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: STAGE_COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAM_WORDS2 * 4 } },
        { binding: 1, visibility: STAGE_COMPUTE, buffer: { type: "storage" } }
      ]
    });
    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: "main" }
    }).catch((err) => {
      throw new Error(`WebGPU pipeline creation failed: ${err.message}`);
    });
    return new _WebGpuSha256Kernel({
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
      maxGroups
    });
  }
  scan(job) {
    const run = this.tail.then(() => this.run(job));
    this.tail = run.catch(() => {
    });
    return run;
  }
  memoryBytes() {
    return this.uniform.size + this.found.size + this.readback.size;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.uniform.destroy();
    this.found.destroy();
    this.readback.destroy();
    if (this.ownsDevice) this.device.destroy();
  }
  usable() {
    if (this.disposed) throw new Error("webgpu kernel is disposed");
    if (this.lostReason !== null) throw new Error(`WebGPU device lost: ${this.lostReason}`);
    const uncaptured = this.uncaptured;
    if (uncaptured !== null) {
      this.uncaptured = null;
      throw new Error(`WebGPU error: ${uncaptured}`);
    }
  }
  async run(job) {
    checkScanJob(job);
    this.usable();
    const { start, end } = job;
    const pre = sha256Prehash(job.data);
    this.setWork(pre, job.target);
    const ranges = [];
    for (let lo = start; lo < end; lo += this.dispatchNonces) ranges.push([lo, Math.min(end, lo + this.dispatchNonces)]);
    const solutions = [];
    await this.scanRanges(ranges, job, pre, solutions);
    return { hashesDone: end - start, solutions };
  }
  /** Writes the per-work part of every dispatch slot. */
  setWork(pre, target) {
    for (let s = 0; s < this.perSubmit; s++) {
      const o = s * this.slotWords;
      this.params.set(pre.midstate, o);
      this.params.set(pre.state4, o + 8);
      this.params.set(pre.x, o + 16);
      this.params[o + 24] = target[7];
      this.params[o + 25] = target[6];
    }
  }
  async scanRanges(ranges, job, pre, solutions) {
    for (let i = 0; i < ranges.length; i += this.perSubmit) {
      const batch = ranges.slice(i, i + this.perSubmit);
      const results = await this.dispatch(batch);
      for (let j = 0; j < batch.length; j++) {
        if (solutions.length >= MAX_SOLUTIONS2) break;
        const [lo, hi] = batch[j];
        const { count, nonces } = results[j];
        if (count > this.cap) {
          this.stats.rescans++;
          const mid = lo + Math.floor((hi - lo) / 2);
          await this.scanRanges([[lo, mid], [mid, hi]], job, pre, solutions);
          continue;
        }
        this.stats.candidates += count;
        nonces.sort();
        for (const n of nonces) {
          const hash2 = sha256HashNonce(job.data, n, this.passes, this.hash, pre.midstate);
          if (validHash(hash2, job.target)) {
            solutions.push(makeSolution(job, n, hash2));
            if (solutions.length >= MAX_SOLUTIONS2) break;
          }
        }
      }
    }
  }
  /** Runs up to perSubmit ranges in one submission and reads their candidates. */
  async dispatch(batch) {
    this.usable();
    const { device, params, slotWords } = this;
    const workgroupSize = this.granularity;
    const grids = [];
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
    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");
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
    scopes.catch(() => {
    });
    let words;
    try {
      await this.readback.mapAsync(MAP_READ, 0, foundBytes);
      words = new Uint32Array(this.readback.getMappedRange(0, foundBytes).slice(0));
      this.readback.unmap();
    } catch (err) {
      await Promise.race([this.lost, new Promise((resolve) => setTimeout(resolve, 100))]);
      if (this.disposed) throw new Error("webgpu kernel is disposed");
      if (this.lostReason !== null) throw new Error(`WebGPU device lost: ${this.lostReason}`);
      throw new Error(`WebGPU readback failed: ${err.message}`);
    }
    const errors = (await scopes).filter((e) => e !== null);
    if (errors.length) throw new Error(`WebGPU dispatch failed: ${errors.map((e) => e.message).join("; ")}`);
    return batch.map((_, s) => {
      const o = s * (this.cap + 1);
      const count = words[o];
      return { count, nonces: words.slice(o + 1, o + 1 + Math.min(count, this.cap)) };
    });
  }
};
function createWebGpuKernel(setup, options) {
  return WebGpuSha256Kernel.create(setup, options);
}
var webgpuBackend = {
  name: "webgpu",
  kind: "gpu",
  priority: 5,
  unsupported(algo, caps) {
    if (!caps.webgpu) return "WebGPU is not available";
    return SHA256_FAMILY2.has(algo.name) ? null : `webgpu implements ${[...SHA256_FAMILY2].join(", ")} only`;
  },
  create: (setup) => createWebGpuKernel(setup)
};
registerBackend(webgpuBackend);

// src/wasm/variants/index.ts
var BUILT_VARIANTS = ["sse41", "sse42", "avx2"];
var loaders = {
  sse41: () => import("./sse41-WDQYNUHN.js"),
  sse42: () => import("./sse42-E5NOG26Y.js"),
  avx2: () => import("./avx2-VIZ5BLIQ.js")
};

// src/wasm/variants.ts
var modules = /* @__PURE__ */ new Map();
function fromBase64(s) {
  const native = Uint8Array.fromBase64;
  if (native) return native(s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function gunzip(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is not available in this environment");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function variantBytes(variant) {
  const load = loaders[variant];
  if (!load) throw new Error(`WASM variant ${variant} was not built`);
  const mod = await load();
  const bytes = await gunzip(fromBase64(mod.gzipBase64));
  if (bytes.length !== mod.size) throw new Error(`corrupt embedded WASM (${variant})`);
  return bytes;
}
function compileVariant(variant) {
  let m = modules.get(variant);
  if (!m) {
    m = variantBytes(variant).then((b) => WebAssembly.compile(b));
    m.catch(() => modules.delete(variant));
    modules.set(variant, m);
  }
  return m;
}

// src/backends/setup.ts
var VERTHASH_SHA256 = "48aa21d7afededb63976d48a8ff8ec29d5b02563af4a1110b056cd43e83155a5";
async function kernelSetup(backend, algo, opts = {}) {
  const setup = { backend, algo };
  const variant = variantFor(backend);
  if (variant) setup.module = await compileVariant(variant);
  if (algo.name === "verthash") setup.verthash = { file: await ensureVerthashFile(opts) };
  return setup;
}
var pending = /* @__PURE__ */ new Map();
function ensureVerthashFile(opts = {}) {
  const file = opts.verthashFile ?? "verthash.dat";
  let p = pending.get(file);
  if (!p) {
    p = createIfMissing(file, opts.log ?? (() => {
    }));
    p.catch(() => pending.delete(file));
    pending.set(file, p);
  }
  return p;
}
async function createIfMissing(file, log) {
  const fs = await nodeBuiltin("fs");
  const crypto = await nodeBuiltin("crypto");
  if (fs.existsSync(file) && fs.statSync(file).size === VERTHASH_SIZE) return file;
  log(`generating verthash dataset ${file} (1.28 GB, several minutes)...`);
  const cmo = await Cmo.create(await compileVariant("sse41"));
  const ptr = cmo.malloc(VERTHASH_SIZE);
  cmo.bytes(ptr, VERTHASH_SIZE).fill(0);
  const rc = cmo.generateVerthash(ptr, VERTHASH_SIZE);
  if (rc !== 0) throw new Error(`verthash dataset generation failed (${rc})`);
  const data = cmo.bytes(ptr, VERTHASH_SIZE);
  const digest = crypto.createHash("sha256").update(data).digest("hex");
  if (digest !== VERTHASH_SHA256) throw new Error(`generated verthash dataset has the wrong SHA-256 (${digest})`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
  log(`verthash dataset written to ${file}`);
  return file;
}

// src/pool/scan-loop.ts
var now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
function yieldTask() {
  return new Promise((resolve) => {
    const ch2 = new MessageChannel();
    ch2.port1.onmessage = () => {
      ch2.port1.close();
      resolve();
    };
    ch2.port2.postMessage(0);
  });
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var ScanLoop = class {
  kernel = null;
  current = null;
  throttle = 0;
  running = false;
  disposed = false;
  post;
  constructor(post) {
    this.post = post;
  }
  async handle(msg) {
    try {
      switch (msg.type) {
        case "init": {
          this.kernel = await getBackend(msg.setup.backend).create(msg.setup);
          this.post({
            type: "ready",
            backend: this.kernel.backend,
            memoryBytes: this.kernel.memoryBytes(),
            granularity: this.kernel.granularity
          });
          break;
        }
        case "work":
          this.current = { gen: msg.gen, job: msg.job, cursor: msg.job.start, chunk: this.align(msg.chunk) };
          void this.run();
          break;
        case "chunk":
          if (this.current) this.current.chunk = this.align(msg.chunk);
          break;
        case "throttle":
          this.throttle = Math.min(0.95, Math.max(0, msg.value));
          break;
        case "stop":
          this.current = null;
          break;
        case "bench":
          await this.bench(msg.job, msg.warmupMs, msg.ms);
          break;
        case "dispose":
          this.current = null;
          this.disposed = true;
          this.kernel?.dispose();
          this.kernel = null;
          break;
      }
    } catch (err) {
      this.post({ type: "error", message: errorText(err), fatal: msg.type === "init" });
    }
  }
  align(chunk) {
    const g = this.kernel?.granularity ?? 1;
    return Math.max(g, Math.floor(chunk / g) * g);
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.current && this.kernel && !this.disposed) {
        const cur = this.current;
        const start = cur.cursor;
        const end = Math.min(start + cur.chunk, cur.job.end);
        const t0 = now();
        const out = await this.kernel.scan({ ...cur.job, start, end });
        const ms = now() - t0;
        if (this.current !== cur) continue;
        cur.cursor = end;
        this.post({ type: "progress", gen: cur.gen, seq: cur.job.seq, hashes: out.hashesDone, ms, solutions: out.solutions, cursor: end });
        if (end >= cur.job.end) {
          this.post({ type: "exhausted", gen: cur.gen, seq: cur.job.seq });
          if (this.current === cur) this.current = null;
        }
        if (this.throttle > 0) await sleep(ms * this.throttle / (1 - this.throttle));
        else await yieldTask();
      }
    } catch (err) {
      this.current = null;
      this.post({ type: "error", message: errorText(err), fatal: false });
    } finally {
      this.running = false;
    }
  }
  async bench(job, warmupMs, ms) {
    if (!this.kernel) throw new Error("bench before init");
    const k = this.kernel;
    let chunk = Math.max(k.granularity, 256);
    let n = job.start;
    for (const tEnd = now() + warmupMs; now() < tEnd; ) {
      const t02 = now();
      await k.scan({ ...job, start: n, end: n + chunk });
      n += chunk;
      if (now() - t02 < 20) chunk *= 2;
    }
    let hashes = 0;
    const t0 = now();
    while (now() - t0 < ms) {
      const out = await k.scan({ ...job, start: n, end: n + chunk });
      hashes += out.hashesDone;
      n += chunk;
      if (n > 4026531840) n = job.start;
    }
    this.post({ type: "bench", hashes, ms: now() - t0, memoryBytes: k.memoryBytes() });
  }
};
function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

// src/pool/worker-source.ts
var WORKER_SOURCE = '"use strict";\n(() => {\n  // src/wasm/loader.ts\n  var CmoExit = class extends Error {\n    code;\n    constructor(code) {\n      super(`cpuminer-opt called exit(${code})`);\n      this.code = code;\n    }\n  };\n  var ESPIPE = 70;\n  var decoder = new TextDecoder();\n  async function instantiate(module, onOutput = () => {\n  }) {\n    let memory;\n    const pending = /* @__PURE__ */ new Map();\n    const imports = {\n      env: {\n        emscripten_notify_memory_growth: () => {\n        }\n      },\n      wasi_snapshot_preview1: {\n        fd_write(fd, iovs, iovsLen, nwritten) {\n          const view = new DataView(memory.buffer);\n          const bytes = new Uint8Array(memory.buffer);\n          let total = 0;\n          let text = pending.get(fd) ?? "";\n          for (let i = 0; i < iovsLen; i++) {\n            const ptr = view.getUint32(iovs + i * 8, true);\n            const len = view.getUint32(iovs + i * 8 + 4, true);\n            text += decoder.decode(bytes.subarray(ptr, ptr + len));\n            total += len;\n          }\n          const lines = text.split("\\n");\n          pending.set(fd, lines.pop() ?? "");\n          for (const line of lines) if (line.trim()) onOutput(line);\n          view.setUint32(nwritten, total, true);\n          return 0;\n        },\n        fd_close: () => 0,\n        fd_seek: () => ESPIPE,\n        proc_exit(code) {\n          throw new CmoExit(code);\n        }\n      }\n    };\n    const instance = await WebAssembly.instantiate(module, imports);\n    const exports = instance.exports;\n    memory = exports.memory;\n    exports._initialize?.();\n    return exports;\n  }\n\n  // src/wasm/api.ts\n  var ABI_VERSION = 1;\n  var MAX_SOLUTIONS = 64;\n  var SOLUTION_BYTES = 240;\n  var SOLUTION_LEGACY = 1;\n  var DATA_WORDS = 48;\n  var Cmo = class _Cmo {\n    raw;\n    fns;\n    encoder = new TextEncoder();\n    decoder = new TextDecoder();\n    scanData = 0;\n    scanTarget = 0;\n    constructor(raw) {\n      this.raw = raw;\n      this.fns = raw;\n      const abi = this.call("cmo_abi_version");\n      if (abi !== ABI_VERSION) throw new Error(`cpuminer-opt-js ABI ${abi}, expected ${ABI_VERSION}`);\n    }\n    static async create(module, onOutput) {\n      return new _Cmo(await instantiate(module, onOutput));\n    }\n    get memory() {\n      return this.raw.memory;\n    }\n    call(name, ...args) {\n      const fn = this.fns[name];\n      if (typeof fn !== "function") throw new Error(`missing export ${name}`);\n      return fn(...args);\n    }\n    // ---------------------------------------------------------------- memory\n    malloc(size) {\n      const p = this.call("cmo_malloc", size);\n      if (!p) throw new RangeError(`WASM allocation of ${size} bytes failed`);\n      return p;\n    }\n    free(ptr) {\n      if (ptr) this.call("cmo_free", ptr);\n    }\n    bytes(ptr, len) {\n      return new Uint8Array(this.memory.buffer, ptr, len);\n    }\n    u32(ptr, words) {\n      return new Uint32Array(this.memory.buffer, ptr, words);\n    }\n    cstring(ptr) {\n      if (!ptr) return "";\n      const mem = new Uint8Array(this.memory.buffer);\n      let end = ptr;\n      while (mem[end] !== 0) end++;\n      return this.decoder.decode(mem.subarray(ptr, end));\n    }\n    withCString(s, fn) {\n      if (s == null) return fn(0);\n      const enc = this.encoder.encode(s);\n      const ptr = this.malloc(enc.length + 1);\n      try {\n        const mem = new Uint8Array(this.memory.buffer, ptr, enc.length + 1);\n        mem.set(enc);\n        mem[enc.length] = 0;\n        return fn(ptr);\n      } finally {\n        this.free(ptr);\n      }\n    }\n    withScratch(size, fn) {\n      const ptr = this.malloc(size);\n      try {\n        return fn(ptr);\n      } finally {\n        this.free(ptr);\n      }\n    }\n    // ------------------------------------------------------------ algorithms\n    algoCount() {\n      return this.call("cmo_algo_count");\n    }\n    algoName(id) {\n      const p = this.call("cmo_algo_name", id);\n      return p ? this.cstring(p) : null;\n    }\n    /** Resolves a name or alias ("scrypt:N" included). */\n    resolve(name) {\n      return this.withScratch(\n        4,\n        (out) => this.withCString(name, (s) => {\n          const id = this.call("cmo_algo_resolve", s, out);\n          return id < 0 ? null : { id, paramN: this.u32(out, 1)[0] | 0 };\n        })\n      );\n    }\n    /** Returns 0, -1 (registration failed) or -2 (thread init failed). */\n    init(id, opts = {}) {\n      return this.withCString(\n        opts.key ?? null,\n        (key) => this.call("cmo_init", id, opts.paramN ?? 0, opts.paramR ?? 0, key, opts.threadInit ? 1 : 0)\n      );\n    }\n    gateInfo() {\n      return this.withScratch(20, (out) => {\n        this.call("cmo_gate_info", out);\n        const w = new Int32Array(this.memory.buffer, out, 5);\n        return {\n          ntimeIndex: w[0],\n          nbitsIndex: w[1],\n          nonceIndex: w[2],\n          workCmpSize: w[3],\n          workDataSize: w[4],\n          targetFactor: this.call("cmo_target_factor")\n        };\n      });\n    }\n    /** Pending applog output from the C side (and clears it). */\n    drainLog() {\n      return this.withScratch(4, (lenPtr) => {\n        const p = this.call("cmo_log_drain", lenPtr);\n        const len = this.u32(lenPtr, 1)[0];\n        if (!len) return [];\n        return this.decoder.decode(new Uint8Array(this.memory.buffer, p, len)).split("\\n").filter(Boolean);\n      });\n    }\n    // ------------------------------------------------- work instance (jobs)\n    setUser(user) {\n      this.withCString(user, (p) => this.call("cmo_set_user", p));\n    }\n    subscribed(xnonce1, xnonce2Size) {\n      return this.withCString(xnonce1, (p) => this.call("cmo_stratum_subscribed", p, xnonce2Size)) === 0;\n    }\n    setExtranonce(xnonce1, xnonce2Size) {\n      return this.withCString(xnonce1, (p) => this.call("cmo_set_extranonce", p, xnonce2Size)) === 0;\n    }\n    setDifficulty(diff) {\n      this.call("cmo_set_difficulty", diff);\n    }\n    /** mining.notify params (the JSON array). */\n    notify(params) {\n      return this.withCString(JSON.stringify(params), (p) => this.call("cmo_notify", p)) === 0;\n    }\n    /** Builds work from the current job and advances extranonce2. 0 = no job. */\n    genWork() {\n      return this.call("cmo_gen_work") >>> 0;\n    }\n    workData(seq) {\n      const p = this.call("cmo_work_data", seq);\n      if (!p) throw new Error(`work ${seq} is gone`);\n      return this.u32(p, DATA_WORDS).slice();\n    }\n    workTarget(seq) {\n      const p = this.call("cmo_work_target", seq);\n      if (!p) throw new Error(`work ${seq} is gone`);\n      return this.u32(p, 8).slice();\n    }\n    workTargetDiff(seq) {\n      return this.call("cmo_work_targetdiff", seq);\n    }\n    workJobId(seq) {\n      return this.cstring(this.call("cmo_work_job_id", seq));\n    }\n    workHeight(seq) {\n      return this.call("cmo_work_height", seq);\n    }\n    netDiff() {\n      return this.call("cmo_net_diff");\n    }\n    /** mining.submit JSON for a solution of work `seq` (null if the work is gone). */\n    buildSubmit(seq, data) {\n      return this.withScratch(DATA_WORDS * 4 + 1024, (buf) => {\n        this.u32(buf, DATA_WORDS).set(data.subarray(0, DATA_WORDS));\n        const out = buf + DATA_WORDS * 4;\n        const len = this.call("cmo_build_submit", seq, buf, out);\n        return len < 0 ? null : this.cstring(out);\n      });\n    }\n    // ------------------------------------------------- scan instance (hashing)\n    setScanWork(data, target) {\n      if (!this.scanData) {\n        this.scanData = this.call("cmo_scan_data");\n        this.scanTarget = this.call("cmo_scan_target");\n      }\n      this.u32(this.scanData, DATA_WORDS).set(data.subarray(0, DATA_WORDS));\n      this.u32(this.scanTarget, 8).set(target.subarray(0, 8));\n    }\n    /** Scans nonces [start, end); returns hashes done. */\n    scan(start, end) {\n      return this.call("cmo_scan", start >>> 0, end >>> 0);\n    }\n    solutionCount() {\n      return this.call("cmo_solution_count");\n    }\n    solutions() {\n      const n = Math.min(this.solutionCount(), MAX_SOLUTIONS);\n      const base = this.call("cmo_solutions_ptr");\n      const out = [];\n      for (let i = 0; i < n; i++) {\n        const p = base + i * SOLUTION_BYTES;\n        out.push({\n          data: this.u32(p, DATA_WORDS).slice(),\n          hash: this.u32(p + 192, 8).slice(),\n          shareDiff: new Float64Array(this.memory.buffer, p + 224, 1)[0],\n          legacy: (this.u32(p + 232, 1)[0] & SOLUTION_LEGACY) !== 0\n        });\n      }\n      return out;\n    }\n    validHash(hash, target) {\n      return this.withScratch(64, (p) => {\n        this.u32(p, 8).set(hash);\n        this.u32(p + 32, 8).set(target);\n        return this.call("cmo_valid_hash", p, p + 32) === 1;\n      });\n    }\n    /** Direct single-nonce hash for algorithms with a direct entry point (quark); null otherwise. */\n    directHash(data, nonce) {\n      return this.withScratch(DATA_WORDS * 4 + 32, (p) => {\n        this.u32(p, DATA_WORDS).set(data.subarray(0, DATA_WORDS));\n        const rc = this.call("cmo_direct_hash", p, nonce >>> 0, p + DATA_WORDS * 4);\n        return rc === 0 ? this.u32(p + DATA_WORDS * 4, 8).slice() : null;\n      });\n    }\n    /** The deterministic 48-word input shared with the native golden harness. */\n    fixtureData() {\n      return this.withScratch(DATA_WORDS * 4, (p) => {\n        this.call("cmo_fixture_data", p);\n        return this.u32(p, DATA_WORDS).slice();\n      });\n    }\n    diffToTarget(diff) {\n      return this.withScratch(32, (p) => {\n        this.call("cmo_diff_to_target", diff, p);\n        return this.u32(p, 8).slice();\n      });\n    }\n    // ---------------------------------------------------------------- verthash\n    /** Allocates `size` bytes in this instance for the verthash dataset. */\n    allocVerthash(size) {\n      return this.malloc(size);\n    }\n    setVerthash(ptr, size) {\n      this.call("cmo_verthash_set", ptr, size);\n    }\n    generateVerthash(ptr, size) {\n      return this.call("cmo_verthash_generate", ptr, size);\n    }\n  };\n\n  // src/env/detect.ts\n  var SIMD_PROBE = new Uint8Array([\n    0,\n    97,\n    115,\n    109,\n    1,\n    0,\n    0,\n    0,\n    1,\n    5,\n    1,\n    96,\n    0,\n    1,\n    123,\n    3,\n    2,\n    1,\n    0,\n    10,\n    10,\n    1,\n    8,\n    0,\n    65,\n    0,\n    253,\n    15,\n    253,\n    98,\n    11\n  ]);\n  var RELAXED_SIMD_PROBE = new Uint8Array([\n    0,\n    97,\n    115,\n    109,\n    1,\n    0,\n    0,\n    0,\n    1,\n    5,\n    1,\n    96,\n    0,\n    1,\n    123,\n    3,\n    2,\n    1,\n    0,\n    10,\n    15,\n    1,\n    13,\n    0,\n    65,\n    1,\n    253,\n    15,\n    65,\n    2,\n    253,\n    15,\n    253,\n    128,\n    2,\n    11\n  ]);\n  var EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);\n  async function nodeBuiltin(name) {\n    const specifier = `node:${name}`;\n    return await import(\n      /* @vite-ignore */\n      /* webpackIgnore: true */\n      specifier\n    );\n  }\n\n  // src/backends/registry.ts\n  var factories = /* @__PURE__ */ new Map();\n  function registerBackend(factory) {\n    factories.set(factory.name, factory);\n  }\n  function getBackend(name) {\n    const f = factories.get(name);\n    if (!f) throw new Error(`unknown backend ${name}`);\n    return f;\n  }\n  var SHA256_FAMILY = /* @__PURE__ */ new Set(["sha256d", "sha256t", "sha256q"]);\n\n  // src/backends/wasm.ts\n  var MAX_NONCE = 4294967295;\n  var SHA256_KIND = { sha256d: 2, sha256t: 3, sha256q: 4 };\n  var VERTHASH_SIZE = 1283457024;\n  async function loadVerthash(cmo, file) {\n    const fs = await nodeBuiltin("fs");\n    const size = fs.statSync(file).size;\n    if (size !== VERTHASH_SIZE) throw new Error(`${file} is ${size} bytes, expected ${VERTHASH_SIZE}`);\n    const ptr = cmo.allocVerthash(size);\n    const fd = fs.openSync(file, "r");\n    try {\n      for (let off = 0; off < size; ) {\n        const len = Math.min(1 << 26, size - off);\n        const n = fs.readSync(fd, cmo.bytes(ptr + off, len), 0, len, off);\n        if (n <= 0) throw new Error(`short read of ${file}`);\n        off += n;\n      }\n    } finally {\n      fs.closeSync(fd);\n    }\n    cmo.setVerthash(ptr, size);\n  }\n  var WasmKernel = class {\n    backend;\n    granularity = 16;\n    cmo;\n    fast;\n    constructor(backend, cmo, fast) {\n      this.backend = backend;\n      this.cmo = cmo;\n      this.fast = fast;\n    }\n    scan(job) {\n      this.cmo.setScanWork(job.data, job.target);\n      const hashesDone = this.fast ? this.cmo.call("cmo_sha256_fast_scan", this.fast.kind, this.fast.lanes, job.start >>> 0, job.end) : this.cmo.scan(job.start, Math.min(job.end, MAX_NONCE));\n      const solutions = this.cmo.solutions().map((s) => ({\n        seq: job.seq,\n        data: s.data,\n        hash: s.hash,\n        shareDiff: s.shareDiff\n      }));\n      return { hashesDone, solutions };\n    }\n    memoryBytes() {\n      return this.cmo.memory.buffer.byteLength;\n    }\n    dispose() {\n    }\n  };\n  async function createKernel(setup, fastLanes) {\n    if (!setup.module) throw new Error(`${setup.backend}: no compiled module supplied`);\n    const cmo = await Cmo.create(setup.module);\n    const algo = setup.algo;\n    if (algo.name === "verthash") {\n      if (!setup.verthash) throw new Error("verthash needs a dataset file (verthashFile option)");\n      await loadVerthash(cmo, setup.verthash.file);\n    }\n    const rc = cmo.init(algo.id, { paramN: algo.paramN, paramR: algo.paramR, key: algo.key, threadInit: true });\n    if (rc !== 0) {\n      const log = cmo.drainLog().join(" | ");\n      throw new Error(`cpuminer-opt failed to initialise ${algo.name} (${rc})${log ? `: ${log}` : ""}`);\n    }\n    const fast = fastLanes ? { kind: SHA256_KIND[algo.name], lanes: fastLanes } : null;\n    return new WasmKernel(setup.backend, cmo, fast);\n  }\n  function wasmUnsupported(algo, caps) {\n    if (!caps.wasm.available) return "WebAssembly is unavailable (or blocked by a Content Security Policy)";\n    if (!caps.wasm.simd128) return "needs WebAssembly SIMD (Chrome 91+, Firefox 89+, Safari 16.4+, Node 16.4+)";\n    if (algo.name === "verthash" && caps.runtime !== "node") return "verthash needs Node (1.28 GB dataset per worker)";\n    if (algo.name === "bmw") return "bmw is not registered by cpuminer-opt v26.1";\n    return null;\n  }\n  var variantPriority = { avx2: 20, sse42: 21, sse41: 22 };\n  for (const v of ["avx2", "sse42", "sse41"]) {\n    registerBackend({\n      name: `wasm-${v}`,\n      kind: "cpu",\n      priority: variantPriority[v],\n      unsupported: wasmUnsupported,\n      create: (setup) => createKernel(setup, null)\n    });\n  }\n  for (const lanes of [8, 4]) {\n    registerBackend({\n      name: `wasm-sha256-x${lanes}`,\n      kind: "cpu",\n      priority: lanes === 8 ? 10 : 11,\n      unsupported: (algo, caps) => !SHA256_FAMILY.has(algo.name) ? "only sha256d, sha256t and sha256q" : wasmUnsupported(algo, caps),\n      create: (setup) => createKernel(setup, lanes)\n    });\n  }\n\n  // src/backends/sha256-js.ts\n  var SHA256_IV = Uint32Array.of(\n    1779033703,\n    3144134277,\n    1013904242,\n    2773480762,\n    1359893119,\n    2600822924,\n    528734635,\n    1541459225\n  );\n  var SHA256_K = Uint32Array.of(\n    1116352408,\n    1899447441,\n    3049323471,\n    3921009573,\n    961987163,\n    1508970993,\n    2453635748,\n    2870763221,\n    3624381080,\n    310598401,\n    607225278,\n    1426881987,\n    1925078388,\n    2162078206,\n    2614888103,\n    3248222580,\n    3835390401,\n    4022224774,\n    264347078,\n    604807628,\n    770255983,\n    1249150122,\n    1555081692,\n    1996064986,\n    2554220882,\n    2821834349,\n    2952996808,\n    3210313671,\n    3336571891,\n    3584528711,\n    113926993,\n    338241895,\n    666307205,\n    773529912,\n    1294757372,\n    1396182291,\n    1695183700,\n    1986661051,\n    2177026350,\n    2456956037,\n    2730485921,\n    2820302411,\n    3259730800,\n    3345764771,\n    3516065817,\n    3600352804,\n    4094571909,\n    275423344,\n    430227734,\n    506948616,\n    659060556,\n    883997877,\n    958139571,\n    1322822218,\n    1537002063,\n    1747873779,\n    1955562222,\n    2024104815,\n    2227730452,\n    2361852424,\n    2428436474,\n    2756734187,\n    3204031479,\n    3329325298\n  );\n  var MAX_SOLUTIONS2 = 64;\n  var rotr = (x, n) => x >>> n | x << 32 - n;\n  var bsig0 = (x) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);\n  var bsig1 = (x) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);\n  var ssig0 = (x) => rotr(x, 7) ^ rotr(x, 18) ^ x >>> 3;\n  var ssig1 = (x) => rotr(x, 17) ^ rotr(x, 19) ^ x >>> 10;\n  function bswap32(x) {\n    return (x << 24 | (x & 65280) << 8 | x >>> 8 & 65280 | x >>> 24) >>> 0;\n  }\n  var W = new Int32Array(64);\n  function sha256Compress(state, block2, out = new Uint32Array(8)) {\n    for (let i = 0; i < 16; i++) W[i] = block2[i];\n    for (let i = 16; i < 64; i++) W[i] = ssig1(W[i - 2]) + W[i - 7] + ssig0(W[i - 15]) + W[i - 16] | 0;\n    let a = state[0] | 0, b = state[1] | 0, c = state[2] | 0, d = state[3] | 0;\n    let e = state[4] | 0, f = state[5] | 0, g2 = state[6] | 0, h = state[7] | 0;\n    for (let i = 0; i < 64; i++) {\n      const t1 = h + bsig1(e) + (g2 ^ e & (f ^ g2)) + SHA256_K[i] + W[i] | 0;\n      const t2 = bsig0(a) + (a & b | c & (a | b)) | 0;\n      h = g2;\n      g2 = f;\n      f = e;\n      e = d + t1 | 0;\n      d = c;\n      c = b;\n      b = a;\n      a = t1 + t2 | 0;\n    }\n    out[0] = state[0] + a;\n    out[1] = state[1] + b;\n    out[2] = state[2] + c;\n    out[3] = state[3] + d;\n    out[4] = state[4] + e;\n    out[5] = state[5] + f;\n    out[6] = state[6] + g2;\n    out[7] = state[7] + h;\n    return out;\n  }\n  function sha256Midstate(data, out) {\n    return sha256Compress(SHA256_IV, data, out);\n  }\n  var BLOCK1_W4 = 2147483648;\n  var BLOCK1_W15 = 640;\n  function sha256Prehash(data) {\n    const midstate = sha256Midstate(data);\n    const w0 = data[16] | 0, w1 = data[17] | 0, w2 = data[18] | 0;\n    let a = midstate[0] | 0, b = midstate[1] | 0, c = midstate[2] | 0, d = midstate[3] | 0;\n    let e = midstate[4] | 0, f = midstate[5] | 0, g2 = midstate[6] | 0, h = midstate[7] | 0;\n    const w = [w0, w1, w2];\n    for (let i = 0; i < 3; i++) {\n      const t12 = h + bsig1(e) + (g2 ^ e & (f ^ g2)) + SHA256_K[i] + w[i] | 0;\n      const t22 = bsig0(a) + (a & b | c & (a | b)) | 0;\n      h = g2;\n      g2 = f;\n      f = e;\n      e = d + t12 | 0;\n      d = c;\n      c = b;\n      b = a;\n      a = t12 + t22 | 0;\n    }\n    const t1 = h + bsig1(e) + (g2 ^ e & (f ^ g2)) + SHA256_K[3] | 0;\n    const t2 = bsig0(a) + (a & b | c & (a | b)) | 0;\n    const state4 = Uint32Array.of(t1 + t2, a, b, c, d + t1, e, f, g2);\n    const x0 = ssig0(w1) + w0 | 0;\n    const x1 = ssig1(BLOCK1_W15) + ssig0(w2) + w1 | 0;\n    const x = Uint32Array.of(\n      x0,\n      x1,\n      ssig1(x0) + w2,\n      ssig1(x1) + ssig0(BLOCK1_W4),\n      ssig0(BLOCK1_W15),\n      ssig0(x0) + BLOCK1_W15,\n      ssig0(x1) + x0\n    );\n    return { midstate, state4, x };\n  }\n  function sha256Passes(algo) {\n    switch (algo) {\n      case "sha256d":\n        return 2;\n      case "sha256t":\n        return 3;\n      case "sha256q":\n        return 4;\n      default:\n        throw new Error(`not a sha256 family algorithm: ${algo}`);\n    }\n  }\n  var block = new Uint32Array(16);\n  function sha256HashNonce(data, nonce, passes, out = new Uint32Array(8), midstate) {\n    if (midstate) out.set(midstate);\n    else sha256Midstate(data, out);\n    block.fill(0);\n    block[0] = data[16];\n    block[1] = data[17];\n    block[2] = data[18];\n    block[3] = nonce;\n    block[4] = BLOCK1_W4;\n    block[15] = BLOCK1_W15;\n    sha256Compress(out, block, out);\n    for (let i = 1; i < passes; i++) {\n      block.set(out);\n      block[8] = 2147483648;\n      block.fill(0, 9, 15);\n      block[15] = 256;\n      sha256Compress(SHA256_IV, block, out);\n    }\n    for (let i = 0; i < 8; i++) out[i] = bswap32(out[i]);\n    return out;\n  }\n  function validHash(hash, target) {\n    for (let i = 7; i >= 0; i--) {\n      const h = hash[i] >>> 0, t = target[i] >>> 0;\n      if (h !== t) return h < t;\n    }\n    return true;\n  }\n  var TWO_224 = 1n << 224n;\n  function shareDiff(hash) {\n    const h = BigInt(hash[7] >>> 0) << 96n | BigInt(hash[6] >>> 0) << 64n | BigInt(hash[5] >>> 0) << 32n | BigInt(hash[4] >>> 0);\n    if (h === 0n) return Infinity;\n    let q = TWO_224 / h;\n    if (q * h !== TWO_224) q |= 1n;\n    return Number(q) * 2 ** -128;\n  }\n  function checkScanJob(job) {\n    const { start, end } = job;\n    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > 2 ** 32) {\n      throw new RangeError(`invalid nonce range [${start}, ${end})`);\n    }\n    if (!job.data || job.data.length < 20) throw new RangeError("work data needs at least 20 words");\n    if (!job.target || job.target.length < 8) throw new RangeError("target needs 8 words");\n  }\n  function makeSolution(job, nonce, hash) {\n    const data = job.data.slice();\n    data[19] = nonce;\n    return { seq: job.seq, data, hash: hash.slice(), shareDiff: shareDiff(hash) };\n  }\n\n  // src/backends/js.ts\n  var PARAM_WORDS = 24;\n  var JsSha256Kernel = class {\n    backend = "js";\n    granularity = 1;\n    passes;\n    params = new Int32Array(PARAM_WORDS);\n    io = new Int32Array(8);\n    hash = new Uint32Array(8);\n    constructor(algo) {\n      this.passes = sha256Passes(algo);\n    }\n    scan(job) {\n      checkScanJob(job);\n      const { data, target, start, end } = job;\n      const pre = sha256Prehash(data);\n      const p = this.params;\n      p.set(pre.midstate, 0);\n      p.set(pre.state4, 8);\n      p.set(pre.x, 16);\n      p[23] = target[7] ^ 2147483648;\n      const extra = this.passes - 2;\n      const solutions = [];\n      for (let n = start; n < end; ) {\n        const c = scanRange(p, n, end, extra, this.io);\n        if (c < 0) break;\n        if (solutions.length < MAX_SOLUTIONS2) {\n          const hash = sha256HashNonce(data, c, this.passes, this.hash, pre.midstate);\n          if (validHash(hash, target)) solutions.push(makeSolution(job, c, hash));\n        }\n        n = c + 1;\n      }\n      return { hashesDone: end - start, solutions };\n    }\n    memoryBytes() {\n      return (PARAM_WORDS + 16) * 4;\n    }\n    dispose() {\n    }\n  };\n  function createJsKernel(setup) {\n    if (!SHA256_FAMILY.has(setup.algo.name)) throw new Error(`js backend does not implement ${setup.algo.name}`);\n    return new JsSha256Kernel(setup.algo.name);\n  }\n  var jsBackend = {\n    name: "js",\n    kind: "cpu",\n    priority: 50,\n    unsupported(algo) {\n      return SHA256_FAMILY.has(algo.name) ? null : `js implements ${[...SHA256_FAMILY].join(", ")} only`;\n    },\n    async create(setup) {\n      return createJsKernel(setup);\n    }\n  };\n  registerBackend(jsBackend);\n  function pass32(io) {\n    let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g2 = 0, h = 0, t = 0, x = 0, y = 0;\n    let w0 = io[0], w1 = io[1], w2 = io[2], w3 = io[3], w4 = io[4], w5 = io[5], w6 = io[6], w7 = io[7];\n    let w8 = 0, w9 = 0, w10 = 0, w11 = 0, w12 = 0, w13 = 0, w14 = 0, w15 = 0;\n    t = 4084723048 + w0 | 0;\n    d = 2773480762 + t | 0;\n    h = 143694565 + t | 0;\n    t = 2428182076 + w1 + (2600822924 ^ d & 3389733619) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n    c = 1013904242 + t | 0;\n    x = h ^ 1779033703;\n    g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (1779033703 ^ x & 3513665762) + t | 0;\n    t = 1355179099 + w2 + (1359893119 ^ c & (d ^ 1359893119)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n    b = 3144134277 + t | 0;\n    y = g2 ^ h;\n    f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n    t = 985935396 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n    a = 1779033703 + t | 0;\n    x = f ^ g2;\n    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n    t = d + 961987163 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n    h = h + t | 0;\n    y = e ^ f;\n    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n    t = c + 1508970993 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n    g2 = g2 + t | 0;\n    x = d ^ e;\n    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n    t = b + 2453635748 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n    f = f + t | 0;\n    y = c ^ d;\n    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n    t = a + 2870763221 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n    e = e + t | 0;\n    x = b ^ c;\n    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n    t = h + 1476897432 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n    d = d + t | 0;\n    y = a ^ b;\n    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n    t = g2 + 310598401 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n    c = c + t | 0;\n    x = h ^ a;\n    g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n    t = f + 607225278 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n    b = b + t | 0;\n    y = g2 ^ h;\n    f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n    t = e + 1426881987 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n    a = a + t | 0;\n    x = f ^ g2;\n    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n    t = d + 1925078388 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n    h = h + t | 0;\n    y = e ^ f;\n    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n    t = c + 2162078206 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n    g2 = g2 + t | 0;\n    x = d ^ e;\n    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n    t = b + 2614888103 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n    f = f + t | 0;\n    y = c ^ d;\n    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n    t = a + 3248222836 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n    e = e + t | 0;\n    x = b ^ c;\n    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n    w0 = w0 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) | 0;\n    t = h + 3835390401 + w0 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n    d = d + t | 0;\n    y = a ^ b;\n    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n    w1 = w1 + 10485760 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) | 0;\n    t = g2 + 4022224774 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n    c = c + t | 0;\n    x = h ^ a;\n    g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n    w2 = w2 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;\n    t = f + 264347078 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n    b = b + t | 0;\n    y = g2 ^ h;\n    f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n    w3 = w3 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;\n    t = e + 604807628 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n    a = a + t | 0;\n    x = f ^ g2;\n    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n    w4 = w4 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n    t = d + 770255983 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n    h = h + t | 0;\n    y = e ^ f;\n    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n    w5 = w5 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;\n    t = c + 1249150122 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n    g2 = g2 + t | 0;\n    x = d ^ e;\n    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n    w6 = w6 + 256 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n    t = b + 1555081692 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n    f = f + t | 0;\n    y = c ^ d;\n    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n    w7 = w7 + w0 + 285220864 + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n    t = a + 1996064986 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n    e = e + t | 0;\n    x = b ^ c;\n    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n    w8 = 2147483648 + w1 + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n    t = h + 2554220882 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n    d = d + t | 0;\n    y = a ^ b;\n    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n    w9 = w2 + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n    t = g2 + 2821834349 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n    c = c + t | 0;\n    x = h ^ a;\n    g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n    w10 = w3 + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n    t = f + 2952996808 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n    b = b + t | 0;\n    y = g2 ^ h;\n    f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n    w11 = w4 + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n    t = e + 3210313671 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n    a = a + t | 0;\n    x = f ^ g2;\n    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n    w12 = w5 + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n    t = d + 3336571891 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n    h = h + t | 0;\n    y = e ^ f;\n    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n    w13 = w6 + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;\n    t = c + 3584528711 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n    g2 = g2 + t | 0;\n    x = d ^ e;\n    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n    w14 = 4194338 + w7 + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;\n    t = b + 113926993 + w14 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n    f = f + t | 0;\n    y = c ^ d;\n    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n    w15 = 256 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;\n    t = a + 338241895 + w15 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n    e = e + t | 0;\n    x = b ^ c;\n    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n    w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;\n    t = h + 666307205 + w0 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n    d = d + t | 0;\n    y = a ^ b;\n    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n    w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;\n    t = g2 + 773529912 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n    c = c + t | 0;\n    x = h ^ a;\n    g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n    w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;\n    t = f + 1294757372 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n    b = b + t | 0;\n    y = g2 ^ h;\n    f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n    w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;\n    t = e + 1396182291 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n    a = a + t | 0;\n    x = f ^ g2;\n    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n    w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n    t = d + 1695183700 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n    h = h + t | 0;\n    y = e ^ f;\n    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n    w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;\n    t = c + 1986661051 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n    g2 = g2 + t | 0;\n    x = d ^ e;\n    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n    w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n    t = b + 2177026350 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n    f = f + t | 0;\n    y = c ^ d;\n    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n    w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n    t = a + 2456956037 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n    e = e + t | 0;\n    x = b ^ c;\n    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n    w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n    t = h + 2730485921 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n    d = d + t | 0;\n    y = a ^ b;\n    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n    w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n    t = g2 + 2820302411 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n    c = c + t | 0;\n    x = h ^ a;\n    g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n    w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n    t = f + 3259730800 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n    b = b + t | 0;\n    y = g2 ^ h;\n    f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n    w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n    t = e + 3345764771 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n    a = a + t | 0;\n    x = f ^ g2;\n    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n    w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n    t = d + 3516065817 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n    h = h + t | 0;\n    y = e ^ f;\n    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n    w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;\n    t = c + 3600352804 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n    g2 = g2 + t | 0;\n    x = d ^ e;\n    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n    w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;\n    t = b + 4094571909 + w14 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n    f = f + t | 0;\n    y = c ^ d;\n    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n    w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;\n    t = a + 275423344 + w15 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n    e = e + t | 0;\n    x = b ^ c;\n    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n    w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;\n    t = h + 430227734 + w0 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n    d = d + t | 0;\n    y = a ^ b;\n    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n    w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;\n    t = g2 + 506948616 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n    c = c + t | 0;\n    x = h ^ a;\n    g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n    w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;\n    t = f + 659060556 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n    b = b + t | 0;\n    y = g2 ^ h;\n    f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n    w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;\n    t = e + 883997877 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n    a = a + t | 0;\n    x = f ^ g2;\n    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n    w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n    t = d + 958139571 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n    h = h + t | 0;\n    y = e ^ f;\n    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n    w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;\n    t = c + 1322822218 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n    g2 = g2 + t | 0;\n    x = d ^ e;\n    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n    w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n    t = b + 1537002063 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n    f = f + t | 0;\n    y = c ^ d;\n    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n    w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n    t = a + 1747873779 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n    e = e + t | 0;\n    x = b ^ c;\n    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n    w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n    t = h + 1955562222 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n    d = d + t | 0;\n    y = a ^ b;\n    h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n    w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n    t = g2 + 2024104815 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n    c = c + t | 0;\n    x = h ^ a;\n    g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n    w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n    t = f + 2227730452 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n    b = b + t | 0;\n    y = g2 ^ h;\n    f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n    w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n    t = e + 2361852424 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n    a = a + t | 0;\n    x = f ^ g2;\n    e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n    w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n    t = d + 2428436474 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n    h = h + t | 0;\n    y = e ^ f;\n    d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n    w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;\n    t = c + 2756734187 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n    g2 = g2 + t | 0;\n    x = d ^ e;\n    c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n    w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;\n    t = b + 3204031479 + w14 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n    f = f + t | 0;\n    y = c ^ d;\n    b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n    w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;\n    t = a + 3329325298 + w15 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n    e = e + t | 0;\n    x = b ^ c;\n    a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n    w0 = a + 1779033703 | 0;\n    w1 = b + 3144134277 | 0;\n    w2 = c + 1013904242 | 0;\n    w3 = d + 2773480762 | 0;\n    w4 = e + 1359893119 | 0;\n    w5 = f + 2600822924 | 0;\n    w6 = g2 + 528734635 | 0;\n    w7 = h + 1541459225 | 0;\n    io[0] = w0;\n    io[1] = w1;\n    io[2] = w2;\n    io[3] = w3;\n    io[4] = w4;\n    io[5] = w5;\n    io[6] = w6;\n    io[7] = w7;\n  }\n  function scanRange(p, n, end, extra, io) {\n    const m0 = p[0], m1 = p[1], m2 = p[2], m3 = p[3], m4 = p[4], m5 = p[5], m6 = p[6], m7 = p[7];\n    const sa = p[8], sb = p[9], sc = p[10], sd = p[11], se = p[12], sf = p[13], sg = p[14], sh = p[15];\n    const x0 = p[16], x1 = p[17], x2 = p[18], x3 = p[19], x4 = p[20], x5 = p[21], x6 = p[22];\n    const t7 = p[23];\n    const kx16 = x0 + 3835390401 | 0, kx17 = x1 + 4022224774 | 0, bc = sb ^ sc;\n    let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g2 = 0, h = 0, t = 0, x = 0, y = 0;\n    let w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0;\n    let w8 = 0, w9 = 0, w10 = 0, w11 = 0, w12 = 0, w13 = 0, w14 = 0, w15 = 0;\n    for (; n < end; n++) {\n      w3 = n | 0;\n      e = sa + w3 | 0;\n      a = se + w3 | 0;\n      t = sh + 3109470811 + (sg ^ a & (sf ^ sg)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = sd + t | 0;\n      x = e ^ sb;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (sb ^ x & bc) + t | 0;\n      t = sg + 1508970993 + (sf ^ h & (a ^ sf)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = sc + t | 0;\n      y = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;\n      t = sf + 2453635748 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = sb + t | 0;\n      x = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;\n      t = a + 2870763221 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      y = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;\n      t = h + 3624381080 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      x = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;\n      t = g2 + 310598401 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      y = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;\n      t = f + 607225278 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      x = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ x & y) + t | 0;\n      t = e + 1426881987 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      y = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ y & x) + t | 0;\n      t = d + 1925078388 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      x = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;\n      t = c + 2162078206 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      y = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;\n      t = b + 2614888103 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      x = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;\n      t = a + 3248223220 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      y = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;\n      t = h + kx16 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      x = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;\n      t = g2 + kx17 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      y = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;\n      w2 = x2 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) | 0;\n      t = f + 264347078 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      x = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ x & y) + t | 0;\n      w3 = x3 + w3 | 0;\n      t = e + 604807628 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      y = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ y & x) + t | 0;\n      w4 = 2147483648 + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n      t = d + 770255983 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      x = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;\n      w5 = (w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10;\n      t = c + 1249150122 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      y = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;\n      w6 = 640 + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n      t = b + 1555081692 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      x = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;\n      w7 = x0 + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n      t = a + 1996064986 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      y = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;\n      w8 = x1 + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n      t = h + 2554220882 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      x = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;\n      w9 = w2 + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n      t = g2 + 2821834349 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      y = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;\n      w10 = w3 + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n      t = f + 2952996808 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      x = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ x & y) + t | 0;\n      w11 = w4 + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n      t = e + 3210313671 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      y = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ y & x) + t | 0;\n      w12 = w5 + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n      t = d + 3336571891 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      x = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;\n      w13 = w6 + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;\n      t = c + 3584528711 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      y = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;\n      w14 = x4 + w7 + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;\n      t = b + 113926993 + w14 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      x = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;\n      w15 = x5 + w8 + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;\n      t = a + 338241895 + w15 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      y = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;\n      w0 = x6 + w9 + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;\n      t = h + 666307205 + w0 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      x = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;\n      w1 = x1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;\n      t = g2 + 773529912 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      y = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;\n      w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;\n      t = f + 1294757372 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      x = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ x & y) + t | 0;\n      w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;\n      t = e + 1396182291 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      y = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ y & x) + t | 0;\n      w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n      t = d + 1695183700 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      x = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;\n      w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;\n      t = c + 1986661051 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      y = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;\n      w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n      t = b + 2177026350 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      x = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;\n      w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n      t = a + 2456956037 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      y = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;\n      w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n      t = h + 2730485921 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      x = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;\n      w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n      t = g2 + 2820302411 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      y = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;\n      w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n      t = f + 3259730800 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      x = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ x & y) + t | 0;\n      w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n      t = e + 3345764771 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      y = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ y & x) + t | 0;\n      w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n      t = d + 3516065817 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      x = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;\n      w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;\n      t = c + 3600352804 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      y = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;\n      w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;\n      t = b + 4094571909 + w14 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      x = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;\n      w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;\n      t = a + 275423344 + w15 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      y = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;\n      w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;\n      t = h + 430227734 + w0 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      x = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;\n      w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;\n      t = g2 + 506948616 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      y = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;\n      w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;\n      t = f + 659060556 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      x = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ x & y) + t | 0;\n      w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;\n      t = e + 883997877 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      y = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ y & x) + t | 0;\n      w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n      t = d + 958139571 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      x = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;\n      w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;\n      t = c + 1322822218 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      y = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;\n      w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n      t = b + 1537002063 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      x = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;\n      w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n      t = a + 1747873779 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      y = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;\n      w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n      t = h + 1955562222 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      x = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ x & y) + t | 0;\n      w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n      t = g2 + 2024104815 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      y = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ y & x) + t | 0;\n      w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n      t = f + 2227730452 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      x = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ x & y) + t | 0;\n      w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n      t = e + 2361852424 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      y = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ y & x) + t | 0;\n      w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n      t = d + 2428436474 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      x = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ x & y) + t | 0;\n      w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;\n      t = c + 2756734187 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      y = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ y & x) + t | 0;\n      w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;\n      t = b + 3204031479 + w14 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      x = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ x & y) + t | 0;\n      w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;\n      t = a + 3329325298 + w15 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      y = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ y & x) + t | 0;\n      w0 = m0 + a | 0;\n      w1 = m1 + b | 0;\n      w2 = m2 + c | 0;\n      w3 = m3 + d | 0;\n      w4 = m4 + e | 0;\n      w5 = m5 + f | 0;\n      w6 = m6 + g2 | 0;\n      w7 = m7 + h | 0;\n      if (extra > 0) {\n        io[0] = w0;\n        io[1] = w1;\n        io[2] = w2;\n        io[3] = w3;\n        io[4] = w4;\n        io[5] = w5;\n        io[6] = w6;\n        io[7] = w7;\n        for (let i = 0; i < extra; i++) pass32(io);\n        w0 = io[0];\n        w1 = io[1];\n        w2 = io[2];\n        w3 = io[3];\n        w4 = io[4];\n        w5 = io[5];\n        w6 = io[6];\n        w7 = io[7];\n      }\n      t = 4084723048 + w0 | 0;\n      d = 2773480762 + t | 0;\n      h = 143694565 + t | 0;\n      t = 2428182076 + w1 + (2600822924 ^ d & 3389733619) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = 1013904242 + t | 0;\n      x = h ^ 1779033703;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (1779033703 ^ x & 3513665762) + t | 0;\n      t = 1355179099 + w2 + (1359893119 ^ c & (d ^ 1359893119)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = 3144134277 + t | 0;\n      y = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n      t = 985935396 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = 1779033703 + t | 0;\n      x = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n      t = d + 961987163 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      y = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n      t = c + 1508970993 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      x = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n      t = b + 2453635748 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      y = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n      t = a + 2870763221 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      x = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n      t = h + 1476897432 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      y = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n      t = g2 + 310598401 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      x = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n      t = f + 607225278 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      y = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n      t = e + 1426881987 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      x = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n      t = d + 1925078388 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      y = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n      t = c + 2162078206 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      x = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n      t = b + 2614888103 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      y = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n      t = a + 3248222836 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      x = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n      w0 = w0 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) | 0;\n      t = h + 3835390401 + w0 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      y = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n      w1 = w1 + 10485760 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) | 0;\n      t = g2 + 4022224774 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      x = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n      w2 = w2 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;\n      t = f + 264347078 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      y = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n      w3 = w3 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;\n      t = e + 604807628 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      x = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n      w4 = w4 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n      t = d + 770255983 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      y = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n      w5 = w5 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;\n      t = c + 1249150122 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      x = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n      w6 = w6 + 256 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n      t = b + 1555081692 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      y = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n      w7 = w7 + w0 + 285220864 + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n      t = a + 1996064986 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      x = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n      w8 = 2147483648 + w1 + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n      t = h + 2554220882 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      y = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n      w9 = w2 + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n      t = g2 + 2821834349 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      x = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n      w10 = w3 + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n      t = f + 2952996808 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      y = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n      w11 = w4 + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n      t = e + 3210313671 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      x = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n      w12 = w5 + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n      t = d + 3336571891 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      y = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n      w13 = w6 + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;\n      t = c + 3584528711 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      x = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n      w14 = 4194338 + w7 + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;\n      t = b + 113926993 + w14 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      y = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n      w15 = 256 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;\n      t = a + 338241895 + w15 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      x = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n      w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;\n      t = h + 666307205 + w0 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      y = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n      w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;\n      t = g2 + 773529912 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      x = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n      w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;\n      t = f + 1294757372 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      y = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n      w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;\n      t = e + 1396182291 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      x = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n      w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n      t = d + 1695183700 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      y = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n      w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;\n      t = c + 1986661051 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      x = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n      w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n      t = b + 2177026350 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      y = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n      w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n      t = a + 2456956037 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      x = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n      w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n      t = h + 2730485921 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      y = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n      w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n      t = g2 + 2820302411 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      x = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n      w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n      t = f + 3259730800 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      y = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n      w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n      t = e + 3345764771 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      x = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n      w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n      t = d + 3516065817 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      y = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n      w13 = w13 + w6 + ((w14 >>> 7 | w14 << 25) ^ (w14 >>> 18 | w14 << 14) ^ w14 >>> 3) + ((w11 >>> 17 | w11 << 15) ^ (w11 >>> 19 | w11 << 13) ^ w11 >>> 10) | 0;\n      t = c + 3600352804 + w13 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      x = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n      w14 = w14 + w7 + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ w15 >>> 3) + ((w12 >>> 17 | w12 << 15) ^ (w12 >>> 19 | w12 << 13) ^ w12 >>> 10) | 0;\n      t = b + 4094571909 + w14 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      y = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n      w15 = w15 + w8 + ((w0 >>> 7 | w0 << 25) ^ (w0 >>> 18 | w0 << 14) ^ w0 >>> 3) + ((w13 >>> 17 | w13 << 15) ^ (w13 >>> 19 | w13 << 13) ^ w13 >>> 10) | 0;\n      t = a + 275423344 + w15 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      x = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n      w0 = w0 + w9 + ((w1 >>> 7 | w1 << 25) ^ (w1 >>> 18 | w1 << 14) ^ w1 >>> 3) + ((w14 >>> 17 | w14 << 15) ^ (w14 >>> 19 | w14 << 13) ^ w14 >>> 10) | 0;\n      t = h + 430227734 + w0 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      y = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n      w1 = w1 + w10 + ((w2 >>> 7 | w2 << 25) ^ (w2 >>> 18 | w2 << 14) ^ w2 >>> 3) + ((w15 >>> 17 | w15 << 15) ^ (w15 >>> 19 | w15 << 13) ^ w15 >>> 10) | 0;\n      t = g2 + 506948616 + w1 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      x = h ^ a;\n      g2 = ((h >>> 2 | h << 30) ^ (h >>> 13 | h << 19) ^ (h >>> 22 | h << 10)) + (a ^ x & y) + t | 0;\n      w2 = w2 + w11 + ((w3 >>> 7 | w3 << 25) ^ (w3 >>> 18 | w3 << 14) ^ w3 >>> 3) + ((w0 >>> 17 | w0 << 15) ^ (w0 >>> 19 | w0 << 13) ^ w0 >>> 10) | 0;\n      t = f + 659060556 + w2 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      y = g2 ^ h;\n      f = ((g2 >>> 2 | g2 << 30) ^ (g2 >>> 13 | g2 << 19) ^ (g2 >>> 22 | g2 << 10)) + (h ^ y & x) + t | 0;\n      w3 = w3 + w12 + ((w4 >>> 7 | w4 << 25) ^ (w4 >>> 18 | w4 << 14) ^ w4 >>> 3) + ((w1 >>> 17 | w1 << 15) ^ (w1 >>> 19 | w1 << 13) ^ w1 >>> 10) | 0;\n      t = e + 883997877 + w3 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      x = f ^ g2;\n      e = ((f >>> 2 | f << 30) ^ (f >>> 13 | f << 19) ^ (f >>> 22 | f << 10)) + (g2 ^ x & y) + t | 0;\n      w4 = w4 + w13 + ((w5 >>> 7 | w5 << 25) ^ (w5 >>> 18 | w5 << 14) ^ w5 >>> 3) + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ w2 >>> 10) | 0;\n      t = d + 958139571 + w4 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      y = e ^ f;\n      d = ((e >>> 2 | e << 30) ^ (e >>> 13 | e << 19) ^ (e >>> 22 | e << 10)) + (f ^ y & x) + t | 0;\n      w5 = w5 + w14 + ((w6 >>> 7 | w6 << 25) ^ (w6 >>> 18 | w6 << 14) ^ w6 >>> 3) + ((w3 >>> 17 | w3 << 15) ^ (w3 >>> 19 | w3 << 13) ^ w3 >>> 10) | 0;\n      t = c + 1322822218 + w5 + (b ^ h & (a ^ b)) + ((h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7)) | 0;\n      g2 = g2 + t | 0;\n      x = d ^ e;\n      c = ((d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10)) + (e ^ x & y) + t | 0;\n      w6 = w6 + w15 + ((w7 >>> 7 | w7 << 25) ^ (w7 >>> 18 | w7 << 14) ^ w7 >>> 3) + ((w4 >>> 17 | w4 << 15) ^ (w4 >>> 19 | w4 << 13) ^ w4 >>> 10) | 0;\n      t = b + 1537002063 + w6 + (a ^ g2 & (h ^ a)) + ((g2 >>> 6 | g2 << 26) ^ (g2 >>> 11 | g2 << 21) ^ (g2 >>> 25 | g2 << 7)) | 0;\n      f = f + t | 0;\n      y = c ^ d;\n      b = ((c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10)) + (d ^ y & x) + t | 0;\n      w7 = w7 + w0 + ((w8 >>> 7 | w8 << 25) ^ (w8 >>> 18 | w8 << 14) ^ w8 >>> 3) + ((w5 >>> 17 | w5 << 15) ^ (w5 >>> 19 | w5 << 13) ^ w5 >>> 10) | 0;\n      t = a + 1747873779 + w7 + (h ^ f & (g2 ^ h)) + ((f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7)) | 0;\n      e = e + t | 0;\n      x = b ^ c;\n      a = ((b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10)) + (c ^ x & y) + t | 0;\n      w8 = w8 + w1 + ((w9 >>> 7 | w9 << 25) ^ (w9 >>> 18 | w9 << 14) ^ w9 >>> 3) + ((w6 >>> 17 | w6 << 15) ^ (w6 >>> 19 | w6 << 13) ^ w6 >>> 10) | 0;\n      t = h + 1955562222 + w8 + (g2 ^ e & (f ^ g2)) + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) | 0;\n      d = d + t | 0;\n      y = a ^ b;\n      h = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (b ^ y & x) + t | 0;\n      w9 = w9 + w2 + ((w10 >>> 7 | w10 << 25) ^ (w10 >>> 18 | w10 << 14) ^ w10 >>> 3) + ((w7 >>> 17 | w7 << 15) ^ (w7 >>> 19 | w7 << 13) ^ w7 >>> 10) | 0;\n      t = g2 + 2024104815 + w9 + (f ^ d & (e ^ f)) + ((d >>> 6 | d << 26) ^ (d >>> 11 | d << 21) ^ (d >>> 25 | d << 7)) | 0;\n      c = c + t | 0;\n      w10 = w10 + w3 + ((w11 >>> 7 | w11 << 25) ^ (w11 >>> 18 | w11 << 14) ^ w11 >>> 3) + ((w8 >>> 17 | w8 << 15) ^ (w8 >>> 19 | w8 << 13) ^ w8 >>> 10) | 0;\n      t = f + 2227730452 + w10 + (e ^ c & (d ^ e)) + ((c >>> 6 | c << 26) ^ (c >>> 11 | c << 21) ^ (c >>> 25 | c << 7)) | 0;\n      b = b + t | 0;\n      w11 = w11 + w4 + ((w12 >>> 7 | w12 << 25) ^ (w12 >>> 18 | w12 << 14) ^ w12 >>> 3) + ((w9 >>> 17 | w9 << 15) ^ (w9 >>> 19 | w9 << 13) ^ w9 >>> 10) | 0;\n      t = e + 2361852424 + w11 + (d ^ b & (c ^ d)) + ((b >>> 6 | b << 26) ^ (b >>> 11 | b << 21) ^ (b >>> 25 | b << 7)) | 0;\n      a = a + t | 0;\n      w12 = w12 + w5 + ((w13 >>> 7 | w13 << 25) ^ (w13 >>> 18 | w13 << 14) ^ w13 >>> 3) + ((w10 >>> 17 | w10 << 15) ^ (w10 >>> 19 | w10 << 13) ^ w10 >>> 10) | 0;\n      t = d + 2428436474 + w12 + (c ^ a & (b ^ c)) + ((a >>> 6 | a << 26) ^ (a >>> 11 | a << 21) ^ (a >>> 25 | a << 7)) | 0;\n      h = h + t | 0;\n      t = h + 1541459225 | 0;\n      if (((t << 24 | (t & 65280) << 8 | t >>> 8 & 65280 | t >>> 24) ^ 2147483648) <= t7) return n;\n    }\n    return -1;\n  }\n\n  // src/backends/node-crypto.ts\n  var NodeCryptoKernel = class {\n    backend = "node-crypto";\n    granularity = 1;\n    passes;\n    sha256;\n    header = new Uint8Array(80);\n    view = new DataView(this.header.buffer);\n    hash = new Uint32Array(8);\n    constructor(algo, sha256) {\n      this.passes = sha256Passes(algo);\n      this.sha256 = sha256;\n    }\n    scan(job) {\n      checkScanJob(job);\n      const { data, target, start, end } = job;\n      const { header, view, sha256, passes, hash } = this;\n      for (let i = 0; i < 19; i++) view.setUint32(i * 4, data[i]);\n      const t7 = target[7];\n      const solutions = [];\n      for (let n = start; n < end; n++) {\n        view.setUint32(76, n);\n        let digest = sha256(header);\n        for (let p = 1; p < passes; p++) digest = sha256(digest);\n        if (digest.readUInt32LE(28) > t7 || solutions.length >= MAX_SOLUTIONS2) continue;\n        for (let i = 0; i < 8; i++) hash[i] = digest.readUInt32LE(i * 4);\n        if (validHash(hash, target)) solutions.push(makeSolution(job, n, hash));\n      }\n      return { hashesDone: end - start, solutions };\n    }\n    memoryBytes() {\n      return this.header.byteLength + this.hash.byteLength;\n    }\n    dispose() {\n    }\n  };\n  async function createNodeCryptoKernel(setup) {\n    if (!SHA256_FAMILY.has(setup.algo.name)) throw new Error(`node-crypto backend does not implement ${setup.algo.name}`);\n    const crypto = await nodeBuiltin("crypto");\n    const one = crypto.hash;\n    const sha256 = typeof one === "function" ? (b) => one("sha256", b, "buffer") : (b) => crypto.createHash("sha256").update(b).digest();\n    return new NodeCryptoKernel(setup.algo.name, sha256);\n  }\n  var nodeCryptoBackend = {\n    name: "node-crypto",\n    kind: "cpu",\n    priority: 40,\n    unsupported(algo, caps) {\n      if (!caps.nodeCrypto) return "node:crypto is not available";\n      return SHA256_FAMILY.has(algo.name) ? null : `node-crypto implements ${[...SHA256_FAMILY].join(", ")} only`;\n    },\n    create: createNodeCryptoKernel\n  };\n  registerBackend(nodeCryptoBackend);\n\n  // src/backends/webgpu.ts\n  var WORKGROUP_SIZE = 256;\n  var CANDIDATE_CAP = 64;\n  var DISPATCH_NONCES = 1 << 24;\n  var DISPATCHES_PER_SUBMIT = 16;\n  var BUFFER_MAP_READ = 1;\n  var BUFFER_COPY_SRC = 4;\n  var BUFFER_COPY_DST = 8;\n  var BUFFER_UNIFORM = 64;\n  var BUFFER_STORAGE = 128;\n  var MAP_READ = 1;\n  var STAGE_COMPUTE = 4;\n  var PARAM_WORDS2 = 32;\n  var isNum = (v) => typeof v === "number";\n  var hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, "0")}u`;\n  var lit = (v) => isNum(v) ? hex(v) : v;\n  var rotr2 = (x, n) => (x >>> n | x << 32 - n) >>> 0;\n  var FOLD = {\n    bsig0: (x) => (rotr2(x, 2) ^ rotr2(x, 13) ^ rotr2(x, 22)) >>> 0,\n    bsig1: (x) => (rotr2(x, 6) ^ rotr2(x, 11) ^ rotr2(x, 25)) >>> 0,\n    ssig0: (x) => (rotr2(x, 7) ^ rotr2(x, 18) ^ x >>> 3) >>> 0,\n    ssig1: (x) => (rotr2(x, 17) ^ rotr2(x, 19) ^ x >>> 10) >>> 0\n  };\n  var fn1 = (name, v) => isNum(v) ? FOLD[name](v) : `${name}(${v})`;\n  var ch = (e, f, g2) => isNum(e) && isNum(f) && isNum(g2) ? (g2 ^ e & (f ^ g2)) >>> 0 : `ch(${lit(e)}, ${lit(f)}, ${lit(g2)})`;\n  var maj = (a, b, c) => isNum(a) && isNum(b) && isNum(c) ? (a & b | c & (a | b)) >>> 0 : `maj(${lit(a)}, ${lit(b)}, ${lit(c)})`;\n  function sum(terms) {\n    let c = 0;\n    let at = -1;\n    let vars = 0;\n    const parts = [];\n    for (const t of terms) {\n      if (isNum(t)) {\n        if (at < 0) {\n          at = parts.length;\n          parts.push("");\n        }\n        c = c + t >>> 0;\n      } else {\n        parts.push(t);\n        vars++;\n      }\n    }\n    if (!vars) return c;\n    if (at >= 0) {\n      if (c) parts[at] = hex(c);\n      else parts.splice(at, 1);\n    }\n    return parts.join(" + ");\n  }\n  var LETTERS = "abcdefgh";\n  var Rounds = class {\n    out = [];\n    w = [];\n    val = /* @__PURE__ */ new Map();\n    ind;\n    constructor(indent) {\n      this.ind = indent;\n    }\n    line(s) {\n      this.out.push(this.ind + s);\n    }\n    letter(j, r) {\n      return LETTERS[j - r & 7];\n    }\n    get(name) {\n      return this.val.get(name) ?? name;\n    }\n    set(name, v) {\n      if (isNum(v)) {\n        this.val.set(name, v);\n        return;\n      }\n      this.val.delete(name);\n      this.line(`${name} = ${v};`);\n    }\n    /** Starts at round r; a null value means its letter already holds it. */\n    start(r, values) {\n      this.val.clear();\n      values.forEach((v, j) => {\n        if (v !== null) this.val.set(this.letter(j, r), v);\n      });\n    }\n    round(r, eOnly = false) {\n      const v = (j) => this.get(this.letter(j, r));\n      const w = this.w[r];\n      const kw = isNum(w) ? [SHA256_K[r] + w >>> 0] : [SHA256_K[r], w];\n      const t1 = sum([v(7), ...kw, ch(v(4), v(5), v(6)), fn1("bsig1", v(4))]);\n      let t = t1;\n      if (!isNum(t1)) {\n        this.line(`t = ${t1};`);\n        t = "t";\n      }\n      this.set(this.letter(3, r), sum([v(3), t]));\n      if (!eOnly) this.set(this.letter(7, r), sum([fn1("bsig0", v(0)), maj(v(0), v(1), v(2)), t]));\n    }\n    /** W[t] = s1(W[t-2]) + W[t-7] + s0(W[t-15]) + W[t-16], zero terms dropped. */\n    expand(t) {\n      const W2 = this.w;\n      this.assignW(t, sum([W2[t - 16], W2[t - 7], fn1("ssig0", W2[t - 15]), fn1("ssig1", W2[t - 2])]));\n    }\n    assignW(t, s) {\n      if (isNum(s)) {\n        this.w[t] = s;\n        return;\n      }\n      const name = `w${t & 15}`;\n      this.line(`${name} = ${s};`);\n      this.w[t] = name;\n    }\n  };\n  function pass32Rounds(g2, last, eOnlyFrom) {\n    g2.start(0, Array.from(SHA256_IV));\n    for (let i = 0; i < 8; i++) g2.w[i] = `w${i}`;\n    g2.w[8] = 2147483648;\n    for (let i = 9; i < 15; i++) g2.w[i] = 0;\n    g2.w[15] = 256;\n    for (let r = 0; r < last; r++) {\n      if (r >= 16) g2.expand(r);\n      g2.round(r, r >= eOnlyFrom);\n    }\n  }\n  var SHADER_HEAD = `struct Params {\n  mid: array<vec4<u32>, 2>, // midstate\n  st: array<vec4<u32>, 2>,  // block-1 a..h at round 4, without the nonce\n  x: array<vec4<u32>, 2>,   // schedule terms X0..X6\n  job: vec4<u32>,           // target[7], target[6], first nonce, nonce count\n  grid: vec4<u32>,          // invocations per grid row, output slot\n}\n\n@group(0) @binding(0) var<uniform> p: Params;\n@group(0) @binding(1) var<storage, read_write> found: array<atomic<u32>>;\n\nfn rotr(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }\nfn bsig0(x: u32) -> u32 { return rotr(x, 2u) ^ rotr(x, 13u) ^ rotr(x, 22u); }\nfn bsig1(x: u32) -> u32 { return rotr(x, 6u) ^ rotr(x, 11u) ^ rotr(x, 25u); }\nfn ssig0(x: u32) -> u32 { return rotr(x, 7u) ^ rotr(x, 18u) ^ (x >> 3u); }\nfn ssig1(x: u32) -> u32 { return rotr(x, 17u) ^ rotr(x, 19u) ^ (x >> 10u); }\nfn ch(e: u32, f: u32, g: u32) -> u32 { return g ^ (e & (f ^ g)); }\nfn maj(a: u32, b: u32, c: u32) -> u32 { return (a & b) | (c & (a | b)); }\nfn bswap(x: u32) -> u32 { return (x << 24u) | ((x & 0xff00u) << 8u) | ((x >> 8u) & 0xff00u) | (x >> 24u); }\n`;\n  var VARS = [\n    "var a = 0u; var b = 0u; var c = 0u; var d = 0u; var e = 0u; var f = 0u; var g = 0u; var h = 0u; var t = 0u;",\n    "var w8 = 0u; var w9 = 0u; var w10 = 0u; var w11 = 0u; var w12 = 0u; var w13 = 0u; var w14 = 0u; var w15 = 0u;"\n  ];\n  function shaderSource(passes, workgroupSize, cap) {\n    const L = [SHADER_HEAD];\n    if (passes > 2) {\n      const g3 = new Rounds("  ");\n      pass32Rounds(g3, 64, 64);\n      L.push(\n        "fn pass32(m: array<u32, 8>) -> array<u32, 8> {",\n        "  var w0 = m[0]; var w1 = m[1]; var w2 = m[2]; var w3 = m[3]; var w4 = m[4]; var w5 = m[5]; var w6 = m[6]; var w7 = m[7];",\n        ...VARS.map((v) => "  " + v),\n        ...g3.out,\n        `  return array<u32, 8>(${Array.from(SHA256_IV, (iv, j) => `${g3.get(LETTERS[j])} + ${hex(iv)}`).join(", ")});`,\n        "}",\n        ""\n      );\n    }\n    const g2 = new Rounds("  ");\n    g2.line("// Block 1: round 3 gets the nonce, then rounds 4..63.");\n    g2.line(`${g2.letter(0, 4)} = p.st[0].x + nonce;`);\n    g2.line(`${g2.letter(4, 4)} = p.st[1].x + nonce;`);\n    g2.start(4, [null, "p.st[0].y", "p.st[0].z", "p.st[0].w", null, "p.st[1].y", "p.st[1].z", "p.st[1].w"]);\n    const W2 = g2.w;\n    W2[3] = "w3";\n    W2[4] = 2147483648;\n    for (let i = 5; i < 15; i++) W2[i] = 0;\n    W2[15] = 640;\n    W2[16] = "x0";\n    W2[17] = "x1";\n    for (let r = 4; r < 18; r++) g2.round(r);\n    const s0 = (v) => fn1("ssig0", v);\n    const s1 = (v) => fn1("ssig1", v);\n    const plan = [\n      [18, ["x2", s0("w3")]],\n      [19, ["x3", "w3"]],\n      [20, [2147483648, s1("w2")]],\n      [21, [s1("w3")]],\n      [22, [640, s1("w4")]],\n      [23, ["x0", s1("w5")]],\n      [24, ["x1", s1("w6")]],\n      [25, ["w2", s1("w7")]],\n      [26, ["w3", s1("w8")]],\n      [27, ["w4", s1("w9")]],\n      [28, ["w5", s1("w10")]],\n      [29, ["w6", s1("w11")]],\n      [30, ["x4", "w7", s1("w12")]],\n      [31, ["x5", "w8", s1("w13")]],\n      [32, ["x6", "w9", s1("w14")]]\n    ];\n    for (const [r, terms] of plan) {\n      g2.assignW(r, sum(terms));\n      g2.round(r);\n    }\n    for (let r = 33; r < 64; r++) {\n      g2.expand(r);\n      g2.round(r);\n    }\n    for (let j = 0; j < 8; j++) g2.line(`w${j} = m${j} + ${g2.get(LETTERS[j])};`);\n    if (passes > 2) {\n      g2.line("var m = array<u32, 8>(w0, w1, w2, w3, w4, w5, w6, w7);");\n      for (let i = 2; i < passes; i++) g2.line("m = pass32(m);");\n      g2.line("w0 = m[0]; w1 = m[1]; w2 = m[2]; w3 = m[3]; w4 = m[4]; w5 = m[5]; w6 = m[6]; w7 = m[7];");\n    }\n    g2.line("// Final pass to round 60 (58..60 only need e): its e is the final word 7.");\n    pass32Rounds(g2, 61, 58);\n    const e60 = g2.letter(3, 60);\n    g2.line(`let h7 = bswap(${e60} + ${hex(SHA256_IV[7])});`);\n    g2.line("if (h7 > p.job.x) {");\n    g2.line("  return;");\n    g2.line("}");\n    g2.line("if (h7 == p.job.x) {");\n    const tie = new Rounds("    ");\n    tie.w.push(...g2.w);\n    tie.expand(61);\n    tie.round(61, true);\n    g2.out.push(...tie.out);\n    g2.line(`  if (bswap(${tie.letter(3, 61)} + ${hex(SHA256_IV[6])}) > p.job.y) {`);\n    g2.line("    return;");\n    g2.line("  }");\n    g2.line("}");\n    g2.line(`let slot = p.grid.y * ${cap + 1}u;`);\n    g2.line("let k = atomicAdd(&found[slot], 1u);");\n    g2.line(`if (k < ${cap}u) {`);\n    g2.line("  atomicStore(&found[slot + 1u + k], nonce);");\n    g2.line("}");\n    L.push(\n      `@compute @workgroup_size(${workgroupSize})`,\n      "fn main(@builtin(global_invocation_id) gid: vec3<u32>) {",\n      "  let i = gid.y * p.grid.x + gid.x;",\n      "  if (i >= p.job.w) {",\n      "    return;",\n      "  }",\n      "  let nonce = p.job.z + i;",\n      "  let m0 = p.mid[0].x; let m1 = p.mid[0].y; let m2 = p.mid[0].z; let m3 = p.mid[0].w;",\n      "  let m4 = p.mid[1].x; let m5 = p.mid[1].y; let m6 = p.mid[1].z; let m7 = p.mid[1].w;",\n      "  let x0 = p.x[0].x; let x1 = p.x[0].y; let x2 = p.x[0].z; let x3 = p.x[0].w;",\n      "  let x4 = p.x[1].x; let x5 = p.x[1].y; let x6 = p.x[1].z;",\n      "  var w0 = 0u; var w1 = 0u; var w2 = 0u; var w3 = nonce; var w4 = 0u; var w5 = 0u; var w6 = 0u; var w7 = 0u;",\n      ...VARS.map((v) => "  " + v),\n      ...g2.out,\n      "}",\n      ""\n    );\n    return L.join("\\n");\n  }\n  var WebGpuSha256Kernel = class _WebGpuSha256Kernel {\n    backend = "webgpu";\n    granularity;\n    device;\n    adapterInfo;\n    /** Work done so far: queue submissions, dispatches, 2D-grid dispatches, overflow re-scans, candidates. */\n    stats = { submissions: 0, dispatches: 0, grids2d: 0, rescans: 0, candidates: 0 };\n    passes;\n    ownsDevice;\n    pipeline;\n    bindGroup;\n    uniform;\n    found;\n    readback;\n    params;\n    slotWords;\n    cap;\n    dispatchNonces;\n    perSubmit;\n    maxGroups;\n    hash = new Uint32Array(8);\n    tail = Promise.resolve();\n    lost;\n    lostReason = null;\n    uncaptured = null;\n    disposed = false;\n    constructor(init) {\n      const { device } = init;\n      this.passes = init.passes;\n      this.device = device;\n      this.ownsDevice = init.ownsDevice;\n      this.adapterInfo = init.adapterInfo;\n      this.pipeline = init.pipeline;\n      this.granularity = init.workgroupSize;\n      this.cap = init.cap;\n      this.dispatchNonces = init.dispatchNonces;\n      this.perSubmit = init.perSubmit;\n      this.maxGroups = init.maxGroups;\n      this.slotWords = Math.max(256, device.limits.minUniformBufferOffsetAlignment) / 4;\n      this.params = new Uint32Array(this.slotWords * this.perSubmit);\n      const foundBytes = this.perSubmit * (this.cap + 1) * 4;\n      this.uniform = device.createBuffer({ size: this.params.byteLength, usage: BUFFER_UNIFORM | BUFFER_COPY_DST });\n      this.found = device.createBuffer({ size: foundBytes, usage: BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST });\n      this.readback = device.createBuffer({ size: foundBytes, usage: BUFFER_MAP_READ | BUFFER_COPY_DST });\n      this.bindGroup = device.createBindGroup({\n        layout: init.layout,\n        entries: [\n          { binding: 0, resource: { buffer: this.uniform, size: PARAM_WORDS2 * 4 } },\n          { binding: 1, resource: { buffer: this.found } }\n        ]\n      });\n      this.lost = device.lost.then((info) => {\n        this.lostReason = info.message || info.reason || "unknown reason";\n      });\n      device.addEventListener("uncapturederror", (ev) => {\n        this.uncaptured = ev.error.message;\n      });\n    }\n    static async create(setup, options = {}) {\n      if (!SHA256_FAMILY.has(setup.algo.name)) throw new Error(`webgpu backend does not implement ${setup.algo.name}`);\n      const passes = sha256Passes(setup.algo.name);\n      let device = options.device;\n      let info = device?.adapterInfo;\n      if (!device) {\n        const gpu = globalThis.navigator?.gpu;\n        if (!gpu) throw new Error("WebGPU is not available (no navigator.gpu)");\n        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });\n        if (!adapter) throw new Error("WebGPU: no adapter available");\n        info = adapter.info;\n        device = await adapter.requestDevice();\n      }\n      const adapterInfo = { vendor: info?.vendor ?? "", architecture: info?.architecture ?? "", description: info?.description ?? "" };\n      const ownsDevice = !options.device;\n      let kernel;\n      let failure;\n      device.pushErrorScope("validation");\n      try {\n        kernel = await _WebGpuSha256Kernel.build(device, ownsDevice, adapterInfo, passes, setup.algo.name, options);\n      } catch (err) {\n        failure = err;\n      }\n      const scope = await device.popErrorScope();\n      if (!failure && scope) failure = new Error(`WebGPU setup failed: ${scope.message}`);\n      if (failure) {\n        kernel?.dispose();\n        if (ownsDevice && !kernel) device.destroy();\n        throw failure;\n      }\n      return kernel;\n    }\n    static async build(device, ownsDevice, adapterInfo, passes, label, options) {\n      const limits = device.limits;\n      const workgroupSize = options.workgroupSize ?? Math.min(WORKGROUP_SIZE, limits.maxComputeWorkgroupSizeX);\n      if (workgroupSize > limits.maxComputeWorkgroupSizeX || workgroupSize > limits.maxComputeInvocationsPerWorkgroup) {\n        throw new Error(`WebGPU: workgroup size ${workgroupSize} exceeds the device limits`);\n      }\n      const maxGroups = Math.min(options.maxWorkgroupsPerDimension ?? Infinity, limits.maxComputeWorkgroupsPerDimension);\n      const cap = options.candidateCap ?? CANDIDATE_CAP;\n      const dispatchNonces = Math.min(options.dispatchNonces ?? DISPATCH_NONCES, 2 ** 31, workgroupSize * maxGroups * maxGroups);\n      const perSubmit = options.dispatchesPerSubmit ?? DISPATCHES_PER_SUBMIT;\n      if (!(workgroupSize >= 1 && cap >= 1 && dispatchNonces >= 1 && perSubmit >= 1 && maxGroups >= 1)) {\n        throw new Error("WebGPU: invalid kernel options");\n      }\n      const module = device.createShaderModule({ code: shaderSource(passes, workgroupSize, cap), label: `${label} scan` });\n      const info = await module.getCompilationInfo();\n      const errors = info.messages.filter((m) => m.type === "error");\n      if (errors.length) {\n        throw new Error(`WebGPU shader compilation failed: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("; ")}`);\n      }\n      const layout = device.createBindGroupLayout({\n        entries: [\n          { binding: 0, visibility: STAGE_COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAM_WORDS2 * 4 } },\n          { binding: 1, visibility: STAGE_COMPUTE, buffer: { type: "storage" } }\n        ]\n      });\n      const pipeline = await device.createComputePipelineAsync({\n        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),\n        compute: { module, entryPoint: "main" }\n      }).catch((err) => {\n        throw new Error(`WebGPU pipeline creation failed: ${err.message}`);\n      });\n      return new _WebGpuSha256Kernel({\n        passes,\n        device,\n        ownsDevice,\n        adapterInfo,\n        pipeline,\n        layout,\n        workgroupSize,\n        cap,\n        dispatchNonces,\n        perSubmit,\n        maxGroups\n      });\n    }\n    scan(job) {\n      const run = this.tail.then(() => this.run(job));\n      this.tail = run.catch(() => {\n      });\n      return run;\n    }\n    memoryBytes() {\n      return this.uniform.size + this.found.size + this.readback.size;\n    }\n    dispose() {\n      if (this.disposed) return;\n      this.disposed = true;\n      this.uniform.destroy();\n      this.found.destroy();\n      this.readback.destroy();\n      if (this.ownsDevice) this.device.destroy();\n    }\n    usable() {\n      if (this.disposed) throw new Error("webgpu kernel is disposed");\n      if (this.lostReason !== null) throw new Error(`WebGPU device lost: ${this.lostReason}`);\n      const uncaptured = this.uncaptured;\n      if (uncaptured !== null) {\n        this.uncaptured = null;\n        throw new Error(`WebGPU error: ${uncaptured}`);\n      }\n    }\n    async run(job) {\n      checkScanJob(job);\n      this.usable();\n      const { start, end } = job;\n      const pre = sha256Prehash(job.data);\n      this.setWork(pre, job.target);\n      const ranges = [];\n      for (let lo = start; lo < end; lo += this.dispatchNonces) ranges.push([lo, Math.min(end, lo + this.dispatchNonces)]);\n      const solutions = [];\n      await this.scanRanges(ranges, job, pre, solutions);\n      return { hashesDone: end - start, solutions };\n    }\n    /** Writes the per-work part of every dispatch slot. */\n    setWork(pre, target) {\n      for (let s = 0; s < this.perSubmit; s++) {\n        const o = s * this.slotWords;\n        this.params.set(pre.midstate, o);\n        this.params.set(pre.state4, o + 8);\n        this.params.set(pre.x, o + 16);\n        this.params[o + 24] = target[7];\n        this.params[o + 25] = target[6];\n      }\n    }\n    async scanRanges(ranges, job, pre, solutions) {\n      for (let i = 0; i < ranges.length; i += this.perSubmit) {\n        const batch = ranges.slice(i, i + this.perSubmit);\n        const results = await this.dispatch(batch);\n        for (let j = 0; j < batch.length; j++) {\n          if (solutions.length >= MAX_SOLUTIONS2) break;\n          const [lo, hi] = batch[j];\n          const { count, nonces } = results[j];\n          if (count > this.cap) {\n            this.stats.rescans++;\n            const mid = lo + Math.floor((hi - lo) / 2);\n            await this.scanRanges([[lo, mid], [mid, hi]], job, pre, solutions);\n            continue;\n          }\n          this.stats.candidates += count;\n          nonces.sort();\n          for (const n of nonces) {\n            const hash = sha256HashNonce(job.data, n, this.passes, this.hash, pre.midstate);\n            if (validHash(hash, job.target)) {\n              solutions.push(makeSolution(job, n, hash));\n              if (solutions.length >= MAX_SOLUTIONS2) break;\n            }\n          }\n        }\n      }\n    }\n    /** Runs up to perSubmit ranges in one submission and reads their candidates. */\n    async dispatch(batch) {\n      this.usable();\n      const { device, params, slotWords } = this;\n      const workgroupSize = this.granularity;\n      const grids = [];\n      batch.forEach(([lo, hi], s) => {\n        const groups = Math.ceil((hi - lo) / workgroupSize);\n        const gx = Math.min(groups, this.maxGroups);\n        const gy = Math.ceil(groups / gx);\n        const o = s * slotWords;\n        params[o + 26] = lo;\n        params[o + 27] = hi - lo;\n        params[o + 28] = gx * workgroupSize;\n        params[o + 29] = s;\n        grids.push([gx, gy]);\n      });\n      const foundBytes = batch.length * (this.cap + 1) * 4;\n      device.pushErrorScope("validation");\n      device.pushErrorScope("out-of-memory");\n      device.queue.writeBuffer(this.uniform, 0, params, 0, batch.length * slotWords);\n      const encoder = device.createCommandEncoder();\n      encoder.clearBuffer(this.found, 0, foundBytes);\n      const pass = encoder.beginComputePass();\n      pass.setPipeline(this.pipeline);\n      grids.forEach(([gx, gy], s) => {\n        pass.setBindGroup(0, this.bindGroup, [s * slotWords * 4]);\n        pass.dispatchWorkgroups(gx, gy);\n      });\n      pass.end();\n      encoder.copyBufferToBuffer(this.found, 0, this.readback, 0, foundBytes);\n      device.queue.submit([encoder.finish()]);\n      this.stats.submissions++;\n      this.stats.dispatches += grids.length;\n      this.stats.grids2d += grids.filter(([, gy]) => gy > 1).length;\n      const scopes = Promise.all([device.popErrorScope(), device.popErrorScope()]);\n      scopes.catch(() => {\n      });\n      let words;\n      try {\n        await this.readback.mapAsync(MAP_READ, 0, foundBytes);\n        words = new Uint32Array(this.readback.getMappedRange(0, foundBytes).slice(0));\n        this.readback.unmap();\n      } catch (err) {\n        await Promise.race([this.lost, new Promise((resolve) => setTimeout(resolve, 100))]);\n        if (this.disposed) throw new Error("webgpu kernel is disposed");\n        if (this.lostReason !== null) throw new Error(`WebGPU device lost: ${this.lostReason}`);\n        throw new Error(`WebGPU readback failed: ${err.message}`);\n      }\n      const errors = (await scopes).filter((e) => e !== null);\n      if (errors.length) throw new Error(`WebGPU dispatch failed: ${errors.map((e) => e.message).join("; ")}`);\n      return batch.map((_, s) => {\n        const o = s * (this.cap + 1);\n        const count = words[o];\n        return { count, nonces: words.slice(o + 1, o + 1 + Math.min(count, this.cap)) };\n      });\n    }\n  };\n  function createWebGpuKernel(setup, options) {\n    return WebGpuSha256Kernel.create(setup, options);\n  }\n  var webgpuBackend = {\n    name: "webgpu",\n    kind: "gpu",\n    priority: 5,\n    unsupported(algo, caps) {\n      if (!caps.webgpu) return "WebGPU is not available";\n      return SHA256_FAMILY.has(algo.name) ? null : `webgpu implements ${[...SHA256_FAMILY].join(", ")} only`;\n    },\n    create: (setup) => createWebGpuKernel(setup)\n  };\n  registerBackend(webgpuBackend);\n\n  // src/pool/scan-loop.ts\n  var now = () => typeof performance !== "undefined" ? performance.now() : Date.now();\n  function yieldTask() {\n    return new Promise((resolve) => {\n      const ch2 = new MessageChannel();\n      ch2.port1.onmessage = () => {\n        ch2.port1.close();\n        resolve();\n      };\n      ch2.port2.postMessage(0);\n    });\n  }\n  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n  var ScanLoop = class {\n    kernel = null;\n    current = null;\n    throttle = 0;\n    running = false;\n    disposed = false;\n    post;\n    constructor(post2) {\n      this.post = post2;\n    }\n    async handle(msg) {\n      try {\n        switch (msg.type) {\n          case "init": {\n            this.kernel = await getBackend(msg.setup.backend).create(msg.setup);\n            this.post({\n              type: "ready",\n              backend: this.kernel.backend,\n              memoryBytes: this.kernel.memoryBytes(),\n              granularity: this.kernel.granularity\n            });\n            break;\n          }\n          case "work":\n            this.current = { gen: msg.gen, job: msg.job, cursor: msg.job.start, chunk: this.align(msg.chunk) };\n            void this.run();\n            break;\n          case "chunk":\n            if (this.current) this.current.chunk = this.align(msg.chunk);\n            break;\n          case "throttle":\n            this.throttle = Math.min(0.95, Math.max(0, msg.value));\n            break;\n          case "stop":\n            this.current = null;\n            break;\n          case "bench":\n            await this.bench(msg.job, msg.warmupMs, msg.ms);\n            break;\n          case "dispose":\n            this.current = null;\n            this.disposed = true;\n            this.kernel?.dispose();\n            this.kernel = null;\n            break;\n        }\n      } catch (err) {\n        this.post({ type: "error", message: errorText(err), fatal: msg.type === "init" });\n      }\n    }\n    align(chunk) {\n      const g2 = this.kernel?.granularity ?? 1;\n      return Math.max(g2, Math.floor(chunk / g2) * g2);\n    }\n    async run() {\n      if (this.running) return;\n      this.running = true;\n      try {\n        while (this.current && this.kernel && !this.disposed) {\n          const cur = this.current;\n          const start = cur.cursor;\n          const end = Math.min(start + cur.chunk, cur.job.end);\n          const t0 = now();\n          const out = await this.kernel.scan({ ...cur.job, start, end });\n          const ms = now() - t0;\n          if (this.current !== cur) continue;\n          cur.cursor = end;\n          this.post({ type: "progress", gen: cur.gen, seq: cur.job.seq, hashes: out.hashesDone, ms, solutions: out.solutions, cursor: end });\n          if (end >= cur.job.end) {\n            this.post({ type: "exhausted", gen: cur.gen, seq: cur.job.seq });\n            if (this.current === cur) this.current = null;\n          }\n          if (this.throttle > 0) await sleep(ms * this.throttle / (1 - this.throttle));\n          else await yieldTask();\n        }\n      } catch (err) {\n        this.current = null;\n        this.post({ type: "error", message: errorText(err), fatal: false });\n      } finally {\n        this.running = false;\n      }\n    }\n    async bench(job, warmupMs, ms) {\n      if (!this.kernel) throw new Error("bench before init");\n      const k = this.kernel;\n      let chunk = Math.max(k.granularity, 256);\n      let n = job.start;\n      for (const tEnd = now() + warmupMs; now() < tEnd; ) {\n        const t02 = now();\n        await k.scan({ ...job, start: n, end: n + chunk });\n        n += chunk;\n        if (now() - t02 < 20) chunk *= 2;\n      }\n      let hashes = 0;\n      const t0 = now();\n      while (now() - t0 < ms) {\n        const out = await k.scan({ ...job, start: n, end: n + chunk });\n        hashes += out.hashesDone;\n        n += chunk;\n        if (n > 4026531840) n = job.start;\n      }\n      this.post({ type: "bench", hashes, ms: now() - t0, memoryBytes: k.memoryBytes() });\n    }\n  };\n  function errorText(err) {\n    return err instanceof Error ? err.message : String(err);\n  }\n\n  // src/pool/worker-entry.ts\n  var g = globalThis;\n  var nodePort = typeof g.process?.getBuiltinModule === "function" ? g.process.getBuiltinModule("node:worker_threads")?.parentPort ?? null : null;\n  var post = (msg) => {\n    if (nodePort) nodePort.postMessage(msg);\n    else g.postMessage(msg);\n  };\n  var loop = new ScanLoop(post);\n  var onMessage = (msg) => {\n    void loop.handle(msg).then(() => {\n      if (msg.type === "dispose") {\n        if (nodePort) nodePort.close();\n        else g.close?.();\n      }\n    });\n  };\n  if (nodePort) nodePort.on("message", onMessage);\n  else g.onmessage = (e) => onMessage(e.data);\n})();\n';

// src/pool/pool.ts
var blobUrl = null;
async function spawnChannel(inline) {
  if (inline) {
    let listener = () => {
    };
    const loop = new ScanLoop((m) => queueMicrotask(() => listener(m)));
    return {
      post: (m) => void loop.handle(m),
      onMessage: (cb) => listener = cb,
      terminate: () => void loop.handle({ type: "dispose" })
    };
  }
  if (detectRuntime() === "node") {
    const { Worker: Worker2 } = await nodeBuiltin("worker_threads");
    const w2 = WORKER_SOURCE ? new Worker2(WORKER_SOURCE, { eval: true }) : new Worker2(new URL("./worker-entry.ts", import.meta.url));
    w2.unref?.();
    return {
      post: (m) => w2.postMessage(m),
      onMessage: (cb) => w2.on("message", cb),
      terminate: () => void w2.terminate()
    };
  }
  if (!WORKER_SOURCE) throw new Error("browser workers need the built library (dist/)");
  blobUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const w = new Worker(blobUrl);
  return {
    post: (m) => w.postMessage(m),
    onMessage: (cb) => w.onmessage = (e) => cb(e.data),
    terminate: () => w.terminate()
  };
}
var WorkerPool = class _WorkerPool extends Emitter {
  size;
  backend;
  inline;
  channels = [];
  chunks = [];
  granularity = 1;
  memory = 0;
  chunkMs;
  /** One-shot waiters per worker for 'ready' and 'bench' replies. */
  waiters = /* @__PURE__ */ new Map();
  constructor(size, backend, inline, chunkMs) {
    super();
    this.size = size;
    this.backend = backend;
    this.inline = inline;
    this.chunkMs = chunkMs;
  }
  static async create(setup, size, opts = {}) {
    const pool = new _WorkerPool(size, setup.backend, !!opts.inline, opts.chunkMs ?? 100);
    try {
      await Promise.all(Array.from({ length: size }, (_, i) => pool.start(i, setup)));
    } catch (err) {
      pool.terminate();
      throw err;
    }
    if (opts.throttle) pool.setThrottle(opts.throttle);
    return pool;
  }
  async start(i, setup) {
    const ch2 = await spawnChannel(this.inline);
    this.channels[i] = ch2;
    this.chunks[i] = 4096;
    ch2.onMessage((m2) => this.route(i, m2));
    const m = await this.request(i, "ready", { type: "init", setup });
    if (m.type === "ready") {
      this.granularity = m.granularity;
      this.memory = Math.max(this.memory, m.memoryBytes);
    }
  }
  request(worker, type, msg) {
    return new Promise((resolve, reject) => {
      this.waiters.set(worker, { type, resolve, reject });
      this.channels[worker].post(msg);
    });
  }
  route(worker, m) {
    const w = this.waiters.get(worker);
    if (w && (m.type === w.type || m.type === "error" && (w.type === "bench" || m.fatal))) {
      this.waiters.delete(worker);
      if (m.type === "error") w.reject(new Error(m.message));
      else w.resolve(m);
      return;
    }
    this.dispatch(worker, m);
  }
  dispatch(worker, m) {
    switch (m.type) {
      case "progress": {
        if (m.ms > 0 && m.hashes > 0) {
          const ideal = m.hashes / m.ms * this.chunkMs;
          const next = Math.max(this.granularity, Math.min(ideal, 1 << 28));
          if (Math.abs(next - this.chunks[worker]) / this.chunks[worker] > 0.25) {
            this.chunks[worker] = Math.round(next);
            this.channels[worker]?.post({ type: "chunk", chunk: this.chunks[worker] });
          }
        }
        this.emit("progress", { worker, gen: m.gen, seq: m.seq, hashes: m.hashes, ms: m.ms, solutions: m.solutions });
        break;
      }
      case "exhausted":
        this.emit("exhausted", { worker, gen: m.gen, seq: m.seq });
        break;
      case "error":
        this.emit("error", { worker, message: m.message });
        break;
      default:
        break;
    }
  }
  /** Largest memory footprint reported by a worker (bytes). */
  memoryBytes() {
    return this.memory;
  }
  assign(worker, gen, job) {
    this.channels[worker]?.post({ type: "work", gen, job, chunk: this.chunks[worker] });
  }
  stop() {
    for (const ch2 of this.channels) ch2?.post({ type: "stop" });
  }
  setThrottle(value) {
    for (const ch2 of this.channels) ch2?.post({ type: "throttle", value });
  }
  /** One measurement on worker 0: hashes per second and memory. */
  async bench(job, warmupMs, ms) {
    const m = await this.request(0, "bench", { type: "bench", job, warmupMs, ms });
    if (m.type !== "bench") throw new Error("unexpected bench reply");
    this.memory = Math.max(this.memory, m.memoryBytes);
    return { hps: m.ms > 0 ? m.hashes / m.ms * 1e3 : 0, memoryBytes: m.memoryBytes };
  }
  terminate() {
    for (const w of this.waiters.values()) w.reject(new Error("pool terminated"));
    this.waiters.clear();
    for (const ch2 of this.channels) {
      try {
        ch2?.post({ type: "dispose" });
        ch2?.terminate();
      } catch {
      }
    }
    this.channels = [];
    this.removeAll();
  }
};

// src/tune/variant-prefs.ts
var VARIANT_PREFS = {
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

// src/tune/autotune.ts
function benchmarkJob() {
  const data = new Uint32Array(48);
  data[20] = 2147483648;
  data[31] = 640;
  const target = new Uint32Array(8);
  target[6] = 4294901760;
  return { seq: 0, data, target, start: 0, end: 4294967296 };
}
function cpuCandidates(algo, caps, mode) {
  const usable = listBackends().filter((f) => f.kind === "cpu" && !f.unsupported(algo, caps));
  if (mode === "thorough") return usable.map((f) => f.name);
  const names = new Set(usable.map((f) => f.name));
  const pref = `wasm-${VARIANT_PREFS[algo.name] ?? "sse41"}`;
  const quick = ["wasm-sha256-x8", "wasm-sha256-x4", pref, "wasm-sse41"].filter((n) => names.has(n));
  if (quick.length) return [...new Set(quick)];
  return ["node-crypto", "js"].filter((n) => names.has(n));
}
function defaultThreads(caps, gpu) {
  const base = caps.runtime === "node" ? caps.cores : Math.max(1, caps.cores - 1);
  return Math.max(1, base - (gpu ? 1 : 0));
}
async function measureCpu(backend, algo, caps, opts) {
  let pool = null;
  try {
    const setup = await kernelSetup(backend, algo, opts);
    pool = await WorkerPool.create(setup, 1, { inline: !caps.workers });
    const r = await pool.bench(benchmarkJob(), opts.warmupMs ?? 150, opts.measureMs ?? 400);
    return { backend, hps: r.hps, memoryBytes: r.memoryBytes };
  } catch (err) {
    return { backend, hps: 0, memoryBytes: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    pool?.terminate();
  }
}
async function measureGpu(kernel, targetMs = 50) {
  const job = benchmarkJob();
  let batch = 1 << 18;
  for (; ; ) {
    const t02 = performance.now();
    await kernel.scan({ ...job, start: 0, end: batch });
    const ms = performance.now() - t02;
    if (ms >= targetMs || batch >= 1 << 30) break;
    batch = Math.min(1 << 30, batch * Math.max(2, Math.floor(targetMs / Math.max(ms, 1))));
  }
  let hashes = 0;
  const t0 = performance.now();
  for (let i = 0; i < 3; i++) hashes += (await kernel.scan({ ...job, start: i * batch, end: (i + 1) * batch })).hashesDone;
  return { hps: hashes / (performance.now() - t0) * 1e3, batch };
}
async function autotune(algo, opts = {}) {
  const caps = opts.capabilities ?? await detect({ gpu: opts.gpu !== false });
  const mode = opts.mode ?? (caps.runtime === "node" ? "thorough" : "quick");
  const measurements = [];
  let gpu = null;
  const wantGpu = opts.gpu !== false && (opts.backend === "auto" || opts.backend === void 0 || opts.backend === "webgpu");
  const gpuFactory = listBackends().find((f) => f.kind === "gpu" && !f.unsupported(algo, caps));
  if (wantGpu && gpuFactory) {
    let kernel = null;
    try {
      kernel = await gpuFactory.create({ backend: gpuFactory.name, algo });
      const m = await measureGpu(kernel);
      measurements.push({ backend: gpuFactory.name, hps: m.hps, memoryBytes: kernel.memoryBytes() });
      if (m.hps > 0) gpu = { backend: "webgpu", batch: m.batch, hps: m.hps };
    } catch (err) {
      measurements.push({ backend: gpuFactory.name, hps: 0, memoryBytes: 0, error: err instanceof Error ? err.message : String(err) });
    } finally {
      kernel?.dispose();
    }
  }
  let cpu = null;
  if (opts.backend !== "webgpu") {
    const candidates = opts.backend && opts.backend !== "auto" ? [opts.backend] : cpuCandidates(algo, caps, mode);
    for (const b of candidates) measurements.push(await measureCpu(b, algo, caps, opts));
    const best = measurements.filter((m) => m.backend !== "webgpu" && m.hps > 0).sort((a, b) => b.hps - a.hps)[0];
    if (best) {
      let threads = typeof opts.threads === "number" ? opts.threads : defaultThreads(caps, !!gpu);
      if (opts.threads === void 0 || opts.threads === "auto") {
        const budget = (caps.memoryBytes ?? 4 * 2 ** 30) * 0.7;
        threads = Math.max(1, Math.min(threads, Math.floor(budget / Math.max(best.memoryBytes, 1))));
      }
      cpu = { backend: best.backend, threads, hpsPerThread: best.hps };
    }
  }
  if (!cpu && !gpu) {
    const why = measurements.map((m) => `${m.backend}: ${m.error ?? "no hashes"}`).join("; ");
    throw new Error(`no working backend for ${algo.name}${why ? ` (${why})` : ""}`);
  }
  const expectedHps = (cpu ? cpu.hpsPerThread * cpu.threads : 0) + (gpu ? gpu.hps : 0);
  return { algo, cpu, gpu, expectedHps, measurements, capabilities: caps };
}

// src/benchmark.ts
async function benchmark(opts) {
  const algo = resolveAlgo(opts.algo, opts.params);
  const plan = await autotune(algo, opts);
  const seconds = opts.seconds ?? 0;
  if (seconds <= 0) return { plan, totalHps: null, cpuHps: null, gpuHps: null };
  const ms = seconds * 1e3;
  let cpuHashes = 0;
  let gpuHashes = 0;
  let pool = null;
  const tasks = [];
  if (plan.cpu) {
    const setup = await kernelSetup(plan.cpu.backend, algo, opts);
    pool = await WorkerPool.create(setup, plan.cpu.threads, { inline: !plan.capabilities.workers });
    const p = pool;
    const span = Math.floor(4294967296 / plan.cpu.threads);
    p.on("progress", (e) => cpuHashes += e.hashes);
    for (let i = 0; i < plan.cpu.threads; i++) {
      p.assign(i, 1, { ...benchmarkJob(), start: i * span, end: (i + 1) * span });
    }
  }
  const t0 = performance.now();
  if (plan.gpu) {
    const kernel = await getBackend("webgpu").create({ backend: "webgpu", algo });
    const batch = plan.gpu.batch;
    tasks.push(
      (async () => {
        try {
          for (let n = 0; performance.now() - t0 < ms; n = (n + batch) % 4026531840) {
            gpuHashes += (await kernel.scan({ ...benchmarkJob(), start: n, end: n + batch })).hashesDone;
          }
        } finally {
          kernel.dispose();
        }
      })()
    );
  }
  await new Promise((r) => setTimeout(r, ms));
  pool?.stop();
  await Promise.all(tasks);
  const elapsed = (performance.now() - t0) / 1e3;
  pool?.terminate();
  const cpuHps = plan.cpu ? cpuHashes / elapsed : null;
  const gpuHps = plan.gpu ? gpuHashes / elapsed : null;
  return { plan, totalHps: (cpuHps ?? 0) + (gpuHps ?? 0), cpuHps, gpuHps };
}

// src/hash.ts
var instances = /* @__PURE__ */ new Map();
async function instanceFor(algo, params) {
  const spec = resolveAlgo(algo, params);
  if (spec.name === "verthash") throw new Error("hash(): verthash needs its dataset; use a miner or benchmark instead");
  const key = JSON.stringify(spec);
  let p = instances.get(key);
  if (!p) {
    p = (async () => {
      const cmo = await Cmo.create(await compileVariant("sse41"));
      const rc = cmo.init(spec.id, { paramN: spec.paramN, paramR: spec.paramR, key: spec.key, threadInit: true });
      if (rc !== 0) throw new Error(`cpuminer-opt failed to initialise ${spec.name} (${rc})`);
      return cmo;
    })();
    p.catch(() => instances.delete(key));
    instances.set(key, p);
  }
  return p;
}
async function hash(algo, header, params = {}) {
  if (header.length < 80) throw new RangeError("header must be at least 80 bytes");
  const cmo = await instanceFor(algo, params);
  const data = new Uint32Array(48);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  for (let i = 0; i < Math.min(48, header.length >> 2); i++) data[i] = view.getUint32(i * 4, false);
  if (header.length === 80) {
    data[20] = 2147483648;
    data[31] = 640;
  }
  const nonce = data[19];
  const direct = cmo.directHash(data, nonce);
  if (direct) return new Uint8Array(direct.buffer.slice(0));
  cmo.setScanWork(data, new Uint32Array(8).fill(4294967295));
  cmo.scan(nonce, Math.min(nonce + 16, 4294967295));
  const ni = cmo.gateInfo().nonceIndex;
  const s = cmo.solutions().find((x) => x.data[ni] === nonce && !x.legacy);
  if (s) return new Uint8Array(s.hash.buffer.slice(0));
  throw new Error(`hash(): cpuminer-opt's ${algo} scanner doesn't expose individual hashes`);
}

// src/stratum/transport-node.ts
var CONNECT_TIMEOUT_MS = 3e4;
var KEEPALIVE_MS = 5e4;
function nodeTransport(options = {}) {
  return (url) => new NodeTransport(url, options);
}
var NodeTransport = class {
  onLine = null;
  onClose = null;
  url;
  options;
  socket = null;
  state = "new";
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
  }
  async connect() {
    if (this.state !== "new") throw new Error("transport already used");
    this.state = "connecting";
    const { host, port, tls } = parseStratumUrl(this.url);
    const net = await nodeBuiltin("net");
    const lib = tls ? await nodeBuiltin("tls") : net;
    if (this.state !== "connecting") throw new Error("connection closed");
    const socket = tls ? lib.connect({
      host,
      port,
      // SNI takes names only; IP addresses are still checked against the certificate.
      servername: net.isIP(host) ? void 0 : host,
      rejectUnauthorized: !this.options.tlsInsecure
    }) : lib.connect({ host, port });
    this.socket = socket;
    let failure;
    socket.on("error", (err) => {
      failure ??= err;
    });
    try {
      await new Promise((resolve, reject) => {
        const ms = this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
        const ready = tls ? "secureConnect" : "connect";
        const timer = setTimeout(() => {
          socket.destroy(new Error(`connection to ${host}:${port} timed out after ${ms / 1e3} s`));
        }, ms);
        const onReady = () => settle();
        const onClose = () => settle(failure ?? new Error(`connection to ${host}:${port} closed`));
        const settle = (err) => {
          clearTimeout(timer);
          socket.off(ready, onReady);
          socket.off("close", onClose);
          if (err) reject(err);
          else resolve();
        };
        socket.on(ready, onReady);
        socket.on("close", onClose);
      });
    } catch (err) {
      this.state = "closed";
      this.socket = null;
      socket.destroy();
      throw err;
    }
    if (this.state !== "connecting") {
      socket.destroy();
      throw new Error("connection closed");
    }
    this.state = "open";
    socket.setNoDelay(true);
    socket.setKeepAlive(true, KEEPALIVE_MS);
    const lines = new LineDecoder();
    socket.on("data", (chunk) => {
      let received;
      try {
        received = lines.push(chunk);
      } catch (err) {
        socket.destroy(err);
        return;
      }
      for (const line of received) {
        if (this.state !== "open") return;
        this.onLine?.(line);
      }
    });
    socket.on("close", () => {
      const wasOpen = this.state === "open";
      this.state = "closed";
      this.socket = null;
      const onClose = this.onClose;
      this.onClose = null;
      if (wasOpen) onClose?.(failure);
    });
  }
  send(line) {
    if (this.state === "open") this.socket.write(`${line}
`);
  }
  close() {
    if (this.state === "closed") return;
    this.state = "closed";
    this.socket?.destroy();
  }
};

// src/stratum/transport-ws.ts
var CONNECT_TIMEOUT_MS2 = 3e4;
function wsTransport(options) {
  return (url) => new WsTransport(url, options);
}
function bridgeUrl(bridge, poolUrl) {
  const { host, port, tls } = parseStratumUrl(poolUrl);
  const base = bridge.trim().replace(/#.*$/s, "");
  if (!/^(wss?|https?):\/\/[^/?]/i.test(base)) {
    throw new Error(`invalid bridge URL "${bridge}": expected ws:// or wss://`);
  }
  const target = encodeURIComponent(formatHostPort(host, port));
  return `${base}${base.includes("?") ? "&" : "?"}target=${target}&tls=${tls ? 1 : 0}`;
}
var WsTransport = class {
  onLine = null;
  onClose = null;
  url;
  options;
  decoder = new TextDecoder();
  ws = null;
  state = "new";
  abort = null;
  constructor(url, options) {
    this.url = url;
    this.options = options;
  }
  connect() {
    if (this.state !== "new") return Promise.reject(new Error("transport already used"));
    this.state = "connecting";
    return new Promise((resolve, reject) => {
      const Ctor = this.options.WebSocket ?? globalThis.WebSocket;
      if (typeof Ctor !== "function") throw new Error("this runtime has no WebSocket");
      const ws = new Ctor(bridgeUrl(this.options.bridge, this.url));
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      const fail = (error) => {
        clearTimeout(timer);
        this.abort = null;
        this.state = "closed";
        this.ws = null;
        try {
          ws.close();
        } catch {
        }
        reject(error);
      };
      const ms = this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS2;
      const timer = setTimeout(() => fail(new Error(`no answer from the bridge within ${ms / 1e3} s`)), ms);
      this.abort = fail;
      ws.onopen = () => {
        clearTimeout(timer);
        this.abort = null;
        this.state = "open";
        resolve();
      };
      ws.onmessage = (event) => this.message(event.data);
      ws.onerror = () => {
      };
      ws.onclose = (event) => {
        const why = `code ${event.code}${event.reason ? `: ${event.reason}` : ""}`;
        if (this.state === "connecting") {
          fail(new Error(`could not reach the pool through the bridge (${why})`));
        } else if (this.state === "open") {
          this.ended(event.code === 1e3 ? void 0 : new Error(`bridge connection closed (${why})`));
        }
      };
    });
  }
  send(line) {
    if (this.state === "open") this.ws.send(line);
  }
  close() {
    if (this.state === "closed") return;
    if (this.abort) {
      this.abort(new Error("connection closed"));
      return;
    }
    this.state = "closed";
    try {
      this.ws?.close(1e3);
    } catch {
    }
    this.ws = null;
  }
  message(data) {
    if (this.state !== "open") return;
    let text;
    if (typeof data === "string") text = data;
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) text = this.decoder.decode(data);
    else return;
    if (text.length > MAX_LINE_BYTES) {
      this.ended(new Error(`message from the bridge longer than ${MAX_LINE_BYTES} bytes`));
      return;
    }
    for (const raw of text.split("\n")) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (!line.trim()) continue;
      if (this.state !== "open") return;
      this.onLine?.(line);
    }
  }
  /** The connection ended on its own (or must end): close it and report once. */
  ended(error) {
    const ws = this.ws;
    this.state = "closed";
    this.ws = null;
    try {
      ws?.close(1e3);
    } catch {
    }
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.(error);
  }
};

// src/stratum/index.ts
function defaultTransport(options, runtime = detectRuntime()) {
  if (options.bridge) return wsTransport({ bridge: options.bridge, connectTimeoutMs: options.connectTimeoutMs });
  if (runtime === "node" || runtime === "deno" || runtime === "bun") {
    return nodeTransport({ tlsInsecure: options.tlsInsecure, connectTimeoutMs: options.connectTimeoutMs });
  }
  throw new Error(
    'browsers cannot open TCP connections to a stratum pool: run a bridge (cpuminer-js bridge --listen 8080 --allow pool.example.com:3333) and pass its URL as `bridge`, e.g. bridge: "ws://localhost:8080"'
  );
}
function createStratumClient(options) {
  return new StratumClientImpl({ ...options, transport: options.transport ?? defaultTransport(options) });
}

// src/miner.ts
var FULL_RANGE = 4294967296;
var Miner = class extends Emitter {
  options;
  algo;
  state = "idle";
  plan = null;
  work = null;
  pool = null;
  gpu = null;
  client = null;
  gen = 0;
  haveJob = false;
  userPaused = false;
  hiddenPaused = false;
  startedAt = 0;
  totals = { hashes: 0, accepted: 0, rejected: 0, stale: 0 };
  window = { cpu: 0, gpu: 0, t: 0 };
  rate = { cpu: 0, gpu: 0 };
  timer = null;
  gpuJob = null;
  gpuLoop = null;
  job = null;
  offVisibility = null;
  constructor(options) {
    super();
    if (!options.url) throw new Error("url is required");
    if (!options.user) throw new Error("user is required (for solo.ckpool.org: your payout address)");
    this.options = options;
    this.algo = resolveAlgo(options.algo, options.params);
  }
  setState(s) {
    this.state = s;
    this.emit("state", s);
  }
  log(msg) {
    this.emit("log", msg);
  }
  async start() {
    if (this.state !== "idle" && this.state !== "stopped") return;
    this.setState("starting");
    try {
      const plan = await autotune(this.algo, { ...this.options, log: (m) => this.log(m) });
      this.plan = plan;
      this.emit("tune", plan);
      this.log(
        `tuned ${this.algo.name}: ${plan.cpu ? `${plan.cpu.backend} x${plan.cpu.threads}` : "no CPU"}${plan.gpu ? " + webgpu" : ""}, ~${(plan.expectedHps / 1e6).toFixed(2)} MH/s`
      );
      const variant = plan.cpu && variantFor(plan.cpu.backend) || "sse41";
      const work = await Cmo.create(await compileVariant(variant));
      const rc = work.init(this.algo.id, { paramN: this.algo.paramN, paramR: this.algo.paramR, key: this.algo.key });
      if (rc !== 0) throw new Error(`cpuminer-opt failed to initialise ${this.algo.name} (${rc})`);
      work.setUser(this.options.user);
      this.work = work;
      if (plan.cpu) {
        const setup = await kernelSetup(plan.cpu.backend, this.algo, this.options);
        this.pool = await WorkerPool.create(setup, plan.cpu.threads, {
          inline: !plan.capabilities.workers,
          throttle: this.options.throttle
        });
        this.pool.on("progress", (e) => this.onProgress(e.gen, e.hashes, e.solutions, plan.cpu.backend));
        this.pool.on("exhausted", (e) => this.onExhausted(e.worker, e.gen));
        this.pool.on("error", (e) => this.emit("error", new Error(`worker ${e.worker}: ${e.message}`)));
      }
      if (plan.gpu) this.gpu = await getBackend("webgpu").create({ backend: "webgpu", algo: this.algo });
      this.client = this.options.stratum ?? createStratumClient({
        url: this.options.url,
        user: this.options.user,
        pass: this.options.pass ?? "x",
        bridge: this.options.bridge,
        transport: this.options.transport,
        userAgent: this.options.userAgent,
        tlsInsecure: this.options.tlsInsecure
      });
      this.bindClient(this.client);
      this.startedAt = Date.now();
      this.window.t = Date.now();
      this.timer = setInterval(() => this.tick(), 2e3);
      this.timer.unref?.();
      this.watchVisibility();
      this.setState("running");
      await this.client.connect();
    } catch (err) {
      await this.stop();
      throw err;
    }
  }
  bindClient(c) {
    c.on("subscribed", ({ xnonce1, xnonce2Size }) => {
      if (!this.work?.subscribed(xnonce1, xnonce2Size)) this.emit("error", new Error("invalid extranonce from pool"));
    });
    c.on("difficulty", (d) => this.work?.setDifficulty(d));
    c.on("extranonce", ({ xnonce1, xnonce2Size }) => this.work?.setExtranonce(xnonce1, xnonce2Size));
    c.on("job", (params) => this.onJob(params));
    c.on("message", (m) => this.log(`pool: ${m}`));
    c.on("log", (m) => this.log(m));
    c.on("error", (e) => this.emit("error", e));
    c.on("disconnected", () => {
      this.haveJob = false;
      this.halt();
    });
  }
  onJob(params) {
    const work = this.work;
    if (!work) return;
    if (!work.notify(params)) {
      this.emit("error", new Error(`ignored invalid job from pool: ${work.drainLog().join(" | ")}`));
      return;
    }
    for (const line of work.drainLog()) this.log(line);
    this.haveJob = true;
    this.gen++;
    const seq = this.assignAll();
    if (seq) {
      this.job = { jobId: work.workJobId(seq), difficulty: work.workTargetDiff(seq), height: work.workHeight(seq) };
      this.emit("job", this.job);
    }
  }
  /** Fresh work (its own extranonce2) for every worker and the GPU. Returns one seq. */
  assignAll() {
    if (!this.haveJob || this.state !== "running") return 0;
    let seq = 0;
    if (this.pool) for (let i = 0; i < this.pool.size; i++) seq = this.assignWorker(i) || seq;
    if (this.gpu) {
      const job = this.nextJob();
      if (job) {
        seq ||= job.seq;
        this.gpuJob = job;
        this.gpuLoop ??= this.runGpu();
      }
    }
    return seq;
  }
  nextJob() {
    const work = this.work;
    const seq = work.genWork();
    if (!seq) return null;
    const range = this.options.nonceRange;
    return {
      seq,
      data: work.workData(seq),
      target: work.workTarget(seq),
      start: range?.start ?? 0,
      end: range?.end ?? FULL_RANGE
    };
  }
  assignWorker(i) {
    const job = this.nextJob();
    if (!job || !this.pool) return 0;
    this.pool.assign(i, this.gen, job);
    return job.seq;
  }
  onExhausted(worker, gen) {
    if (gen === this.gen && this.state === "running" && this.haveJob) this.assignWorker(worker);
  }
  onProgress(gen, hashes, solutions, backend) {
    this.totals.hashes += hashes;
    if (backend === "webgpu") this.window.gpu += hashes;
    else this.window.cpu += hashes;
    for (const s of solutions) void this.submit(s, backend, gen);
  }
  async runGpu() {
    const kernel = this.gpu;
    const batch = this.plan?.gpu?.batch ?? 1 << 22;
    try {
      while (this.state === "running" && this.gpuJob) {
        const job = this.gpuJob;
        const gen = this.gen;
        const start = job.start;
        const end = Math.min(start + batch, job.end);
        const out = await kernel.scan({ ...job, start, end });
        if (this.gpuJob === job) {
          job.start = end;
          if (end >= job.end) this.gpuJob = this.nextJob();
        }
        this.onProgress(gen, out.hashesDone, out.solutions, "webgpu");
      }
    } catch (err) {
      this.emit("error", new Error(`webgpu: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      this.gpuLoop = null;
    }
  }
  /** Re-checks a solution from a hand-written kernel with cpuminer-opt's own code. */
  verified(s) {
    const work = this.work;
    const target = work.workTarget(s.seq);
    work.setScanWork(s.data, target);
    const nonce = s.data[19];
    work.scan(nonce, Math.min(nonce + 16, 4294967295));
    return work.solutions().some((x) => x.data[19] === nonce && x.hash.every((w, i) => w === s.hash[i]));
  }
  async submit(s, backend, gen) {
    const work = this.work;
    const client = this.client;
    if (!work || !client) return;
    const custom = SHA256_FAMILY2.has(this.algo.name) && !["wasm-sse41", "wasm-sse42", "wasm-avx2"].includes(backend);
    try {
      if (custom && !this.verified(s)) {
        this.emit("error", new Error(`${backend} produced a solution that cpuminer-opt rejects; dropped`));
        return;
      }
    } catch {
      return;
    }
    const request = work.buildSubmit(s.seq, s.data);
    if (!request) return;
    const jobId = work.workJobId(s.seq);
    if (gen !== this.gen) this.log(`submitting share for an older job (${jobId})`);
    try {
      const verdict = await client.submit(request);
      if (verdict.accepted) this.totals.accepted++;
      else if (verdict.stale) this.totals.stale++;
      else this.totals.rejected++;
      this.emit("share", { ...verdict, shareDiff: s.shareDiff, jobId });
    } catch (err) {
      this.totals.rejected++;
      this.emit("share", { accepted: false, stale: false, reason: String(err), shareDiff: s.shareDiff, jobId });
    }
  }
  tick() {
    const now2 = Date.now();
    const dt = (now2 - this.window.t) / 1e3;
    if (dt <= 0) return;
    const a = 1 - Math.exp(-dt / 10);
    this.rate.cpu += a * (this.window.cpu / dt - this.rate.cpu);
    this.rate.gpu += a * (this.window.gpu / dt - this.rate.gpu);
    this.window = { cpu: 0, gpu: 0, t: now2 };
    this.emit("hashrate", { hps: this.rate.cpu + this.rate.gpu, cpuHps: this.rate.cpu, gpuHps: this.rate.gpu });
  }
  halt() {
    this.pool?.stop();
    this.gpuJob = null;
  }
  watchVisibility() {
    if (detectRuntime() !== "browser" || this.options.pauseWhenHidden === false) return;
    const doc = globalThis.document;
    if (!doc) return;
    const onChange = () => {
      this.hiddenPaused = doc.visibilityState === "hidden";
      if (this.hiddenPaused) this.pauseInternal();
      else if (!this.userPaused) this.resumeInternal();
    };
    doc.addEventListener("visibilitychange", onChange);
    this.offVisibility = () => doc.removeEventListener("visibilitychange", onChange);
  }
  pauseInternal() {
    if (this.state !== "running") return;
    this.halt();
    this.setState("paused");
  }
  resumeInternal() {
    if (this.state !== "paused") return;
    this.setState("running");
    this.gen++;
    this.assignAll();
  }
  pause() {
    this.userPaused = true;
    this.pauseInternal();
  }
  resume() {
    this.userPaused = false;
    if (!this.hiddenPaused) this.resumeInternal();
  }
  setThrottle(value) {
    this.options.throttle = value;
    this.pool?.setThrottle(value);
  }
  /** Changes the CPU thread count (restarts the workers). */
  async setThreads(threads) {
    if (!this.plan?.cpu || !this.pool) return;
    const old = this.pool;
    const setup = await kernelSetup(this.plan.cpu.backend, this.algo, this.options);
    const pool = await WorkerPool.create(setup, Math.max(1, threads), {
      inline: old.inline,
      throttle: this.options.throttle
    });
    const backend = this.plan.cpu.backend;
    pool.on("progress", (e) => this.onProgress(e.gen, e.hashes, e.solutions, backend));
    pool.on("exhausted", (e) => this.onExhausted(e.worker, e.gen));
    pool.on("error", (e) => this.emit("error", new Error(`worker ${e.worker}: ${e.message}`)));
    this.pool = pool;
    this.plan.cpu.threads = pool.size;
    old.terminate();
    if (this.state === "running") {
      this.gen++;
      this.assignAll();
    }
  }
  async stop() {
    if (this.state === "stopped") return;
    this.setState("stopped");
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.offVisibility?.();
    this.client?.close();
    this.pool?.terminate();
    this.pool = null;
    this.gpuJob = null;
    await this.gpuLoop;
    this.gpu?.dispose();
    this.gpu = null;
  }
  stats() {
    return {
      state: this.state,
      algo: this.algo.name,
      backend: this.plan?.cpu?.backend ?? (this.plan?.gpu ? "webgpu" : null),
      threads: this.plan?.cpu?.threads ?? 0,
      gpu: !!this.plan?.gpu,
      hashrate: this.rate.cpu + this.rate.gpu,
      totalHashes: this.totals.hashes,
      accepted: this.totals.accepted,
      rejected: this.totals.rejected,
      stale: this.totals.stale,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      jobId: this.job?.jobId ?? null,
      difficulty: this.job?.difficulty ?? null,
      height: this.job?.height ?? null
    };
  }
};
async function createMiner(options) {
  return new Miner(options);
}

// src/mine.ts
var DEFAULT_POOL = "stratum+tcp://solo.ckpool.org:3333";
async function mineBTC(address, url, options = {}) {
  const { pool = DEFAULT_POOL, network = "mainnet", ...minerOptions } = options;
  const { addressScript } = await import("./keys-EUEN7YJR.js");
  addressScript(address, network);
  if (typeof url !== "string") throw new Error("url is required");
  const viaBridge = /^wss?:\/\//i.test(url);
  if (!viaBridge && !/^stratum\+/i.test(url)) {
    throw new Error("url must be a bridge (ws:// or wss://) or a pool (stratum+tcp:// or stratum+ssl://)");
  }
  const miner = await createMiner({
    pass: "x",
    ...minerOptions,
    algo: "sha256d",
    url: viaBridge ? pool : url,
    bridge: viaBridge ? url : void 0,
    user: address
  });
  await miner.start();
  return miner;
}

export {
  listAlgorithms,
  resolveAlgo,
  algoInfo,
  listBackends,
  BUILT_VARIANTS,
  cpuCandidates,
  autotune,
  benchmark,
  hash,
  createStratumClient,
  Miner,
  createMiner,
  DEFAULT_POOL,
  mineBTC
};
