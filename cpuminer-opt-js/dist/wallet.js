import {
  buildPayment,
  payout
} from "./chunks/chunk-MGOMGXAX.js";
import {
  addressScript,
  createWallet,
  isValidAddress,
  walletFromMnemonic
} from "./chunks/chunk-S62YAEXG.js";

// src/wallet/chain.ts
var HASH_RE = /^[0-9a-f]{64}$/;
var checkHash = (hash, what = "block hash") => {
  if (!HASH_RE.test(hash)) throw new Error(`invalid ${what}`);
};
var btcToSats = (value) => BigInt(Math.round(Number(value) * 1e8));
function esplora(baseUrl = "https://mempool.space/api", { fetch: doFetch = globalThis.fetch } = {}) {
  const base = baseUrl.replace(/\/+$/, "");
  async function get(path, as = "json") {
    const res = await doFetch(base + path);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`${base}${path}: HTTP ${res.status}`);
    return as === "json" ? res.json() : (await res.text()).trim();
  }
  const tx = (txid) => {
    checkHash(txid, "txid");
    return get(`/tx/${txid}`);
  };
  return {
    async tipHeight() {
      return Number(await get("/blocks/tip/height", "text"));
    },
    async block(hash) {
      checkHash(hash);
      const s = await get(`/block/${hash}/status`);
      return s ? { inBestChain: s.in_best_chain === true, height: s.height ?? null } : null;
    },
    async coinbase(hash) {
      checkHash(hash);
      const txid = await get(`/block/${hash}/txid/0`, "text");
      const t = txid ? await tx(txid) : null;
      if (!t?.vin?.[0]?.is_coinbase) return null;
      return {
        txid,
        outputs: t.vout.map((o) => ({ script: String(o.scriptpubkey).toLowerCase(), value: BigInt(o.value) }))
      };
    },
    async utxos(address) {
      const list = await get(`/address/${encodeURIComponent(address)}/utxo`) ?? [];
      return list.map((u) => ({
        txid: u.txid,
        vout: u.vout,
        value: BigInt(u.value),
        height: u.status?.confirmed ? u.status.block_height : null
      }));
    },
    async isCoinbase(txid) {
      return (await tx(txid))?.vin?.[0]?.is_coinbase === true;
    },
    async feeRate() {
      const f = await get("/v1/fees/recommended");
      if (f && Number.isFinite(f.halfHourFee)) return f.halfHourFee;
      const e = await get("/fee-estimates");
      if (e && Number.isFinite(e["3"])) return e["3"];
      throw new Error("no fee estimate available");
    },
    async broadcast(hex) {
      const res = await doFetch(`${base}/tx`, { method: "POST", body: hex, headers: { "content-type": "text/plain" } });
      const text = (await res.text()).trim();
      if (!res.ok) throw new Error(`broadcast rejected: ${text.slice(0, 300)}`);
      return text;
    }
  };
}
function bitcoinCore({ url, user, pass, fallbackFeeRate = 2, fetch: doFetch = globalThis.fetch }) {
  let nextId = 1;
  const auth = `Basic ${btoa(`${user}:${pass}`)}`;
  const rpc = async (method, params = []) => {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ jsonrpc: "1.0", id: nextId++, method, params })
    });
    const text = await res.text();
    let body;
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
      return rpc("getblockcount");
    },
    async block(hash) {
      checkHash(hash);
      try {
        const h = await rpc("getblockheader", [hash, true]);
        return { inBestChain: h.confirmations >= 0, height: h.height };
      } catch (err) {
        if (err.code === -5) return null;
        throw err;
      }
    },
    async coinbase(hash) {
      checkHash(hash);
      const cb = (await rpc("getblock", [hash, 2])).tx[0];
      return { txid: cb.txid, outputs: cb.vout.map((o) => ({ script: String(o.scriptPubKey.hex).toLowerCase(), value: btcToSats(o.value) })) };
    },
    async utxos(address) {
      const r = await rpc("scantxoutset", ["start", [`addr(${address})`]]);
      return r.unspents.map((u) => ({ txid: u.txid, vout: u.vout, value: btcToSats(u.amount), height: u.height, coinbase: u.coinbase }));
    },
    async isCoinbase(txid, height) {
      const blockHash = await rpc("getblockhash", [height]);
      const t = await rpc("getrawtransaction", [txid, true, blockHash]);
      return Boolean(t.vin?.[0]?.coinbase);
    },
    async feeRate() {
      const e = await rpc("estimatesmartfee", [6]).catch(() => null);
      return e?.feerate ? Math.ceil(e.feerate * 1e8 / 1e3) : fallbackFeeRate;
    },
    async broadcast(hex) {
      return rpc("sendrawtransaction", [hex]);
    }
  };
}
export {
  addressScript,
  bitcoinCore,
  buildPayment,
  createWallet,
  esplora,
  isValidAddress,
  payout,
  walletFromMnemonic
};
