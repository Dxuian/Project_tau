// Wallets: BIP39 words -> BIP84 (native SegWit, bc1q...) receive addresses
// (index 0 first, newAddress for the ones after it), the same addresses Sparrow
// and other BIP84 wallets derive. Entirely offline.
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { toHex } from './bytes.ts';

export type NetworkName = 'mainnet' | 'testnet' | 'regtest';
type BtcNetwork = typeof btc.NETWORK;

const REGTEST: BtcNetwork = Object.freeze({ bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef });
const NETWORKS: Record<NetworkName, BtcNetwork> = { mainnet: btc.NETWORK, testnet: btc.TEST_NETWORK, regtest: REGTEST };
// BIP84 account 0; receive addresses are <account>/0/<index>.
const ACCOUNTS: Record<NetworkName, string> = {
  mainnet: "m/84'/0'/0'",
  testnet: "m/84'/1'/0'",
  regtest: "m/84'/1'/0'",
};
const MAX_INDEX = 2 ** 31 - 1; // higher indexes are hardened, which receive addresses aren't

/** btc-signer network parameters; throws on an unknown name. */
export function bitcoinNetwork(name: string = 'mainnet'): BtcNetwork {
  const n = NETWORKS[name as NetworkName];
  if (!n) throw new Error(`unknown network "${name}" (mainnet, testnet or regtest)`);
  return n;
}

/** The output script (hex) an address pays to; throws if it isn't a valid address on `network`. */
export function addressScript(address: string, network: NetworkName = 'mainnet'): string {
  const n = bitcoinNetwork(network);
  if (typeof address !== 'string' || address.length < 14 || address.length > 90) throw new Error(`invalid ${network} address`);
  try {
    return toHex(btc.OutScript.encode(btc.Address(n).decode(address)));
  } catch {
    throw new Error(`invalid ${network} address: ${address}`);
  }
}

export function isValidAddress(address: unknown, network: NetworkName = 'mainnet'): boolean {
  try {
    addressScript(address as string, network);
    return true;
  } catch {
    return false;
  }
}

export interface DerivedKey {
  path: string;
  address: string;
  /** Output script of `address`, hex. */
  script: string;
  privateKey: Uint8Array;
}

function normalizeWords(mnemonic: string): string {
  return String(mnemonic ?? '').trim().toLowerCase().split(/\s+/).join(' ');
}

/**
 * Derives a BIP84 receive key of a wallet (index 0 is its first address).
 * Internal: callers outside the library get addresses only.
 */
export function deriveKey(mnemonic: string, network: NetworkName = 'mainnet', passphrase = '', index = 0): DerivedKey {
  const words = normalizeWords(mnemonic);
  if (!validateMnemonic(words, wordlist)) throw new Error('invalid mnemonic (unknown word or bad checksum)');
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_INDEX) throw new Error(`index must be a whole number from 0 to ${MAX_INDEX}`);
  const net = bitcoinNetwork(network);
  const path = `${ACCOUNTS[network]}/0/${index}`;
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(words, passphrase)).derive(path);
  if (!key.publicKey || !key.privateKey) throw new Error('key derivation failed');
  const payment = btc.p2wpkh(key.publicKey, net);
  if (!payment.address) throw new Error('key derivation failed');
  return { path, address: payment.address, script: toHex(payment.script), privateKey: key.privateKey };
}

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
export function createWallet({ words = 12, network = 'mainnet' }: { words?: 12 | 24; network?: NetworkName } = {}): Wallet {
  if (words !== 12 && words !== 24) throw new Error('words must be 12 or 24');
  bitcoinNetwork(network);
  const mnemonic = generateMnemonic(wordlist, words === 12 ? 128 : 256);
  const { address, path } = deriveKey(mnemonic, network);
  return { mnemonic, address, path, network, index: 0 };
}

/**
 * Another receive address of the same wallet: the one after `wallet.index`, or
 * the one at `index`. Returns the wallet at that address; pass it to the next
 * call to get the address after it (the library remembers nothing, so the same
 * wallet always gives the same address). Offline. Any BIP84 wallet restored
 * from the words finds what these addresses receive, within its gap limit
 * (usually 20 unused addresses in a row). Wallets with a BIP39 passphrase
 * aren't supported.
 */
export function newAddress(
  wallet: Pick<Wallet, 'mnemonic'> & Partial<Pick<Wallet, 'network' | 'index'>>,
  { index }: { index?: number } = {},
): Wallet {
  const network = wallet.network ?? 'mainnet';
  const next = index ?? (wallet.index ?? 0) + 1;
  const { address, path } = deriveKey(wallet.mnemonic, network, '', next);
  return { mnemonic: normalizeWords(wallet.mnemonic), address, path, network, index: next };
}

/** The address of an existing wallet (checks the words and their checksum). */
export function walletFromMnemonic(
  mnemonic: string,
  { network = 'mainnet', passphrase = '' }: { network?: NetworkName; passphrase?: string } = {},
): { address: string; path: string; network: NetworkName } {
  const { address, path } = deriveKey(mnemonic, network, passphrase);
  return { address, path, network };
}
