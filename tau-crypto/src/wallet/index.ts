// tau-crypto/wallet: offline wallet creation and address checks, and
// payments from a wallet. Built on Paul Miller's audited @scure/@noble
// libraries (exact versions, reviewed in AUDIT.md), bundled into dist/.
export { accountXpub, addressScript, createWallet, isValidAddress, newAddress, walletFromMnemonic } from './keys.ts';
export type { NetworkName, WatchWallet, Wallet } from './keys.ts';
export { buildPayment, payout } from './payment.ts';
export type { Payment, PaymentOptions } from './payment.ts';
export { bitcoinCore, esplora } from './chain.ts';
export type { BitcoinCoreOptions, ChainClient, ChainUtxo } from './chain.ts';
