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

// src/util/emitter.ts
var Emitter = class {
  listeners = /* @__PURE__ */ new Map();
  on(event, listener) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, set = /* @__PURE__ */ new Set());
    set.add(listener);
    return () => set.delete(listener);
  }
  once(event, listener) {
    const off = this.on(event, (v) => {
      off();
      listener(v);
    });
    return off;
  }
  emit(event, value) {
    for (const l of this.listeners.get(event) ?? []) {
      try {
        l(value);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  }
  removeAll() {
    this.listeners.clear();
  }
};

// src/stratum/client.ts
var DEFAULT_USER_AGENT = "cpuminer-opt-js/0.1.0";
var MAX_LINE_BYTES = 1 << 20;
var SCHEMES = /* @__PURE__ */ new Map([
  ["stratum+tcp", false],
  ["stratum+ssl", true],
  ["stratum+tcps", true]
]);
function parseStratumUrl(url) {
  const text = String(url).trim();
  const sep = text.indexOf("://");
  const scheme = sep < 0 ? "stratum+tcp" : text.slice(0, sep).toLowerCase();
  const tls = SCHEMES.get(scheme);
  if (tls === void 0) {
    throw new Error(`unsupported pool URL "${url}": use stratum+tcp://, stratum+ssl:// or stratum+tcps://`);
  }
  let authority = (sep < 0 ? text : text.slice(sep + 3)).replace(/[/?#].*$/s, "");
  authority = authority.slice(authority.lastIndexOf("@") + 1);
  const m = /^\[([0-9a-f:.]+(?:%[\w.-]+)?)\]:(\d{1,5})$/i.exec(authority) ?? /^([\p{L}\p{N}._-]+):(\d{1,5})$/u.exec(authority);
  const port = m ? Number(m[2]) : 0;
  if (!m || port < 1 || port > 65535) throw new Error(`invalid pool URL "${url}": expected ${scheme}://host:port`);
  return { scheme, host: m[1], port, tls };
}
function formatHostPort(host, port) {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}
function formatStratumUrl(url) {
  return `${url.scheme}://${formatHostPort(url.host, url.port)}`;
}
var LineDecoder = class {
  maxBytes;
  decoder = new TextDecoder();
  parts = [];
  size = 0;
  constructor(maxBytes = MAX_LINE_BYTES) {
    this.maxBytes = maxBytes;
  }
  /** Lines completed by `chunk`. Throws a RangeError once a line exceeds the limit. */
  push(chunk) {
    const lines = [];
    let start = 0;
    for (let nl = chunk.indexOf(10); nl >= 0; nl = chunk.indexOf(10, start)) {
      this.append(chunk.subarray(start, nl));
      const line = this.take();
      if (line.trim()) lines.push(line);
      start = nl + 1;
    }
    if (start < chunk.length) this.append(new Uint8Array(chunk.subarray(start)));
    return lines;
  }
  append(bytes) {
    if (this.size + bytes.length > this.maxBytes) {
      this.parts = [];
      this.size = 0;
      throw new RangeError(`line longer than ${this.maxBytes} bytes`);
    }
    if (!bytes.length) return;
    this.parts.push(bytes);
    this.size += bytes.length;
  }
  take() {
    let bytes = this.parts.length === 1 ? this.parts[0] : new Uint8Array(this.size);
    if (this.parts.length > 1) {
      let offset = 0;
      for (const part of this.parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
    }
    this.parts = [];
    this.size = 0;
    if (bytes.length && bytes[bytes.length - 1] === 13) bytes = bytes.subarray(0, bytes.length - 1);
    return bytes.length ? this.decoder.decode(bytes) : "";
  }
};
var MAX_DELAY_MS = 2 ** 31 - 1;
var MAX_EARLY = 256;
var StratumClientImpl = class {
  factory;
  user;
  pass;
  agent;
  retryPauseMs;
  timeoutMs;
  shareTimeoutMs;
  requestTimeoutMs;
  extranonceTimeoutMs;
  events = new Emitter();
  /** The configured pool. Targets of client.reconnect last until a connection fails. */
  homeUrl;
  url;
  closed = false;
  phase = "idle";
  /** Bumped whenever a connection starts or ends; callbacks of older ones compare and bail. */
  gen = 0;
  transport = null;
  sessionId = null;
  retriedSubscribe = false;
  /** `subscribed` was emitted for the current connection. */
  subscribed = false;
  early = [];
  extranoncePending = false;
  shares = /* @__PURE__ */ new Map();
  nextShareId = 4;
  // ids 1-3 are subscribe, authorize and extranonce.subscribe
  firstConnect = null;
  waiter = null;
  silenceTimer = null;
  requestTimer = null;
  extranonceTimer = null;
  retryTimer = null;
  constructor(options) {
    this.homeUrl = this.url = formatStratumUrl(parseStratumUrl(options.url));
    this.factory = options.transport;
    this.user = String(options.user ?? "");
    this.pass = String(options.pass ?? "");
    this.agent = options.userAgent || DEFAULT_USER_AGENT;
    this.retryPauseMs = delay(options.retryPauseMs, 1e4, true);
    this.timeoutMs = delay(options.timeoutMs, 3e5);
    this.shareTimeoutMs = delay(options.shareTimeoutMs, 6e4);
    this.requestTimeoutMs = delay(options.requestTimeoutMs, 3e4);
    this.extranonceTimeoutMs = delay(options.extranonceTimeoutMs, 3e3);
  }
  get connected() {
    return this.phase === "ready";
  }
  on(event, listener) {
    return this.events.on(event, listener);
  }
  connect() {
    if (this.closed) return Promise.reject(new Error("stratum client is closed"));
    if (this.firstConnect) return this.firstConnect;
    const connecting = new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
    this.firstConnect = connecting;
    this.open();
    return connecting;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.drop();
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(new Error("stratum client closed"));
    this.events.removeAll();
  }
  submit(request) {
    let message;
    try {
      message = JSON.parse(request);
      if (!message || typeof message !== "object" || Array.isArray(message)) throw new TypeError("not an object");
    } catch {
      this.emit("error", new Error(`invalid share request: ${clip(String(request))}`));
      return Promise.resolve(rejected("invalid request"));
    }
    if (this.closed) return Promise.resolve(rejected("closed"));
    if (this.phase !== "authorizing" && this.phase !== "ready") return Promise.resolve(rejected("disconnected"));
    const id = this.nextShareId++;
    message.id = id;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.shares.delete(id)) return;
        this.log(`no verdict for share ${id} within ${seconds(this.shareTimeoutMs)}`);
        resolve(rejected("timeout"));
      }, this.shareTimeoutMs);
      this.shares.set(id, { resolve, timer });
      this.send(message);
    });
  }
  // ------------------------------------------------------------ connection
  /** Starts a connection attempt to this.url. */
  open() {
    const gen = ++this.gen;
    const url = this.url;
    this.phase = "connecting";
    this.subscribed = false;
    this.retriedSubscribe = false;
    this.early = [];
    this.log(`connecting to ${url}`);
    let opened;
    try {
      const transport = this.factory(url);
      transport.onLine = (line) => {
        if (gen === this.gen) this.guard(() => this.receive(line));
      };
      transport.onClose = (error) => {
        if (gen === this.gen) this.guard(() => this.lost(error ?? new Error("connection closed by the pool")));
      };
      this.transport = transport;
      opened = Promise.resolve(transport.connect());
    } catch (err) {
      opened = Promise.reject(err);
    }
    opened.then(
      () => {
        if (gen === this.gen) this.guard(() => this.opened());
      },
      (err) => {
        if (gen === this.gen) this.guard(() => this.lost(asError(err)));
      }
    );
  }
  opened() {
    this.phase = "subscribing";
    this.log(`connected to ${this.url}`);
    this.resetSilence();
    this.subscribe();
  }
  subscribe() {
    const params = this.retriedSubscribe ? [] : this.sessionId ? [this.agent, this.sessionId] : [this.agent];
    this.request(1, "mining.subscribe", params);
  }
  request(id, method, params) {
    const gen = this.gen;
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = setTimeout(() => {
      this.requestTimer = null;
      if (gen === this.gen) {
        this.guard(() => this.lost(new Error(`no reply to ${method} within ${seconds(this.requestTimeoutMs)}`)));
      }
    }, this.requestTimeoutMs);
    this.send({ id, method, params });
  }
  clearRequestTimer() {
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = null;
  }
  /** Reconnects after this much silence, as upstream's stratum_socket_full(opt_timeout). */
  resetSilence() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    const gen = this.gen;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (gen === this.gen) {
        this.guard(() => this.lost(new Error(`no data from the pool for ${seconds(this.timeoutMs)}`)));
      }
    }, this.timeoutMs);
  }
  /** Ends the current connection, failing its pending shares. */
  drop(error) {
    this.gen++;
    const transport = this.transport;
    this.transport = null;
    if (transport) {
      transport.onLine = null;
      transport.onClose = null;
      try {
        transport.close();
      } catch {
      }
    }
    for (const timer of [this.silenceTimer, this.requestTimer, this.extranonceTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.silenceTimer = this.requestTimer = this.extranonceTimer = null;
    this.extranoncePending = false;
    this.early = [];
    this.phase = "idle";
    this.failShares(this.closed ? "closed" : "disconnected");
    if (this.subscribed) {
      this.subscribed = false;
      this.emit("disconnected", error ? { error } : {});
    }
  }
  /** The connection attempt failed, or an established connection went away. */
  lost(error) {
    const url = this.url;
    const established = this.phase === "ready";
    this.drop(error);
    if (this.closed) return;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      this.firstConnect = null;
      this.url = this.homeUrl;
      this.log(`connection to ${url} failed: ${error.message}`);
      waiter.reject(error);
      return;
    }
    this.log(`connection to ${url} ${established ? "lost" : "failed"}: ${error.message}`);
    if (this.url !== this.homeUrl) {
      this.url = this.homeUrl;
      this.log(`switching back to ${this.homeUrl}`);
    }
    this.scheduleRetry();
  }
  /** Fixed pause between attempts, no backoff (upstream opt_fail_pause). */
  scheduleRetry() {
    const delayMs = this.retryPauseMs;
    this.phase = "waiting";
    this.log(`retrying in ${seconds(delayMs)}`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed || this.phase !== "waiting") return;
      this.emit("reconnecting", { url: this.url, delayMs });
      if (!this.closed && this.phase === "waiting") this.open();
    }, delayMs);
  }
  // -------------------------------------------------------------- messages
  receive(line) {
    this.resetSilence();
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      this.log(`ignoring invalid JSON from the pool: ${clip(text)}`);
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.log(`ignoring unexpected message from the pool: ${clip(text)}`);
      return;
    }
    const m = message;
    if (typeof m.method !== "string") {
      this.response(m);
    } else if (this.phase === "connecting" || this.phase === "subscribing") {
      if (this.early.length < MAX_EARLY) this.early.push(m);
      else this.log(`dropping ${m.method} received before the subscribe reply`);
    } else {
      this.method(m);
    }
  }
  response(m) {
    const id = typeof m.id === "number" ? m.id : typeof m.id === "string" && /^\d+$/.test(m.id) ? Number(m.id) : null;
    const share = id === null ? void 0 : this.shares.get(id);
    if (share) {
      this.shares.delete(id);
      clearTimeout(share.timer);
      share.resolve(verdict(m));
    } else if (id === 1 && this.phase === "subscribing") {
      this.subscribeReply(m);
    } else if (id === 2 && this.phase === "authorizing") {
      this.authorizeReply(m);
    } else if (id === 3 && this.extranoncePending) {
      this.extranonceReply(m);
    } else {
      this.log(`ignoring unexpected reply: ${clip(JSON.stringify(m))}`);
    }
  }
  subscribeReply(m) {
    this.clearRequestTimer();
    const result = hasError(m.error) ? null : parseSubscribeResult(m.result);
    if (!result) {
      const why = hasError(m.error) ? errorText(m.error) : `unexpected result ${clip(JSON.stringify(m.result ?? null))}`;
      if (this.retriedSubscribe) {
        this.lost(new Error(`mining.subscribe failed: ${why}`));
      } else {
        this.retriedSubscribe = true;
        this.log(`mining.subscribe failed (${why}), retrying without parameters`);
        this.subscribe();
      }
      return;
    }
    const gen = this.gen;
    this.sessionId = result.sessionId;
    this.phase = "authorizing";
    this.request(2, "mining.authorize", [this.user, this.pass]);
    if (gen !== this.gen) return;
    this.subscribed = true;
    const session = result.sessionId === null ? "" : `, session ${result.sessionId}`;
    this.log(`subscribed: extranonce1 ${result.xnonce1}, extranonce2 size ${result.xnonce2Size}${session}`);
    this.emit("subscribed", result);
    for (const early of this.early.splice(0)) {
      if (gen !== this.gen) break;
      this.method(early);
    }
  }
  authorizeReply(m) {
    this.clearRequestTimer();
    if (m.result === void 0 || m.result === false || hasError(m.error)) {
      this.lost(new Error(`authorization failed${hasError(m.error) ? `: ${errorText(m.error)}` : ""}`));
      return;
    }
    const gen = this.gen;
    this.phase = "ready";
    this.log("authorized");
    this.emit("authorized", { user: this.user });
    if (gen !== this.gen) return;
    this.extranonceSubscribe();
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.resolve();
  }
  /** Optional; the reply is matched by id whenever it comes, without holding anything up. */
  extranonceSubscribe() {
    const gen = this.gen;
    this.extranoncePending = true;
    this.extranonceTimer = setTimeout(() => {
      this.extranonceTimer = null;
      if (gen !== this.gen || !this.extranoncePending) return;
      this.extranoncePending = false;
      this.log(`no reply to mining.extranonce.subscribe within ${seconds(this.extranonceTimeoutMs)}, carrying on`);
    }, this.extranonceTimeoutMs);
    this.send({ id: 3, method: "mining.extranonce.subscribe", params: [] });
  }
  extranonceReply(m) {
    this.extranoncePending = false;
    if (this.extranonceTimer) clearTimeout(this.extranonceTimer);
    this.extranonceTimer = null;
    if (m.result === true && !hasError(m.error)) this.log("subscribed to extranonce changes");
    else this.log(`pool declined mining.extranonce.subscribe${hasError(m.error) ? ` (${errorText(m.error)})` : ""}`);
  }
  /** Server requests and notifications (upstream stratum_handle_method). */
  method(m) {
    const name = m.method;
    const params = Array.isArray(m.params) ? m.params : [];
    const id = m.id ?? null;
    switch (name.toLowerCase()) {
      case "mining.notify":
        if (Array.isArray(m.params)) this.emit("job", m.params);
        else this.log("ignoring mining.notify without params");
        break;
      case "mining.set_difficulty": {
        const diff = params[0];
        if (typeof diff === "number" && Number.isFinite(diff) && diff > 0) this.emit("difficulty", diff);
        else this.log(`ignoring mining.set_difficulty ${clip(JSON.stringify(m.params ?? null))}`);
        break;
      }
      case "mining.set_extranonce": {
        const extranonce = parseExtranonce(params[0], params[1]);
        if (extranonce) {
          this.log(`extranonce1 ${extranonce.xnonce1}, extranonce2 size ${extranonce.xnonce2Size}`);
          this.emit("extranonce", extranonce);
        } else {
          this.log(`ignoring mining.set_extranonce ${clip(JSON.stringify(m.params ?? null))}`);
        }
        break;
      }
      case "client.reconnect":
        this.redirect(params);
        break;
      case "client.get_version":
        if (id !== null) this.send({ id, result: this.agent, error: null });
        break;
      case "client.show_message":
        if (params[0] != null) {
          const text = typeof params[0] === "string" ? params[0] : JSON.stringify(params[0]);
          this.log(`message from the pool: ${text}`);
          this.emit("message", text);
        }
        if (id !== null) this.send({ id, result: true, error: null });
        break;
      case "mining.ping":
        if (id !== null) this.send({ id, result: "pong", error: null });
        break;
      default:
        this.log(`unknown stratum method ${clip(name)}`);
        if (id !== null) this.send({ id, result: false, error: { code: 38, message: "unknown method" } });
    }
  }
  /** client.reconnect [host, port]: switch now, keeping the scheme. */
  redirect(params) {
    if (!params.length) {
      this.log("ignoring client.reconnect without a target");
      return;
    }
    const [host, rawPort] = params;
    const port = typeof rawPort === "string" && /^\s*\d+\s*$/.test(rawPort) ? Number(rawPort) : rawPort;
    let url;
    try {
      if (typeof host !== "string" || typeof port !== "number" || !Number.isInteger(port)) throw new TypeError();
      const { scheme } = parseStratumUrl(this.url);
      const target = formatStratumUrl({ scheme, host: host.trim().replace(/^\[(.*)\]$/, "$1"), port });
      url = formatStratumUrl(parseStratumUrl(target));
    } catch {
      this.log(`ignoring client.reconnect ${clip(JSON.stringify(params))}`);
      return;
    }
    this.log(`pool requested reconnection to ${url}`);
    this.drop();
    if (this.closed) return;
    this.url = url;
    this.emit("reconnecting", { url, delayMs: 0 });
    if (!this.closed && this.phase === "idle") this.open();
  }
  // --------------------------------------------------------------- helpers
  send(message) {
    const transport = this.transport;
    if (!transport) return;
    try {
      transport.send(JSON.stringify(message));
    } catch (err) {
      this.lost(asError(err));
    }
  }
  failShares(reason) {
    for (const share of this.shares.values()) {
      clearTimeout(share.timer);
      share.resolve(rejected(reason));
    }
    this.shares.clear();
  }
  emit(event, value) {
    if (!this.closed) this.events.emit(event, value);
  }
  log(text) {
    this.emit("log", text);
  }
  /** Our own handlers never throw into a transport; failures become `error` events. */
  guard(fn) {
    try {
      fn();
    } catch (err) {
      this.emit("error", asError(err));
    }
  }
};
function parseExtranonce(xnonce1, size) {
  if (typeof xnonce1 !== "string" || !/^(?:[0-9a-f]{2})*$/i.test(xnonce1)) return null;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 2 || size > 16) return null;
  return { xnonce1, xnonce2Size: size };
}
function parseSubscribeResult(result) {
  if (!Array.isArray(result)) return null;
  const extranonce = parseExtranonce(result[1], result[2]);
  return extranonce && { ...extranonce, sessionId: sessionIdOf(result[0]) };
}
function sessionIdOf(subscriptions) {
  if (!Array.isArray(subscriptions)) return null;
  const pairs = typeof subscriptions[0] === "string" ? [subscriptions] : subscriptions;
  for (const pair of pairs) {
    if (!Array.isArray(pair)) break;
    if (typeof pair[0] === "string" && pair[0].toLowerCase() === "mining.notify") {
      return typeof pair[1] === "string" ? pair[1] : null;
    }
  }
  return null;
}
var hasError = (error) => error !== null && error !== void 0 && error !== false;
function errorText(error) {
  if (!hasError(error)) return null;
  if (Array.isArray(error)) return error[1] != null ? String(error[1]) : JSON.stringify(error);
  if (typeof error === "object") {
    const message = error.message;
    return message != null ? String(message) : JSON.stringify(error);
  }
  return String(error);
}
function verdict(m) {
  const accepted = m.result === true;
  const reason = errorText(m.error);
  return { accepted, reason, stale: !accepted && reason !== null && /job/i.test(reason) };
}
function rejected(reason) {
  return { accepted: false, reason, stale: false };
}
function delay(value, fallback, zeroOk = false) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value === 0 && !zeroOk) return fallback;
  return Math.min(value, MAX_DELAY_MS);
}
function asError(err) {
  return err instanceof Error ? err : new Error(String(err));
}
function clip(text, max = 200) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
function seconds(ms) {
  return `${Number((ms / 1e3).toFixed(3))} s`;
}

export {
  detectRuntime,
  nodeBuiltin,
  detect,
  Emitter,
  MAX_LINE_BYTES,
  parseStratumUrl,
  formatHostPort,
  LineDecoder,
  StratumClientImpl
};
