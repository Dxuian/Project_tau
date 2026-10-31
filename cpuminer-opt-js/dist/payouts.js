import {
  buildPayment
} from "./chunks/chunk-MGOMGXAX.js";
import {
  coinbaseOutputs,
  nbitsTarget,
  paidTo,
  rebuildBlockHeader,
  verifyBlock
} from "./chunks/chunk-TF2SH2BN.js";
import {
  addressScript,
  deriveKey
} from "./chunks/chunk-S62YAEXG.js";

// src/payouts/engine.ts
var COINBASE_MATURITY = 100;
var queues = /* @__PURE__ */ new WeakMap();
function serialized(key, fn) {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  queues.set(key, run.catch(() => {
  }));
  return run;
}
function percent(value) {
  const p = typeof value === "bigint" ? value : Number.isInteger(value) ? BigInt(value) : -1n;
  if (p < 1n || p > 100n) throw new Error("sharePercent must be a whole number from 1 to 100");
  return p;
}
function verifyPayout(address, options) {
  const network = options.network ?? "mainnet";
  addressScript(address, network);
  const share = percent(options.sharePercent);
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
  coinbaseOutputs,
  memoryStores,
  nbitsTarget,
  paidTo,
  payoutAll,
  rebuildBlockHeader,
  verifyBlock,
  verifyPayout
};
