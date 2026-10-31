// A payout service: the share auditor and the payout engine wired to one
// owner, so the address visitors are logged in to the pool as and the wallet
// that pays them can't drift apart. Every value is a parameter; the caller
// brings the storage, the chain client and the owner's words.
import type { BridgeConnection, BridgeInterceptor } from '../bridge/core.ts';
import type { ChainClient } from '../wallet/chain.ts';
import { isValidAddress, walletFromMnemonic, type NetworkName } from '../wallet/keys.ts';
import { createShareAuditor } from './auditor.ts';
import { checkSharePercent, payoutAll, verifyPayout, type PayoutOptions, type PayoutResult } from './engine.ts';
import type { PayoutLedger, ShareStore } from './stores.ts';

export interface PayoutServiceOptions {
  /** The address the pool pays: every visitor is logged in to the pool as this address. */
  ownerAddress: string;
  /**
   * The owner wallet's words; they must give `ownerAddress` as their first
   * address. Without them shares are recorded but nothing is paid.
   */
  ownerMnemonic?: string;
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
  /** The auditor's limit per connection (default 50). */
  maxSharesPer10s?: number;
  log?: (line: string) => void;
}

export interface PayoutService {
  ownerAddress: string;
  network: NetworkName;
  /** Whether it has the owner's words, so verifyPayout and payoutAll can pay. */
  canPay: boolean;
  /** The bridge interceptor (createFetchBridge or createBridge `intercept`). */
  intercept: (connection: BridgeConnection) => BridgeInterceptor;
  /** Pays `address` its share of each block it found, once (see verifyPayout in the engine). */
  verifyPayout(address: string): Promise<PayoutResult[]>;
  /** verifyPayout for every visitor with a recorded block. */
  payoutAll(): Promise<Record<string, PayoutResult[]>>;
}

export function createPayoutService(options: PayoutServiceOptions): PayoutService {
  const { ownerAddress, ownerMnemonic, shares, ledger, chain, network = 'mainnet' } = options;
  if (!isValidAddress(ownerAddress, network)) throw new Error(`ownerAddress must be a ${network} address`);
  if (!shares || !ledger) throw new Error('shares and ledger are required');
  checkSharePercent(options.sharePercent);
  if (ownerMnemonic) {
    if (walletFromMnemonic(ownerMnemonic, { network }).address !== ownerAddress) {
      throw new Error('ownerMnemonic is not the wallet of ownerAddress (its first address)');
    }
    if (!chain) throw new Error('a chain client is required to pay');
  }

  const intercept = createShareAuditor({
    poolUser: ownerAddress,
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
    };
  };

  return {
    ownerAddress,
    network,
    canPay: !!ownerMnemonic,
    intercept,
    verifyPayout: async (address) => verifyPayout(address, payoutOptions()),
    payoutAll: async () => payoutAll(payoutOptions()),
  };
}
