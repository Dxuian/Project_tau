// Time slots for fresh owner addresses: slot N is receive index N of the owner
// wallet and covers the N-th period after an epoch (index 0, the owner's first
// address, is never a slot). Slots are sequential, so any period's address can
// be derived again from its time alone.
import { MAX_INDEX } from '../wallet/keys.ts';

export interface SlotOptions {
  /** Length of a slot in ms, e.g. 3_600_000 for a new address every hour. */
  periodMs: number;
  /** When slot 1 starts, in ms since 1970. */
  epochMs: number;
}

function check({ periodMs, epochMs }: SlotOptions): void {
  if (!Number.isSafeInteger(periodMs) || periodMs < 1000) throw new Error('periodMs must be a whole number of ms, at least 1000');
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) throw new Error('epochMs must be a time in ms since 1970');
}

/** The slot `time` (ms) falls in: 1 + whole periods since the epoch. */
export function addressSlot(time: number, options: SlotOptions): number {
  check(options);
  if (!Number.isFinite(time) || time < options.epochMs) throw new Error('time is before the address epoch');
  const slot = 1 + Math.floor((time - options.epochMs) / options.periodMs);
  if (slot > MAX_INDEX) throw new Error('no address slots left after this epoch');
  return slot;
}

/** When `slot` starts and ends (ms; `until` is the next slot's start). */
export function slotTimes(slot: number, options: SlotOptions): { from: number; until: number } {
  check(options);
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > MAX_INDEX) throw new Error(`slot must be a whole number from 1 to ${MAX_INDEX}`);
  const from = options.epochMs + (slot - 1) * options.periodMs;
  return { from, until: from + options.periodMs };
}
