// tau-crypto/payouts: recording the shares visitors mine through the bridge
// (the share auditor), proving that one is a block in the best chain, and
// paying the visitor who found it a share of the reward, once. Storage and
// policy are the caller's.
export { coinbaseOutputs, nbitsTarget, paidTo, rebuildBlockHeader, verifyBlock } from './block.ts';
export type { BlockCheck, JobFields, RebuiltBlock, ShareFields } from './block.ts';
export { createShareAuditor } from './auditor.ts';
export type { PoolLogin, ShareAuditorOptions } from './auditor.ts';
export { checkSharePercent, payoutAll, verifyPayout } from './engine.ts';
export type { PayoutOptions, PayoutResult, PayoutStatus } from './engine.ts';
export { createPayoutService } from './service.ts';
export type { MiningAddress, PayoutService, PayoutServiceOptions } from './service.ts';
export { addressSlot, slotTimes } from './slots.ts';
export type { SlotOptions } from './slots.ts';
export { memoryStores } from './stores.ts';
export type { PayoutEntry, PayoutLedger, ReserveResult, ShareRecord, ShareResult, ShareStore } from './stores.ts';
