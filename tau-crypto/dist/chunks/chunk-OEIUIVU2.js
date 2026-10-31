import {
  MAX_LINE_BYTES,
  formatHostPort,
  parseStratumUrl
} from "./chunk-TOFRYWU7.js";

// src/bridge/core.ts
var MAX_MESSAGE_BYTES = MAX_LINE_BYTES;
var MAX_PENDING_LINES = 1e3;
var BRIDGE_FEATURES = Object.freeze(["intercept", "async-intercept", "fetch"]);
function parseTarget(text) {
  const value = String(text ?? "").trim();
  const m = /^\[([0-9a-f:.]+)\]:(\d{1,5})$/i.exec(value) ?? /^([a-z0-9._-]+):(\d{1,5})$/i.exec(value);
  const port = m ? Number(m[2]) : 0;
  return m && port >= 1 && port <= 65535 ? { host: m[1].toLowerCase(), port } : null;
}
function poolTarget(url) {
  const { host, port } = parseStratumUrl(url);
  return formatHostPort(host.toLowerCase(), port);
}
function buildAllowlist(entries) {
  const allow = /* @__PURE__ */ new Map();
  for (const entry of entries ?? []) {
    const target = parseTarget(entry);
    if (!target) throw new Error(`invalid allowed pool "${entry}": expected host:port`);
    allow.set(formatHostPort(target.host, target.port), target);
  }
  if (!allow.size) throw new Error("the bridge needs at least one allowed pool (host:port)");
  return allow;
}
function requestedTarget(query, allow) {
  const requested = parseTarget(query.get("target"));
  const target = requested && allow.get(formatHostPort(requested.host, requested.port));
  if (!target) return { status: 403, why: "target not allowed" };
  const tls = query.get("tls") ?? "0";
  if (tls !== "0" && tls !== "1") return { status: 400, why: "tls must be 0 or 1" };
  return { target, tls: tls === "1" };
}
var LinePipe = class {
  fn;
  deliver;
  fail;
  queue = [];
  running = false;
  closed = false;
  constructor(fn, deliver, fail) {
    this.fn = fn;
    this.deliver = deliver;
    this.fail = fail;
  }
  push(line) {
    if (this.closed) return;
    if (this.queue.length >= MAX_PENDING_LINES) return this.error(new Error("too many lines waiting for the interceptor"));
    this.queue.push(line);
    if (!this.running) void this.drain();
  }
  close() {
    this.closed = true;
    this.queue = [];
  }
  error(err) {
    if (this.closed) return;
    this.close();
    this.fail(err);
  }
  async drain() {
    this.running = true;
    try {
      while (this.queue.length && !this.closed) {
        const line = this.queue.shift();
        let out;
        try {
          out = await this.fn(line);
        } catch (err) {
          return this.error(err instanceof Error ? err : new Error(String(err)));
        }
        if (this.closed) return;
        if (out === null || out === void 0) continue;
        if (typeof out !== "string" || /[\r\n]/.test(out)) return this.error(new Error("interceptor returned more than one line"));
        this.deliver(out);
      }
    } finally {
      this.running = false;
    }
  }
};

export {
  MAX_MESSAGE_BYTES,
  BRIDGE_FEATURES,
  parseTarget,
  poolTarget,
  buildAllowlist,
  requestedTarget,
  LinePipe
};
