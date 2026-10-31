import {
  concat,
  fromHex,
  leBigInt,
  reversed,
  sha256d,
  swap32,
  toHex
} from "./chunk-S62YAEXG.js";

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

export {
  nbitsTarget,
  rebuildBlockHeader,
  coinbaseOutputs,
  paidTo,
  verifyBlock
};
