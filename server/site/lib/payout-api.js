// Calls to the payout service, from the site's server only (the browser talks
// to the site and to the bridge). This hour's mining address is cached until
// the hour ends: in this server instance, and in the platform's fetch cache.
import { siteConfig } from './config.js';

let current = null; // { value, until (ms) }

/** This hour's owner address visitors mine to: { address, index, from, until, network }. */
export async function miningAddress() {
  const now = Date.now();
  if (current && now < current.until) return current.value;
  const { payoutApi } = siteConfig();
  const res = await fetch(`${payoutApi}/address`, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`the payout service answered ${res.status}`);
  const value = await res.json();
  const until = value.until ? Date.parse(value.until) : now + 300_000;
  current = { value, until };
  return value;
}

/** Asks the payout service to verify and pay `address`'s blocks: { status, body }. */
export async function requestPayout(address) {
  const { payoutApi } = siteConfig();
  const res = await fetch(`${payoutApi}/payout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
    cache: 'no-store',
  });
  return { status: res.status, body: await res.text() };
}
