// Proving a share is a block: rebuild the header a stratum share describes,
// hash it, and check the chain agrees.
import { concat, fromHex, leBigInt, reversed, sha256d, swap32, toHex } from '../wallet/bytes.ts';
import type { ChainClient } from '../wallet/chain.ts';

/** A stratum job's fields as mining.notify sends them (hex). */
export interface JobFields {
  /** Word-swapped, as in mining.notify. */
  prevhash: string;
  coinb1: string;
  coinb2: string;
  merkle: string[];
  version: string;
  nbits: string;
}

/** A job plus the share's own fields. */
export interface ShareFields extends JobFields {
  xn1: string;
  xn2: string;
  ntime: string;
  nonce: string;
}

export interface RebuiltBlock {
  header: string;
  /** Display (big-endian) hash. */
  blockHash: string;
  coinbase: string;
  coinbaseTxid: string;
  /** The hash meets the block's own target (nbits). */
  isBlock: boolean;
}

/** Block target from compact nbits (hex); 0n if invalid or negative. */
export function nbitsTarget(nbits: string): bigint {
  if (!/^[0-9a-f]{8}$/i.test(nbits)) return 0n;
  const n = parseInt(nbits, 16) >>> 0;
  const exponent = n >>> 24;
  const mantissa = BigInt(n & 0x7fffff);
  if (n & 0x800000) return 0n;
  return exponent <= 3 ? mantissa >> BigInt(8 * (3 - exponent)) : mantissa << BigInt(8 * (exponent - 3));
}

/** Rebuilds and hashes the block header a share describes. Throws on malformed fields. */
export function rebuildBlockHeader(f: ShareFields): RebuiltBlock {
  if (!Array.isArray(f.merkle) || f.merkle.length > 32) throw new Error('invalid merkle branch');
  const coinbase = concat(fromHex(f.coinb1), fromHex(f.xn1), fromHex(f.xn2), fromHex(f.coinb2));
  let root = sha256d(coinbase);
  for (const branch of f.merkle) root = sha256d(concat(root, fromHex(branch, 32)));
  const header = concat(
    reversed(fromHex(f.version, 4)),
    swap32(fromHex(f.prevhash, 32)),
    root,
    reversed(fromHex(f.ntime, 4)),
    reversed(fromHex(f.nbits, 4)),
    reversed(fromHex(f.nonce, 4)),
  );
  const hash = sha256d(header);
  const target = nbitsTarget(f.nbits);
  return {
    header: toHex(header),
    blockHash: toHex(reversed(hash)),
    coinbase: toHex(coinbase),
    coinbaseTxid: toHex(reversed(sha256d(coinbase))),
    isBlock: target > 0n && leBigInt(hash) <= target,
  };
}

function readVarInt(b: Uint8Array, at: number): [number, number] {
  if (at >= b.length) throw new Error('truncated transaction');
  const first = b[at];
  if (first < 0xfd) return [first, at + 1];
  if (first === 0xfd) return [b[at + 1] | (b[at + 2] << 8), at + 3];
  if (first === 0xfe) return [(b[at + 1] | (b[at + 2] << 8) | (b[at + 3] << 16) | (b[at + 4] << 24)) >>> 0, at + 5];
  throw new Error('length too large');
}

/** Outputs of a coinbase transaction (non-witness serialization, as stratum sends it). */
export function coinbaseOutputs(coinbaseHex: string): { value: bigint; script: string }[] {
  const b = fromHex(coinbaseHex);
  let at = 4;
  if (b[at] === 0) throw new Error('unexpected witness serialization');
  let n: number;
  let len: number;
  [n, at] = readVarInt(b, at);
  if (n !== 1) throw new Error('a coinbase has one input');
  [len, at] = readVarInt(b, at + 36);
  at += len + 4;
  [n, at] = readVarInt(b, at);
  const outputs = [];
  for (let i = 0; i < n; i++) {
    if (at + 8 > b.length) throw new Error('truncated transaction');
    const value = leBigInt(b.subarray(at, at + 8));
    [len, at] = readVarInt(b, at + 8);
    if (at + len > b.length) throw new Error('truncated transaction');
    outputs.push({ value, script: toHex(b.subarray(at, at + len)) });
    at += len;
  }
  if (at + 4 !== b.length) throw new Error('unexpected trailing bytes');
  return outputs;
}

/** Satoshis that `outputs` pay to `scriptHex`. */
export function paidTo(outputs: { value: bigint; script: string }[], scriptHex: string): bigint {
  return outputs.reduce((sum, o) => (o.script === scriptHex ? sum + o.value : sum), 0n);
}

export type BlockCheck =
  | { status: 'verified'; height: number; confirmations: number; rewardSats: bigint }
  | { status: 'not-in-chain' }
  | { status: 'immature'; height: number; confirmations: number }
  | { status: 'not-ours'; height: number; error: string };

/**
 * Checks a rebuilt block against the chain: in the best chain, at least
 * `minConfirmations` deep, its coinbase is exactly the rebuilt one, and it pays
 * `payToScript`. Read-only.
 */
export async function verifyBlock(
  block: RebuiltBlock,
  { chain, payToScript, minConfirmations = 100 }: { chain: ChainClient; payToScript: string; minConfirmations?: number },
): Promise<BlockCheck> {
  if (!block.isBlock) return { status: 'not-in-chain' };
  const status = await chain.block(block.blockHash);
  if (!status || !status.inBestChain || status.height === null) return { status: 'not-in-chain' };
  const confirmations = (await chain.tipHeight()) - status.height + 1;
  if (confirmations < minConfirmations) return { status: 'immature', height: status.height, confirmations };
  const cb = await chain.coinbase(block.blockHash);
  if (!cb || cb.txid !== block.coinbaseTxid) {
    return { status: 'not-ours', height: status.height, error: "the block's coinbase is not the one from this share" };
  }
  const rewardSats = paidTo(cb.outputs, payToScript);
  if (rewardSats <= 0n) return { status: 'not-ours', height: status.height, error: 'the coinbase does not pay this address' };
  return { status: 'verified', height: status.height, confirmations, rewardSats };
}
