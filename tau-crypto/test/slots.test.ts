// Address slots (src/payouts/slots.ts): one fresh owner address per period.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressSlot, slotTimes } from '../src/payouts/index.ts';

const HOUR = 3_600_000;
const EPOCH = Date.UTC(2026, 0, 1);
const hourly = { periodMs: HOUR, epochMs: EPOCH };

test('slot N covers the N-th hour after the epoch, and index 0 is never a slot', () => {
  assert.equal(addressSlot(EPOCH, hourly), 1);
  assert.equal(addressSlot(EPOCH + HOUR - 1, hourly), 1);
  assert.equal(addressSlot(EPOCH + HOUR, hourly), 2);
  // 2026-10-31 13:30 UTC: 303 days and 13 whole hours (7285) after the epoch.
  const t = Date.UTC(2026, 9, 31, 13, 30);
  assert.equal(addressSlot(t, hourly), 7286);
  assert.deepEqual(slotTimes(7286, hourly), { from: Date.UTC(2026, 9, 31, 13), until: Date.UTC(2026, 9, 31, 14) });
  // 24 addresses a day.
  assert.equal(addressSlot(t + 24 * HOUR, hourly) - addressSlot(t, hourly), 24);
});

test('every time in a slot maps back to that slot', () => {
  for (const slot of [1, 2, 500, 9999]) {
    const { from, until } = slotTimes(slot, hourly);
    assert.equal(addressSlot(from, hourly), slot);
    assert.equal(addressSlot(until - 1, hourly), slot);
    assert.equal(addressSlot(until, hourly), slot + 1);
  }
});

test('refuses times before the epoch and unusable options', () => {
  assert.throws(() => addressSlot(EPOCH - 1, hourly), /before the address epoch/);
  assert.throws(() => addressSlot(Number.NaN, hourly), /before the address epoch/);
  assert.throws(() => addressSlot(EPOCH, { periodMs: 10, epochMs: EPOCH }), /at least 1000/);
  assert.throws(() => addressSlot(EPOCH, { periodMs: HOUR, epochMs: -1 }), /epochMs/);
  assert.throws(() => slotTimes(0, hourly), /slot must be/);
  assert.throws(() => addressSlot(EPOCH + 2 ** 31 * 1000, { periodMs: 1000, epochMs: EPOCH }), /no address slots left/);
});
