import * as btc from '@scure/btc-signer';
export type NetworkName = 'mainnet' | 'testnet' | 'regtest';
type BtcNetwork = typeof btc.NETWORK;
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
/** Derives the first BIP84 key of a wallet. Internal: callers outside the library get addresses only. */
export declare function deriveKey(mnemonic: string, network?: NetworkName, passphrase?: string): DerivedKey;
export interface Wallet {
    /** The 12 or 24 words. Show them to the user once; never send them to a server. */
    mnemonic: string;
    address: string;
    path: string;
    network: NetworkName;
}
/**
 * A new wallet from the platform's secure random generator: its words and its
 * first native SegWit address. Restorable in any BIP84 wallet (Sparrow, BlueWallet...).
 */
export declare function createWallet({ words, network }?: {
    words?: 12 | 24;
    network?: NetworkName;
}): Wallet;
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
