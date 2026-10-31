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
    block(hash: string): Promise<{
        inBestChain: boolean;
        height: number | null;
    } | null>;
    /** The block's coinbase transaction id and outputs (scripts as hex, values in satoshis). */
    coinbase(hash: string): Promise<{
        txid: string;
        outputs: {
            script: string;
            value: bigint;
        }[];
    } | null>;
    utxos(address: string): Promise<ChainUtxo[]>;
    isCoinbase(txid: string, height: number): Promise<boolean>;
    /** Suggested fee rate, sat/vB. */
    feeRate(): Promise<number>;
    /** Broadcasts a raw transaction; returns its txid. */
    broadcast(hex: string): Promise<string>;
}
type Fetch = typeof fetch;
/** Client for an Esplora REST API, default mempool.space (mainnet). */
export declare function esplora(baseUrl?: string, { fetch: doFetch }?: {
    fetch?: Fetch;
}): ChainClient;
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
export declare function bitcoinCore({ url, user, pass, fallbackFeeRate, fetch: doFetch }: BitcoinCoreOptions): ChainClient & {
    rpc(method: string, params?: unknown[]): Promise<any>;
};
export {};
