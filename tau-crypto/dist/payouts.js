import {
  buildPayment
} from "./chunks/chunk-E3XZQTDT.js";
import {
  addressScript,
  concat,
  deriveKey,
  fromHex,
  isHex,
  isValidAddress,
  leBigInt,
  reversed,
  sha256d,
  swap32,
  toHex,
  walletFromMnemonic
} from "./chunks/chunk-APBMG6TN.js";

// src/payouts/block.ts
function nbitsTarget(nbits) {
  if (!/^[0-9a-f]{8}$/i.test(nbits)) return 0n;
  const n = parseInt(nbits, 16) >>> 0;
  const exponent = n >>> 24;
  const mantissa = BigInt(n & 8388607);
  if (n & 8388608) return 0n;
  return exponent <= 3 ? mantissa >> BigInt(8 * (3 - exponent)) : mantissa << BigInt(8 * (exponent - 3));
}
function rebuildBlockHeader(f) {
  if (!Array.isArray(f.merkle) || f.merkle.length > 32) throw new Error("invalid merkle branch");
  const coinbase = concat(fromHex(f.coinb1), fromHex(f.xn1), fromHex(f.xn2), fromHex(f.coinb2));
  let root = sha256d(coinbase);
  for (const branch of f.merkle) root = sha256d(concat(root, fromHex(branch, 32)));
  const header = concat(
    reversed(fromHex(f.version, 4)),
    swap32(fromHex(f.prevhash, 32)),
    root,
    reversed(fromHex(f.ntime, 4)),
    reversed(fromHex(f.nbits, 4)),
    reversed(fromHex(f.nonce, 4))
  );
  const hash = sha256d(header);
  const target = nbitsTarget(f.nbits);
  return {
    header: toHex(header),
    blockHash: toHex(reversed(hash)),
    coinbase: toHex(coinbase),
    coinbaseTxid: toHex(reversed(sha256d(coinbase))),
    isBlock: target > 0n && leBigInt(hash) <= target
  };
}
function readVarInt(b, at) {
  if (at >= b.length) throw new Error("truncated transaction");
  const first = b[at];
  if (first < 253) return [first, at + 1];
  if (first === 253) return [b[at + 1] | b[at + 2] << 8, at + 3];
  if (first === 254) return [(b[at + 1] | b[at + 2] << 8 | b[at + 3] << 16 | b[at + 4] << 24) >>> 0, at + 5];
  throw new Error("length too large");
}
function coinbaseOutputs(coinbaseHex) {
  const b = fromHex(coinbaseHex);
  let at = 4;
  if (b[at] === 0) throw new Error("unexpected witness serialization");
  let n;
  let len;
  [n, at] = readVarInt(b, at);
  if (n !== 1) throw new Error("a coinbase has one input");
  [len, at] = readVarInt(b, at + 36);
  at += len + 4;
  [n, at] = readVarInt(b, at);
  const outputs = [];
  for (let i = 0; i < n; i++) {
    if (at + 8 > b.length) throw new Error("truncated transaction");
    const value = leBigInt(b.subarray(at, at + 8));
    [len, at] = readVarInt(b, at + 8);
    if (at + len > b.length) throw new Error("truncated transaction");
    outputs.push({ value, script: toHex(b.subarray(at, at + len)) });
    at += len;
  }
  if (at + 4 !== b.length) throw new Error("unexpected trailing bytes");
  return outputs;
}
function paidTo(outputs, scriptHex) {
  return outputs.reduce((sum, o) => o.script === scriptHex ? sum + o.value : sum, 0n);
}
async function verifyBlock(block, { chain, payToScript, minConfirmations = 100 }) {
  if (!block.isBlock) return { status: "not-in-chain" };
  const status = await chain.block(block.blockHash);
  if (!status || !status.inBestChain || status.height === null) return { status: "not-in-chain" };
  const confirmations = await chain.tipHeight() - status.height + 1;
  if (confirmations < minConfirmations) return { status: "immature", height: status.height, confirmations };
  const cb = await chain.coinbase(block.blockHash);
  if (!cb || cb.txid !== block.coinbaseTxid) {
    return { status: "not-ours", height: status.height, error: "the block's coinbase is not the one from this share" };
  }
  const rewardSats = paidTo(cb.outputs, payToScript);
  if (rewardSats <= 0n) return { status: "not-ours", height: status.height, error: "the coinbase does not pay this address" };
  return { status: "verified", height: status.height, confirmations, rewardSats };
}

// src/payouts/auditor.ts
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

// src/payouts/engine.ts
var COINBASE_MATURITY = 100;
var queues = /* @__PURE__ */ new WeakMap();
function serialized(key, fn) {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  queues.set(key, run.catch(() => {
  }));
  return run;
}
function checkSharePercent(value) {
  const p = typeof value === "bigint" ? value : Number.isInteger(value) ? BigInt(value) : -1n;
  if (p < 1n || p > 100n) throw new Error("sharePercent must be a whole number from 1 to 100");
  return p;
}
function verifyPayout(address, options) {
  const network = options.network ?? "mainnet";
  addressScript(address, network);
  const share = checkSharePercent(options.sharePercent);
  const minConfirmations = options.minConfirmations ?? COINBASE_MATURITY;
  if (minConfirmations < COINBASE_MATURITY) throw new Error(`minConfirmations must be at least ${COINBASE_MATURITY}`);
  if (!options.shares || !options.ledger || !options.chain) throw new Error("shares, ledger and chain are required");
  const owner = deriveKey(options.ownerMnemonic, network);
  return serialized(options.ledger, () => settle(address, { ...options, network, minConfirmations }, owner.script, share));
}
async function settle(address, options, ownerScript, share) {
  const { shares, ledger, chain } = options;
  const blocks = /* @__PURE__ */ new Map();
  for (const r of await shares.blocksFor(address)) {
    if (r.visitor !== address || !r.job) continue;
    let rebuilt;
    try {
      rebuilt = rebuildBlockHeader({ ...r.job, xn1: r.xn1, xn2: r.xn2, ntime: r.ntime, nonce: r.nonce });
    } catch {
      continue;
    }
    if (rebuilt.isBlock && rebuilt.blockHash === r.blockHash) blocks.set(rebuilt.blockHash, rebuilt);
  }
  const results = [];
  for (const [blockHash, rebuilt] of blocks) {
    const prior = await ledger.get(blockHash);
    if (prior) {
      results.push(
        prior.status === "sent" ? { blockHash, status: "already-paid", txid: prior.txid, payoutSats: BigInt(prior.amountSats) } : { blockHash, status: "needs-review", txid: prior.txid, error: "a payout was started but not confirmed as sent" }
      );
      continue;
    }
    if ((await shares.claimants(blockHash)).length > 1) {
      results.push({ blockHash, status: "needs-review", error: "more than one visitor recorded for this block" });
      continue;
    }
    const check = await verifyBlock(rebuilt, { chain, payToScript: ownerScript, minConfirmations: options.minConfirmations });
    if (check.status !== "verified") {
      results.push({ blockHash, ...check });
      continue;
    }
    const base = { blockHash, height: check.height, confirmations: check.confirmations, rewardSats: check.rewardSats };
    const payoutSats = check.rewardSats * share / 100n;
    results.push(await pay(address, payoutSats, base, options));
  }
  return results;
}
async function pay(address, payoutSats, base, options) {
  const { ledger, chain } = options;
  const entry = { ...base, payoutSats };
  let built;
  for (let attempt = 0; attempt < 3 && !built; attempt++) {
    let candidate;
    try {
      candidate = await buildPayment(address, payoutSats, {
        mnemonic: options.ownerMnemonic,
        chain,
        network: options.network,
        feeRate: options.feeRate,
        maxFeeRate: options.maxFeeRate,
        exclude: await ledger.usedInputs()
      });
    } catch (err) {
      return { ...entry, status: "not-paid-yet", error: err.message };
    }
    const reserved = await ledger.reserve({
      blockHash: base.blockHash,
      visitor: address,
      status: "pending",
      rewardSats: String(base.rewardSats),
      amountSats: String(payoutSats),
      txid: candidate.txid,
      inputs: candidate.inputs,
      time: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (reserved === "reserved") built = candidate;
    else if (reserved === "block-taken") {
      const now = await ledger.get(base.blockHash);
      return now?.status === "sent" ? { ...entry, status: "already-paid", txid: now.txid } : { ...entry, status: "needs-review", txid: now?.txid, error: "another payout run is paying this block" };
    }
  }
  if (!built) return { ...entry, status: "not-paid-yet", error: "coins kept being claimed by concurrent payouts" };
  try {
    const txid = await chain.broadcast(built.hex);
    if (txid !== built.txid) throw new Error(`broadcast returned ${txid}`);
  } catch (err) {
    return { ...entry, status: "needs-review", txid: built.txid, error: err.message };
  }
  await ledger.markSent(base.blockHash, built.txid);
  return { ...entry, status: "paid", txid: built.txid, feeSats: built.feeSats };
}
async function payoutAll(options) {
  const out = {};
  for (const visitor of await options.shares.visitorsWithBlocks()) {
    try {
      out[visitor] = await verifyPayout(visitor, options);
    } catch (err) {
      out[visitor] = [{ blockHash: "", status: "needs-review", error: err.message }];
    }
  }
  return out;
}

// src/payouts/service.ts
function createPayoutService(options) {
  const { ownerAddress, ownerMnemonic, shares, ledger, chain, network = "mainnet" } = options;
  if (!isValidAddress(ownerAddress, network)) throw new Error(`ownerAddress must be a ${network} address`);
  if (!shares || !ledger) throw new Error("shares and ledger are required");
  checkSharePercent(options.sharePercent);
  if (ownerMnemonic) {
    if (walletFromMnemonic(ownerMnemonic, { network }).address !== ownerAddress) {
      throw new Error("ownerMnemonic is not the wallet of ownerAddress (its first address)");
    }
    if (!chain) throw new Error("a chain client is required to pay");
  }
  const intercept = createShareAuditor({
    poolUser: ownerAddress,
    network,
    onShare: (record) => shares.add(record),
    onResult: (result) => shares.addResult?.(result),
    maxSharesPer10s: options.maxSharesPer10s,
    log: options.log
  });
  const payoutOptions = () => {
    if (!ownerMnemonic || !chain) throw new Error("no owner mnemonic: this service records shares but cannot pay");
    return {
      shares,
      ledger,
      chain,
      ownerMnemonic,
      sharePercent: options.sharePercent,
      network,
      minConfirmations: options.minConfirmations,
      feeRate: options.feeRate,
      maxFeeRate: options.maxFeeRate
    };
  };
  return {
    ownerAddress,
    network,
    canPay: !!ownerMnemonic,
    intercept,
    verifyPayout: async (address) => verifyPayout(address, payoutOptions()),
    payoutAll: async () => payoutAll(payoutOptions())
  };
}

// src/payouts/stores.ts
function memoryStores() {
  const records = [];
  const entries = /* @__PURE__ */ new Map();
  const claimed = /* @__PURE__ */ new Map();
  const shares = {
    records,
    async add(r) {
      records.push(structuredClone(r));
    },
    async addResult() {
    },
    async blocksFor(visitor) {
      return records.filter((r) => r.isBlock && r.visitor === visitor).map((r) => structuredClone(r));
    },
    async claimants(blockHash) {
      return [...new Set(records.filter((r) => r.isBlock && r.blockHash === blockHash).map((r) => r.visitor))];
    },
    async visitorsWithBlocks() {
      return [...new Set(records.filter((r) => r.isBlock).map((r) => r.visitor))];
    }
  };
  const ledger = {
    entries,
    async get(blockHash) {
      const e = entries.get(blockHash);
      return e ? structuredClone(e) : null;
    },
    async reserve(entry) {
      if (entries.has(entry.blockHash)) return "block-taken";
      if (entry.inputs.some((i) => claimed.has(i))) return "inputs-taken";
      entries.set(entry.blockHash, { ...structuredClone(entry), status: "pending" });
      for (const i of entry.inputs) claimed.set(i, entry.blockHash);
      return "reserved";
    },
    async markSent(blockHash, txid) {
      const e = entries.get(blockHash);
      if (!e || e.txid !== txid) throw new Error(`no pending payout ${txid} for ${blockHash}`);
      e.status = "sent";
      e.sentTime = (/* @__PURE__ */ new Date()).toISOString();
    },
    async usedInputs() {
      return new Set(claimed.keys());
    },
    async void(blockHash) {
      const e = entries.get(blockHash);
      if (!e || e.status !== "pending") return false;
      entries.delete(blockHash);
      for (const i of e.inputs) claimed.delete(i);
      return true;
    }
  };
  return { shares, ledger };
}
export {
  checkSharePercent,
  coinbaseOutputs,
  createPayoutService,
  createShareAuditor,
  memoryStores,
  nbitsTarget,
  paidTo,
  payoutAll,
  rebuildBlockHeader,
  verifyBlock,
  verifyPayout
};
