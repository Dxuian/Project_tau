import {
  BRIDGE_FEATURES,
  LinePipe,
  MAX_MESSAGE_BYTES,
  buildAllowlist,
  parseTarget,
  poolTarget,
  requestedTarget
} from "./chunks/chunk-OEIUIVU2.js";
import {
  LineDecoder,
  MAX_LINE_BYTES,
  formatHostPort
} from "./chunks/chunk-TOFRYWU7.js";

// src/bridge/fetch.ts
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
function createFetchBridge(options) {
  const allow = buildAllowlist(options.allow);
  if (typeof options.connect !== "function") throw new Error("the fetch bridge needs connect(target)");
  if (typeof options.upgrade !== "function") throw new Error("the fetch bridge needs upgrade(request)");
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
      const peer = options.peer?.(request) || "unknown";
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
      const closePool = (socket) => {
        try {
          socket?.close();
        } catch {
        }
      };
      let pool;
      try {
        pool = options.connect({ host: target.host, port: target.port, tls });
        await withTimeout(pool.opened, timeoutMs);
      } catch (err) {
        closePool(pool);
        notifyClose();
        log(`${peer} refused: 502 could not connect to ${label}`);
        return text(502, `could not connect to ${label}: ${err.message}`);
      }
      let upgraded;
      try {
        upgraded = options.upgrade(request);
      } catch (err) {
        closePool(pool);
        notifyClose();
        log(`${peer}: upgrade failed: ${err.message}`);
        return text(500, "internal error");
      }
      const server = upgraded.socket;
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
        closePool(pool);
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
      const source = pool;
      void (async () => {
        const reader = source.readable.getReader();
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
      return upgraded.response;
    }
  };
}
export {
  BRIDGE_FEATURES,
  createFetchBridge,
  parseTarget,
  poolTarget
};
