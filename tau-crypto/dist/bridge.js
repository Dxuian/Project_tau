import {
  BRIDGE_FEATURES,
  BRIDGE_USAGE,
  LinePipe,
  MAX_MESSAGE_BYTES,
  buildAllowlist,
  createBridge,
  parseBridgeArgs,
  requestedTarget,
  runBridgeCli
} from "./chunks/chunk-VPWWBMZT.js";
import {
  coinbaseOutputs,
  paidTo,
  rebuildBlockHeader
} from "./chunks/chunk-JIER3F7Z.js";
import {
  addressScript,
  isHex,
  isValidAddress
} from "./chunks/chunk-APBMG6TN.js";
import {
  LineDecoder,
  MAX_LINE_BYTES,
  formatHostPort
} from "./chunks/chunk-54VWD4RY.js";

// bridge/worker.ts
var encoder = new TextEncoder();
var strictUtf8 = new TextDecoder("utf-8", { fatal: true });
function text(status, body) {
  return new Response(`${body}
`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms);
    })
  ]).finally(() => clearTimeout(timer));
}
function createWorkerBridge(options) {
  const allow = buildAllowlist(options.allow);
  if (typeof options.connect !== "function") throw new Error("pass connect from 'cloudflare:sockets'");
  const origins = options.origins?.length ? new Set(options.origins) : null;
  const maxConnections = options.maxConnections ?? 256;
  const log = options.log ?? (() => {
  });
  const timeoutMs = options.connectTimeoutMs ?? 3e4;
  let active = 0;
  let nextId = 1;
  return {
    async fetch(request) {
      if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
        return text(426, "tau-crypto bridge: connect with a WebSocket");
      }
      const origin = request.headers.get("origin");
      if (origins && !origins.has(origin ?? "")) return text(403, "origin not allowed");
      let query;
      try {
        query = new URL(request.url).searchParams;
      } catch {
        return text(400, "invalid request URL");
      }
      const wanted = requestedTarget(query, allow);
      if ("status" in wanted) return text(wanted.status, wanted.why);
      if (active >= maxConnections) return text(503, "too many connections");
      const { target, tls } = wanted;
      const peer = request.headers.get("cf-connecting-ip") ?? "unknown";
      const label = `${formatHostPort(target.host, target.port)}${tls ? " (TLS)" : ""}`;
      const link = { reply: (_line) => {
      }, close: (_reason) => {
      } };
      let interceptor = null;
      if (options.intercept) {
        const connection = {
          id: nextId++,
          peer,
          target: formatHostPort(target.host, target.port),
          tls,
          origin,
          query,
          reply: (line) => link.reply(line),
          close: (reason) => link.close(reason)
        };
        try {
          interceptor = options.intercept(connection);
        } catch (err) {
          log(`${peer}: interceptor failed: ${err.message}`);
          return text(500, "internal error");
        }
        if (!interceptor) return text(403, "connection refused");
      }
      const notifyClose = () => {
        try {
          interceptor?.onClose?.();
        } catch (err) {
          log(`${peer}: interceptor onClose failed: ${err.message}`);
        }
      };
      let socket;
      try {
        socket = options.connect({ hostname: target.host, port: target.port }, { secureTransport: tls ? "on" : "off", allowHalfOpen: false });
        await withTimeout(socket.opened, timeoutMs);
      } catch (err) {
        try {
          socket?.close();
        } catch {
        }
        notifyClose();
        log(`${peer} refused: 502 could not connect to ${label}`);
        return text(502, `could not connect to ${label}: ${err.message}`);
      }
      const pool = socket;
      const Pair = options.WebSocketPair ?? globalThis.WebSocketPair;
      if (!Pair) throw new Error("WebSocketPair is not available (not a Workers runtime?)");
      const pair = new Pair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      active++;
      log(`${peer} connected to ${label}`);
      const writer = pool.writable.getWriter();
      let closed = false;
      let fromPool = null;
      let fromClient = null;
      const finish = (code, reason) => {
        if (closed) return;
        closed = true;
        active--;
        fromPool?.close();
        fromClient?.close();
        try {
          server.close(code, reason);
        } catch {
        }
        writer.close().catch(() => {
        });
        try {
          pool.close();
        } catch {
        }
        log(`${peer} disconnected from ${label} (${reason})`);
        notifyClose();
      };
      const toClient = (line) => {
        if (closed) return;
        try {
          server.send(line);
        } catch {
          finish(1011, "websocket send failed");
        }
      };
      const toPool = (line) => {
        if (closed) return;
        writer.write(encoder.encode(`${line}
`)).catch(() => finish(1011, "pool connection failed"));
      };
      link.reply = toClient;
      link.close = (reason = "closed by the bridge") => finish(1008, reason);
      if (interceptor) {
        const broken = (err) => {
          log(`${peer}: interceptor error: ${err.message}`);
          finish(1011, "interceptor error");
        };
        const icp = interceptor;
        fromPool = new LinePipe(icp.fromPool ? (l) => icp.fromPool(l) : (l) => l, toClient, broken);
        fromClient = new LinePipe(icp.fromClient ? (l) => icp.fromClient(l) : (l) => l, toPool, broken);
      }
      server.addEventListener("message", (event) => {
        if (closed) return;
        let message;
        if (typeof event.data === "string") message = event.data;
        else {
          try {
            message = strictUtf8.decode(event.data);
          } catch {
            return finish(1007, "invalid UTF-8 in a message");
          }
        }
        if (message.length > MAX_MESSAGE_BYTES || encoder.encode(message).length > MAX_MESSAGE_BYTES) {
          return finish(1009, "message too large");
        }
        for (const raw of message.split(/\r?\n/)) {
          if (!raw.trim()) continue;
          if (fromClient) fromClient.push(raw);
          else toPool(raw);
        }
      });
      server.addEventListener("close", () => finish(1e3, "client closed the connection"));
      server.addEventListener("error", () => finish(1011, "websocket error"));
      void (async () => {
        const reader = pool.readable.getReader();
        const lines = new LineDecoder(MAX_LINE_BYTES);
        try {
          for (; ; ) {
            const { value, done } = await reader.read();
            if (done || closed) break;
            let received;
            try {
              received = lines.push(value);
            } catch {
              return finish(1009, "pool line too long");
            }
            for (const line of received) {
              if (fromPool) fromPool.push(line);
              else toClient(line);
            }
          }
          finish(1e3, "pool closed the connection");
        } catch {
          finish(1011, "pool connection failed");
        }
      })();
      return options.upgradeResponse ? options.upgradeResponse(client) : new Response(null, { status: 101, webSocket: client });
    }
  };
}

// bridge/auditor.ts
var MAX_LINE = 16 * 1024;
var MAX_JOBS = 32;
var MAX_PENDING = 64;
function validNotify(p) {
  if (!Array.isArray(p) || p.length < 9) return null;
  const [jobId, prevhash, coinb1, coinb2, merkle, version, nbits, , clean] = p;
  if (typeof jobId !== "string" || !jobId || jobId.length > 128) return null;
  if (!isHex(prevhash, 32) || !isHex(version, 4) || !isHex(nbits, 4) || !isHex(p[7], 4)) return null;
  if (!isHex(coinb1) || !isHex(coinb2) || coinb1.length + coinb2.length > 4e4) return null;
  if (!Array.isArray(merkle) || merkle.length > 32 || !merkle.every((m) => isHex(m, 32))) return null;
  return { jobId, prevhash, coinb1, coinb2, merkle, version, nbits, clean: clean === true };
}
function randomTag() {
  const b = new Uint8Array(4);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function createShareAuditor(options) {
  const { poolUser, network = "mainnet", onShare, onResult, log = () => {
  }, maxSharesPer10s = 50 } = options;
  const ownerScript = addressScript(poolUser, network);
  if (typeof onShare !== "function") throw new Error("onShare is required");
  const started = `${Date.now().toString(36)}${randomTag()}`;
  return (connection) => {
    let visitor = null;
    let xn1 = null;
    let xn2Size = 0;
    let difficulty = null;
    let shareCount = 0;
    const jobs = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Map();
    const recent = [];
    const deny = (id, message, code = 20) => {
      if (id !== void 0 && id !== null) connection.reply(JSON.stringify({ id, result: null, error: [code, message, null] }));
      return null;
    };
    const idKey = (id) => `${typeof id}:${id}`;
    const fromClient = async (line) => {
      if (line.length > MAX_LINE) return null;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return null;
      }
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
      const { id, method, params } = msg;
      if (method === void 0) {
        return "result" in msg || "error" in msg ? JSON.stringify(msg) : null;
      }
      const validId = typeof id === "number" && Number.isSafeInteger(id) || typeof id === "string" && id.length <= 64;
      if (!validId) return null;
      if (typeof method !== "string" || !Array.isArray(params)) return deny(id, "invalid request");
      if (pending.has(idKey(id))) return deny(id, "duplicate request id");
      if (pending.size >= MAX_PENDING) return deny(id, "too many requests in flight");
      const forward = (kind, newParams, shareId) => {
        pending.set(idKey(id), { kind, shareId });
        return JSON.stringify({ id, method, params: newParams });
      };
      switch (method) {
        case "mining.subscribe":
          return forward("subscribe", params.filter((p) => typeof p === "string" && p.length <= 128).slice(0, 2));
        case "mining.extranonce.subscribe":
          return forward("extranonce", []);
        case "mining.authorize": {
          const address = typeof params[0] === "string" ? params[0].trim() : "";
          if (!isValidAddress(address, network)) return deny(id, `invalid payout address: expected a ${network} Bitcoin address`, 24);
          if (visitor && visitor !== address) return deny(id, "one payout address per connection", 24);
          visitor = address;
          return forward("authorize", [poolUser, typeof params[1] === "string" ? params[1].slice(0, 64) : "x"]);
        }
        case "mining.submit": {
          if (!visitor) return deny(id, "unauthorized worker", 24);
          if (params.length !== 5) return deny(id, "version rolling is not supported");
          const [, jobId, xn2, ntime, nonce] = params;
          const job = typeof jobId === "string" ? jobs.get(jobId) : void 0;
          if (!job) return deny(id, "Job not found", 21);
          if (!isHex(xn2, job.xn2Size) || !isHex(ntime, 4) || !isHex(nonce, 4)) return deny(id, "invalid share fields");
          const now = Date.now();
          while (recent.length && now - recent[0] > 1e4) recent.shift();
          if (recent.length >= maxSharesPer10s) return deny(id, "too many shares");
          recent.push(now);
          const share = { xn1: job.xn1, xn2: xn2.toLowerCase(), ntime: ntime.toLowerCase(), nonce: nonce.toLowerCase() };
          const rebuilt = rebuildBlockHeader({ ...job, ...share });
          const shareId = `${started}-${connection.id}-${++shareCount}`;
          const record = {
            type: "share",
            v: 1,
            id: shareId,
            time: new Date(now).toISOString(),
            conn: connection.id,
            peer: connection.peer,
            visitor,
            jobId,
            job: { prevhash: job.prevhash, coinb1: job.coinb1, coinb2: job.coinb2, merkle: job.merkle, version: job.version, nbits: job.nbits },
            ...share,
            difficulty,
            blockHash: rebuilt.blockHash,
            isBlock: rebuilt.isBlock,
            ownerSats: job.ownerSats === null ? null : String(job.ownerSats)
          };
          await onShare(record);
          if (rebuilt.isBlock) log(`block candidate ${rebuilt.blockHash} from ${visitor} (connection ${connection.id})`);
          return forward("submit", [poolUser, jobId, share.xn2, share.ntime, share.nonce], shareId);
        }
        default:
          return deny(id, `unsupported method ${method.slice(0, 64)}`);
      }
    };
    const fromPool = (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return line;
      }
      if (!msg || typeof msg !== "object") return line;
      if (msg.method === "mining.notify") {
        const job = validNotify(msg.params);
        if (job && xn1 !== null) {
          let ownerSats = null;
          try {
            ownerSats = paidTo(coinbaseOutputs(job.coinb1 + xn1 + "00".repeat(xn2Size) + job.coinb2), ownerScript);
          } catch {
          }
          if (job.clean) jobs.clear();
          jobs.delete(job.jobId);
          jobs.set(job.jobId, { ...job, xn1, xn2Size, ownerSats });
          while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
        }
      } else if (msg.method === "mining.set_extranonce") {
        const [x1, size] = Array.isArray(msg.params) ? msg.params : [];
        if (isHex(x1) && x1.length <= 32 && Number.isInteger(size) && size >= 2 && size <= 16) {
          xn1 = x1.toLowerCase();
          xn2Size = size;
        }
      } else if (msg.method === "mining.set_difficulty") {
        const d = Array.isArray(msg.params) ? msg.params[0] : void 0;
        if (typeof d === "number" && Number.isFinite(d) && d > 0) difficulty = d;
      } else if (msg.method === "client.reconnect") {
        return null;
      } else if (msg.method === void 0 && msg.id !== void 0 && msg.id !== null) {
        const asked = pending.get(idKey(msg.id));
        if (asked) {
          pending.delete(idKey(msg.id));
          if (asked.kind === "subscribe" && Array.isArray(msg.result)) {
            const [, x1, size] = msg.result;
            if (isHex(x1) && x1.length <= 32 && Number.isInteger(size) && size >= 2 && size <= 16) {
              xn1 = x1.toLowerCase();
              xn2Size = size;
            }
          } else if (asked.kind === "submit" && onResult && asked.shareId) {
            const result = {
              type: "result",
              v: 1,
              share: asked.shareId,
              time: (/* @__PURE__ */ new Date()).toISOString(),
              accepted: msg.result === true,
              error: msg.error ?? null
            };
            Promise.resolve().then(() => onResult(result)).catch((err) => log(`recording a share result failed: ${err.message}`));
          }
        }
      }
      return line;
    };
    return { fromClient, fromPool };
  };
}
export {
  BRIDGE_FEATURES,
  BRIDGE_USAGE,
  createBridge,
  createShareAuditor,
  createWorkerBridge,
  parseBridgeArgs,
  runBridgeCli
};
