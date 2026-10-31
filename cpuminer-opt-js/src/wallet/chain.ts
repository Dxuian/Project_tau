// Blockchain access for payments and payout verification: an Esplora REST API
// (mempool.space and compatible) or a Bitcoin Core node's JSON-RPC. Both use
// fetch, so they work in Node, browsers and Cloudflare Workers.

export interface ChainUtxo {
  txid: string;
  vout: number;
  /** Satoshis. */
  value: bigint;
  /** Height of the block that confirmed it, or null if unconfirmed. */
  height: number | null;
  /** Whether it is a coinbase output, when the source says (otherwise use isCoinbase). */
  coinbase?: boolean;
}

export interface ChainClient {
  tipHeight(): Promise<number>;
  /** null if the block is unknown. */
  block(hash: string): Promise<{ inBestChain: boolean; height: number | null } | null>;
  /** The block's coinbase transaction id and outputs (scripts as hex, values in satoshis). */
  coinbase(hash: string): Promise<{ txid: string; outputs: { script: string; value: bigint }[] } | null>;
  utxos(address: string): Promise<ChainUtxo[]>;
  isCoinbase(txid: string, height: number): Promise<boolean>;
  /** Suggested fee rate, sat/vB. */
  feeRate(): Promise<number>;
  /** Broadcasts a raw transaction; returns its txid. */
  broadcast(hex: string): Promise<string>;
}

type Fetch = typeof fetch;

const HASH_RE = /^[0-9a-f]{64}$/;
const checkHash = (hash: string, what = 'block hash') => {
  if (!HASH_RE.test(hash)) throw new Error(`invalid ${what}`);
};
const btcToSats = (value: unknown): bigint => BigInt(Math.round(Number(value) * 1e8));

/** Client for an Esplora REST API, default mempool.space (mainnet). */
export function esplora(baseUrl = 'https://mempool.space/api', { fetch: doFetch = globalThis.fetch }: { fetch?: Fetch } = {}): ChainClient {
  const base = baseUrl.replace(/\/+$/, '');
  async function get(path: string): Promise<any>;
  async function get(path: string, as: 'text'): Promise<string | null>;
  async function get(path: string, as: 'json' | 'text' = 'json'): Promise<any> {
    const res = await doFetch(base + path);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`${base}${path}: HTTP ${res.status}`);
    return as === 'json' ? res.json() : (await res.text()).trim();
  }
  const tx = (txid: string) => {
    checkHash(txid, 'txid');
    return get(`/tx/${txid}`);
  };
  return {
    async tipHeight() {
      return Number(await get('/blocks/tip/height', 'text'));
    },
    async block(hash) {
      checkHash(hash);
      const s = await get(`/block/${hash}/status`);
      return s ? { inBestChain: s.in_best_chain === true, height: s.height ?? null } : null;
    },
    async coinbase(hash) {
      checkHash(hash);
      const txid = await get(`/block/${hash}/txid/0`, 'text');
      const t = txid ? await tx(txid) : null;
      if (!t?.vin?.[0]?.is_coinbase) return null;
      return {
        txid: txid as string,
        outputs: t.vout.map((o: any) => ({ script: String(o.scriptpubkey).toLowerCase(), value: BigInt(o.value) })),
      };
    },
    async utxos(address) {
      const list = (await get(`/address/${encodeURIComponent(address)}/utxo`)) ?? [];
      return list.map((u: any) => ({
        txid: u.txid,
        vout: u.vout,
        value: BigInt(u.value),
        height: u.status?.confirmed ? u.status.block_height : null,
      }));
    },
    async isCoinbase(txid) {
      return (await tx(txid))?.vin?.[0]?.is_coinbase === true;
    },
    async feeRate() {
      const f = await get('/v1/fees/recommended');
      if (f && Number.isFinite(f.halfHourFee)) return f.halfHourFee;
      const e = await get('/fee-estimates');
      if (e && Number.isFinite(e['3'])) return e['3'];
      throw new Error('no fee estimate available');
    },
    async broadcast(hex) {
      const res = await doFetch(`${base}/tx`, { method: 'POST', body: hex, headers: { 'content-type': 'text/plain' } });
      const text = (await res.text()).trim();
      if (!res.ok) throw new Error(`broadcast rejected: ${text.slice(0, 300)}`);
      return text;
    },
  };
}

export interface BitcoinCoreOptions {
  /** JSON-RPC URL, e.g. http://127.0.0.1:8332 */
  url: string;
  user: string;
  pass: string;
  /** sat/vB when the node has no estimate yet (default 2). */
  fallbackFeeRate?: number;
  fetch?: Fetch;
}

/** Client for a Bitcoin Core node's JSON-RPC (no wallet needed). `rpc` calls any method. */
export function bitcoinCore({ url, user, pass, fallbackFeeRate = 2, fetch: doFetch = globalThis.fetch }: BitcoinCoreOptions): ChainClient & {
  rpc(method: string, params?: unknown[]): Promise<any>;
} {
  let nextId = 1;
  const auth = `Basic ${btoa(`${user}:${pass}`)}`;
  const rpc = async (method: string, params: unknown[] = []): Promise<any> => {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify({ jsonrpc: '1.0', id: nextId++, method, params }),
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { code: body.error.code });
    return body.result;
  };
  return {
    rpc,
    async tipHeight() {
      return rpc('getblockcount');
    },
    async block(hash) {
      checkHash(hash);
      try {
        const h = await rpc('getblockheader', [hash, true]);
        return { inBestChain: h.confirmations >= 0, height: h.height };
      } catch (err) {
        if ((err as { code?: number }).code === -5) return null; // not found
        throw err;
      }
    },
    async coinbase(hash) {
      checkHash(hash);
      const cb = (await rpc('getblock', [hash, 2])).tx[0];
      return { txid: cb.txid, outputs: cb.vout.map((o: any) => ({ script: String(o.scriptPubKey.hex).toLowerCase(), value: btcToSats(o.value) })) };
    },
    async utxos(address) {
      const r = await rpc('scantxoutset', ['start', [`addr(${address})`]]);
      return r.unspents.map((u: any) => ({ txid: u.txid, vout: u.vout, value: btcToSats(u.amount), height: u.height, coinbase: u.coinbase }));
    },
    async isCoinbase(txid, height) {
      const blockHash = await rpc('getblockhash', [height]);
      const t = await rpc('getrawtransaction', [txid, true, blockHash]);
      return Boolean(t.vin?.[0]?.coinbase);
    },
    async feeRate() {
      const e = await rpc('estimatesmartfee', [6]).catch(() => null);
      return e?.feerate ? Math.ceil((e.feerate * 1e8) / 1000) : fallbackFeeRate;
    },
    async broadcast(hex) {
      return rpc('sendrawtransaction', [hex]);
    },
  };
}
