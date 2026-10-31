import * as btc from '@scure/btc-signer';
export type NetworkName = 'mainnet' | 'testnet' | 'regtest';
type BtcNetwork = typeof btc.NETWORK;
/** The highest receive index: higher ones are hardened, which receive addresses aren't. */
export declare const MAX_INDEX: number;
/** btc-signer network parameters; throws on an unknown name. */
export declare function bitcoinNetwork(name?: string): BtcNetwork;
/** The output script (hex) an address pays to; throws if it isn't a valid address on `network`. */
export declare function addressScript(address: string, network?: NetworkName): string;
export declare function isValidAddress(address: unknown, network?: NetworkName): boolean;
export interface DerivedKey {
    path: string;
    address: string;
    /** Output script of `address`, hex. */
    script: string;
    privateKey: Uint8Array;
}
/**
 * A wallet's BIP84 receive keys, with the (slow) seed derived once: key(0) is
 * its first address. Internal: callers outside the library get addresses only.
 */
export declare function walletKeys(mnemonic: string, network?: NetworkName, passphrase?: string): {
    key(index: number): DerivedKey;
};
/** One BIP84 receive key of a wallet (index 0 is its first address). Internal. */
export declare function deriveKey(mnemonic: string, network?: NetworkName, passphrase?: string, index?: number): DerivedKey;
/**
 * The receive addresses of an account public key: xpub or zpub on mainnet,
 * tpub or vpub otherwise. Watch-only: it can't sign anything.
 */
export declare function watchKeys(xpub: string, network?: NetworkName): {
    address(index: number): {
        address: string;
        path: string;
        script: string;
    };
};
/**
 * The wallet's BIP84 account public key (m/84'/coin'/0'): an xpub on mainnet, a
 * tpub otherwise. It derives every receive address (newAddress({ xpub })) and
 * can't spend; it does reveal all of them, so keep it private.
 */
export declare function accountXpub(mnemonic: string, { network, passphrase }?: {
    network?: NetworkName;
    passphrase?: string;
}): string;
export interface Wallet {
    /** The 12 or 24 words. Show them to the user once; never send them to a server. */
    mnemonic: string;
    address: string;
    path: string;
    network: NetworkName;
    /** Which of the wallet's receive addresses `address` is: 0 is the first. */
    index: number;
}
/**
 * A new wallet from the platform's secure random generator: its words and its
 * first native SegWit address. Restorable in any BIP84 wallet (Sparrow, BlueWallet...).
 */
export declare function createWallet({ words, network }?: {
    words?: 12 | 24;
    network?: NetworkName;
}): Wallet;
/** An address of a wallet known only by its account public key (watch-only). */
export interface WatchWallet {
    /** The account public key (accountXpub) the address comes from. */
    xpub: string;
    address: string;
    path: string;
    network: NetworkName;
    index: number;
}
type FromWords = Pick<Wallet, 'mnemonic'> & Partial<Pick<Wallet, 'network' | 'index'>>;
type FromXpub = Pick<WatchWallet, 'xpub'> & Partial<Pick<WatchWallet, 'network' | 'index'>>;
/**
 * Another receive address of the same wallet: the one after `wallet.index`, or
 * the one at `index`. Returns the wallet at that address; pass it to the next
 * call to get the address after it (the library remembers nothing, so the same
 * wallet always gives the same address). Offline. A wallet given as
 * `{ xpub }` (accountXpub) gets its addresses without the words. Any BIP84
 * wallet restored from the words finds what these addresses receive, within
 * its gap limit (usually 20 unused addresses in a row). Wallets with a BIP39
 * passphrase aren't supported.
 */
export declare function newAddress(wallet: FromWords, options?: {
    index?: number;
}): Wallet;
export declare function newAddress(wallet: FromXpub, options?: {
    index?: number;
}): WatchWallet;
/** The address of an existing wallet (checks the words and their checksum). */
export declare function walletFromMnemonic(mnemonic: string, { network, passphrase }?: {
    network?: NetworkName;
    passphrase?: string;
}): {
    address: string;
    path: string;
    network: NetworkName;
};
export {};
