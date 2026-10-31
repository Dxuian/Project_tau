// Shared test helpers: a mock chain, an easy synthetic block, regtest access.
import { createHash } from 'node:crypto';
import { addressScript, bitcoinCore, mineBTC, rebuildBlockHeader } from '../btc.js';

export const OWNER_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(condition, ms = 5000, what = 'a condition') {
  const end = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

const sha256 = (b) => createHash('sha256').update(b).digest();

/** txid of a raw transaction: hash of its serialization without the segwit marker and witnesses. */
export function txidOf(hex) {
  const b = Buffer.from(hex, 'hex');
  if (b[4] !== 0) return Buffer.from(sha256(sha256(b))).reverse().toString('hex');
  let at = 6;
  const varint = () => {
    const f = b[at++];
    if (f < 0xfd) return f;
    if (f === 0xfd) return b.readUInt16LE((at += 2) - 2);
    return b.readUInt32LE((at += 4) - 4);
  };
  const nIn = varint();
  for (let i = 0; i < nIn; i++) {
    at += 36;
    const script = varint();
    at += script + 4;
  }
  const nOut = varint();
  for (let i = 0; i < nOut; i++) {
    at += 8;
    const script = varint();
    at += script;
  }
  // version | inputs and outputs (without marker and flag) | locktime
  const plain = Buffer.concat([b.subarray(0, 4), b.subarray(6, at), b.subarray(b.length - 4)]);
  return Buffer.from(sha256(sha256(plain))).reverse().toString('hex');
}

const le64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b.toString('hex');
};

/**
 * Feeds one visitor's block-finding share through an auditor (service.intercept):
 * a job paying `owner` `reward`, with an easy target (nbits 207fffff).
 */
export async function findBlockThrough(intercept, visitor, { owner = OWNER, reward = 312_500_000n, seed = 1, network = 'mainnet' } = {}) {
  const job = {
    prevhash: seed.toString(16).padStart(64, '0'),
    coinb1: '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + '0c' + '03' + seed.toString(16).padStart(6, '0'),
    coinb2: 'ffffffff' + '01' + le64(reward) + '16' + addressScript(owner, network) + '00000000',
    merkle: [],
    version: '20000000',
    nbits: '207fffff',
    ntime: '66000000',
  };
  const audit = intercept({ id: seed, peer: 'p', target: 'pool:3333', tls: false, origin: null, query: new URLSearchParams(), reply() {}, close() {} });
  await audit.fromClient(JSON.stringify({ id: 1, method: 'mining.subscribe', params: [] }));
  await audit.fromPool(JSON.stringify({ id: 1, result: [[], 'abcd0123', 4], error: null }));
  await audit.fromClient(JSON.stringify({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] }));
  await audit.fromPool(JSON.stringify({ id: null, method: 'mining.notify', params: ['j', job.prevhash, job.coinb1, job.coinb2, [], job.version, job.nbits, job.ntime, true] }));
  let nonce = 0;
  let rebuilt;
  do {
    rebuilt = rebuildBlockHeader({ ...job, xn1: 'abcd0123', xn2: '00000000', nonce: (++nonce).toString(16).padStart(8, '0') });
  } while (!rebuilt.isBlock);
  await audit.fromClient(JSON.stringify({ id: 3, method: 'mining.submit', params: [visitor, 'j', '00000000', job.ntime, nonce.toString(16).padStart(8, '0')] }));
  return { blockHash: rebuilt.blockHash, coinbaseTxid: rebuilt.coinbaseTxid, reward, ownerScript: addressScript(owner, network) };
}

/** A chain on which `found` is a block 100 deep paying the owner. */
export function mockChainWith(found, { tip = 1099 } = {}) {
  const chain = {
    tip,
    broadcasts: [],
    blocks: { [found.blockHash]: { inBestChain: true, height: 1000 } },
    async tipHeight() {
      return chain.tip;
    },
    async block(hash) {
      return chain.blocks[hash] ?? null;
    },
    async coinbase(hash) {
      return hash === found.blockHash ? { txid: found.coinbaseTxid, outputs: [{ script: found.ownerScript, value: found.reward }] } : null;
    },
    async utxos() {
      return [{ txid: found.coinbaseTxid, vout: 0, value: found.reward, height: 1000, coinbase: true }];
    },
    async isCoinbase() {
      return true;
    },
    async feeRate() {
      return 5;
    },
    async broadcast(hex) {
      chain.broadcasts.push(hex);
      return txidOf(hex);
    },
  };
  return chain;
}

/** The regtest node started by ./dev test, or null. */
export function regtest() {
  const url = process.env.BITCOIND_RPC;
  return url ? bitcoinCore({ url, user: process.env.BITCOIND_USER, pass: process.env.BITCOIND_PASS }) : null;
}

export async function nodeReady(core) {
  await until(() => core.rpc('getblockchaininfo').then(() => true, () => false), 30_000, 'bitcoind');
}

export const regtestChainEnv = () => ({
  TAU_CHAIN: 'bitcoin-core',
  TAU_CHAIN_URL: process.env.BITCOIND_RPC,
  TAU_CHAIN_USER: process.env.BITCOIND_USER,
  TAU_CHAIN_PASS: process.env.BITCOIND_PASS,
});

/** Mines through `bridgeUrl` until the regtest pool has `count` more blocks, then stops. */
export async function mineBlocks(address, bridgeUrl, pool, count = 1) {
  const before = pool.found.length;
  const miner = await mineBTC(address, bridgeUrl, { pool: pool.url, network: 'regtest', threads: 2, backend: 'wasm-sha256-x8', gpu: false });
  try {
    await until(() => pool.found.length >= before + count, 120_000, 'a block');
  } finally {
    await miner.stop();
  }
  return pool.found.slice(before);
}

/** Satoshis a block's coinbase pays `address`, according to bitcoind (regtest halves every 150 blocks). */
export async function ownerReward(core, blockHash, address) {
  const cb = (await core.rpc('getblock', [blockHash, 2])).tx[0];
  return cb.vout.filter((o) => o.scriptPubKey.address === address).reduce((sum, o) => sum + BigInt(Math.round(o.value * 1e8)), 0n);
}
