// A payout service: the share auditor and the payout engine wired to one
// owner wallet, so the addresses visitors are logged in to the pool as and the
// wallet that pays them can't drift apart. Every value is a parameter; the
// caller brings the storage, the chain client and the owner's keys.
//
// With `addressPeriod`, visitors mine to a fresh address of the owner wallet
// per period (slot N is receive index N; see slots.ts); otherwise everyone
// mines to `ownerAddress`, the wallet's first address.
import type { BridgeConnection, BridgeInterceptor } from '../bridge/core.ts';
import type { ChainClient } from '../wallet/chain.ts';
import { isValidAddress, walletKeys, watchKeys, type NetworkName } from '../wallet/keys.ts';
import { createShareAuditor } from './auditor.ts';
import { checkSharePercent, payoutAll, verifyPayout, type PayoutOptions, type PayoutResult } from './engine.ts';
import { addressSlot, slotTimes, type SlotOptions } from './slots.ts';
import type { PayoutLedger, ShareStore } from './stores.ts';

export interface PayoutServiceOptions {
  /** The owner wallet's first address (receive index 0): payout change goes here, and without `addressPeriod` every visitor mines to it. */
  ownerAddress: string;
  /**
   * The owner wallet's words; they must give `ownerAddress` as their first
   * address. Without them shares are recorded but nothing is paid.
   */
  ownerMnemonic?: string;
  /** The owner wallet's account public key (accountXpub): derives the pool logins without the words. */
  ownerXpub?: string;
  /** A fresh owner address per period: slot N (1 + periods since the epoch) is receive index N. */
  addressPeriod?: SlotOptions;
  /** The finder's share of the owner's block reward, whole percent 1..100. */
  sharePercent: number | bigint;
  network?: NetworkName;
  shares: ShareStore;
  ledger: PayoutLedger;
  /** Confirms blocks and sends payments; required with `ownerMnemonic`. */
  chain?: ChainClient;
  /** At least 100 (coinbase maturity); default 100. */
  minConfirmations?: number;
  feeRate?: number;
  maxFeeRate?: number;
  /** Receive index payouts send their change to. Default 0, `ownerAddress`. */
  changeIndex?: number;
  /** The auditor's limit per connection (default 50). */
  maxSharesPer10s?: number;
  log?: (line: string) => void;
  /** The clock, in ms (tests). Default Date.now. */
  now?: () => number;
}

/** An owner address visitors mine to, and the time it's handed out for (null: always). */
export interface MiningAddress {
  address: string;
  index: number;
  from: string | null;
  until: string | null;
}

export interface PayoutService {
  ownerAddress: string;
  network: NetworkName;
  /** Whether it has the owner's words, so verifyPayout and payoutAll can pay. */
  canPay: boolean;
  /** The owner address visitors who connect at `time` mine to. */
  addressFor(time?: number): MiningAddress;
  /** The bridge interceptor (createFetchBridge or createBridge `intercept`). */
  intercept: (connection: BridgeConnection) => BridgeInterceptor;
  /** Pays `address` its share of each block it found, once (see verifyPayout in the engine). */
  verifyPayout(address: string): Promise<PayoutResult[]>;
  /** verifyPayout for every visitor with a recorded block. */
  payoutAll(): Promise<Record<string, PayoutResult[]>>;
}

export function createPayoutService(options: PayoutServiceOptions): PayoutService {
  const { ownerAddress, ownerMnemonic, ownerXpub, addressPeriod, shares, ledger, chain, network = 'mainnet', now = Date.now } = options;
  if (!isValidAddress(ownerAddress, network)) throw new Error(`ownerAddress must be a ${network} address`);
  if (!shares || !ledger) throw new Error('shares and ledger are required');
  checkSharePercent(options.sharePercent);
  if (addressPeriod) addressSlot(addressPeriod.epochMs, addressPeriod); // checks the options

  // The owner wallet's receive addresses, from the xpub where possible (cheap), else from the words.
  const watch = ownerXpub ? watchKeys(ownerXpub, network) : null;
  const keys = ownerMnemonic ? walletKeys(ownerMnemonic, network) : null;
  if (keys && keys.key(0).address !== ownerAddress) throw new Error('ownerMnemonic is not the wallet of ownerAddress (its first address)');
  if (watch && watch.address(0).address !== ownerAddress) throw new Error('ownerXpub is not the wallet of ownerAddress (its first address)');
  if (ownerMnemonic && !chain) throw new Error('a chain client is required to pay');
  if (addressPeriod && !watch && !keys) throw new Error('fresh addresses need ownerXpub or ownerMnemonic');
  const addresses = new Map<number, string>();
  const addressAt = (index: number): string => {
    let address = addresses.get(index);
    if (address === undefined) {
      address = watch ? watch.address(index).address : keys!.key(index).address;
      if (addresses.size >= 64) addresses.clear();
      addresses.set(index, address);
    }
    return address;
  };

  const addressFor = (time = now()): MiningAddress => {
    if (!addressPeriod) return { address: ownerAddress, index: 0, from: null, until: null };
    const index = addressSlot(time, addressPeriod);
    const { from, until } = slotTimes(index, addressPeriod);
    return { address: addressAt(index), index, from: new Date(from).toISOString(), until: new Date(until).toISOString() };
  };

  const intercept = createShareAuditor({
    // A connection may keep the slot its page was shown (?slot=N) if that is the
    // current or the previous one: someone who loaded the page just before the
    // hour turned still mines to the address they were shown.
    poolUser: addressPeriod
      ? ({ connection }) => {
          const current = addressSlot(now(), addressPeriod);
          const asked = Number(connection.query.get('slot'));
          const index = asked === current || (asked === current - 1 && asked >= 1) ? asked : current;
          return { address: addressAt(index), index };
        }
      : ownerAddress,
    network,
    onShare: (record) => shares.add(record),
    onResult: (result) => shares.addResult?.(result),
    maxSharesPer10s: options.maxSharesPer10s,
    log: options.log,
  });
  const payoutOptions = (): PayoutOptions => {
    if (!ownerMnemonic || !chain) throw new Error('no owner mnemonic: this service records shares but cannot pay');
    return {
      shares,
      ledger,
      chain,
      ownerMnemonic,
      sharePercent: options.sharePercent,
      network,
      minConfirmations: options.minConfirmations,
      feeRate: options.feeRate,
      maxFeeRate: options.maxFeeRate,
      changeIndex: options.changeIndex,
    };
  };

  return {
    ownerAddress,
    network,
    canPay: !!ownerMnemonic,
    addressFor,
    intercept,
    verifyPayout: async (address) => verifyPayout(address, payoutOptions()),
    payoutAll: async () => payoutAll(payoutOptions()),
  };
}
