// Wallets: BIP39 words -> BIP84 (native SegWit, bc1q...) receive addresses
// (index 0 first, newAddress for the ones after it), the same addresses Sparrow
// and other BIP84 wallets derive. The account public key (accountXpub) derives
// them without the words. Entirely offline.
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HARDENED_OFFSET, HDKey } from '@scure/bip32';
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
/** The highest receive index: higher ones are hardened, which receive addresses aren't. */
export const MAX_INDEX = 2 ** 31 - 1;
// BIP32 version bytes of account keys: the standard xpub/tpub, and the SLIP-132
// zpub/vpub some wallets show for native SegWit accounts.
const KEY_VERSIONS = {
  xpub: { private: 0x0488ade4, public: 0x0488b21e },
  zpub: { private: 0x04b2430c, public: 0x04b24746 },
  tpub: { private: 0x04358394, public: 0x043587cf },
  vpub: { private: 0x045f18bc, public: 0x045f1cf6 },
} as const;

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

function checkIndex(index: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_INDEX) throw new Error(`index must be a whole number from 0 to ${MAX_INDEX}`);
}

function seedOf(mnemonic: string, passphrase: string): Uint8Array {
  const words = normalizeWords(mnemonic);
  if (!validateMnemonic(words, wordlist)) throw new Error('invalid mnemonic (unknown word or bad checksum)');
  return mnemonicToSeedSync(words, passphrase);
}

/**
 * A wallet's BIP84 receive keys, with the (slow) seed derived once: key(0) is
 * its first address. Internal: callers outside the library get addresses only.
 */
export function walletKeys(mnemonic: string, network: NetworkName = 'mainnet', passphrase = ''): { key(index: number): DerivedKey } {
  const seed = seedOf(mnemonic, passphrase);
  const net = bitcoinNetwork(network);
  const receive = HDKey.fromMasterSeed(seed).derive(ACCOUNTS[network]).deriveChild(0);
  return {
    key(index) {
      checkIndex(index);
      const key = receive.deriveChild(index);
      if (!key.publicKey || !key.privateKey) throw new Error('key derivation failed');
      const payment = btc.p2wpkh(key.publicKey, net);
      if (!payment.address) throw new Error('key derivation failed');
      return { path: `${ACCOUNTS[network]}/0/${index}`, address: payment.address, script: toHex(payment.script), privateKey: key.privateKey };
    },
  };
}

/** One BIP84 receive key of a wallet (index 0 is its first address). Internal. */
export function deriveKey(mnemonic: string, network: NetworkName = 'mainnet', passphrase = '', index = 0): DerivedKey {
  return walletKeys(mnemonic, network, passphrase).key(index);
}

/**
 * The receive addresses of an account public key: xpub or zpub on mainnet,
 * tpub or vpub otherwise. Watch-only: it can't sign anything.
 */
export function watchKeys(xpub: string, network: NetworkName = 'mainnet'): { address(index: number): { address: string; path: string; script: string } } {
  const net = bitcoinNetwork(network);
  const text = String(xpub ?? '').trim();
  const prefix = text.slice(0, 4);
  const allowed = network === 'mainnet' ? ['xpub', 'zpub'] : ['tpub', 'vpub'];
  if (!allowed.includes(prefix)) throw new Error(`expected a ${network} account public key (${allowed.join(' or ')})`);
  let account: HDKey;
  try {
    account = HDKey.fromExtendedKey(text, KEY_VERSIONS[prefix as keyof typeof KEY_VERSIONS]);
  } catch {
    throw new Error(`invalid ${prefix}`);
  }
  if (account.depth !== 3 || account.privateKey) throw new Error("expected an account public key (m/84'/coin'/account')");
  const accountNo = account.index >= HARDENED_OFFSET ? account.index - HARDENED_OFFSET : account.index;
  const coin = network === 'mainnet' ? 0 : 1;
  const receive = account.deriveChild(0);
  return {
    address(index) {
      checkIndex(index);
      const payment = btc.p2wpkh(receive.deriveChild(index).publicKey as Uint8Array, net);
      if (!payment.address) throw new Error('key derivation failed');
      return { address: payment.address, path: `m/84'/${coin}'/${accountNo}'/0/${index}`, script: toHex(payment.script) };
    },
  };
}

/**
 * The wallet's BIP84 account public key (m/84'/coin'/0'): an xpub on mainnet, a
 * tpub otherwise. It derives every receive address (newAddress({ xpub })) and
 * can't spend; it does reveal all of them, so keep it private.
 */
export function accountXpub(mnemonic: string, { network = 'mainnet', passphrase = '' }: { network?: NetworkName; passphrase?: string } = {}): string {
  const seed = seedOf(mnemonic, passphrase);
  bitcoinNetwork(network);
  const versions = network === 'mainnet' ? KEY_VERSIONS.xpub : KEY_VERSIONS.tpub;
  return HDKey.fromMasterSeed(seed, versions).derive(ACCOUNTS[network]).publicExtendedKey;
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
export function newAddress(wallet: FromWords, options?: { index?: number }): Wallet;
export function newAddress(wallet: FromXpub, options?: { index?: number }): WatchWallet;
export function newAddress(wallet: FromWords | FromXpub, { index }: { index?: number } = {}): Wallet | WatchWallet {
  const network = wallet.network ?? 'mainnet';
  const next = index ?? (wallet.index ?? 0) + 1;
  if ('xpub' in wallet && wallet.xpub !== undefined) {
    const { address, path } = watchKeys(wallet.xpub, network).address(next);
    return { xpub: String(wallet.xpub).trim(), address, path, network, index: next };
  }
  const { mnemonic } = wallet as FromWords;
  const { address, path } = deriveKey(mnemonic, network, '', next);
  return { mnemonic: normalizeWords(mnemonic), address, path, network, index: next };
}

/** The address of an existing wallet (checks the words and their checksum). */
export function walletFromMnemonic(
  mnemonic: string,
  { network = 'mainnet', passphrase = '' }: { network?: NetworkName; passphrase?: string } = {},
): { address: string; path: string; network: NetworkName } {
  const { address, path } = deriveKey(mnemonic, network, passphrase);
  return { address, path, network };
}
