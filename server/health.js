// The payout service's health event, for PostHog's alerts. The Worker's cron
// sends one on every run (every 15 minutes), and PostHog's "payout service
// unhealthy or silent" alert fires when one reports a problem, or when they stop
// arriving (the Worker, its settings or its cron is broken). Web-standard: only
// fetch.
//
// The event holds booleans and the deployment's public settings only: never a
// secret, an address or anything about a visitor.
export const HEALTH_EVENT = 'payout_health';
/** Tells this project's events apart from other apps' in PostHog; the site sends the same `app`. */
export const APP = 'project-tau';

/** config.posthog as { key, host }, or { reason } when there's nothing to send to. */
export function healthTarget(config) {
  const { key, host } = config.posthog ?? {};
  if (!key) return { reason: 'TAU_POSTHOG_KEY is not set' };
  // A project key only (write-only, public by design), never a personal phx_ key.
  if (!/^phc_[A-Za-z0-9]+$/.test(key)) return { reason: 'TAU_POSTHOG_KEY is not a PostHog project key (phc_...)' };
  if (!/^https?:\/\/[^/]/.test(host ?? '')) return { reason: 'TAU_POSTHOG_HOST is not an http(s) URL' };
  return { key, host };
}

/** Whether the site answers and reaches this service: its GET /api/address gives an address. */
export async function siteReachable(siteUrl, { fetch = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  try {
    const res = await fetch(new URL('/api/address', siteUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = await res.json();
    return typeof body?.address === 'string';
  } catch {
    return false;
  }
}

/**
 * Sends one health event to PostHog.
 * @param config  from loadConfig(): posthog { key, host }, siteUrl, target, network
 * @param checks  { canPay, sweepOk, purgeOk }: what this run saw; null for a job that didn't run
 * @returns { sent: false, reason } when there's no PostHog to send to, else
 *          { sent: res.ok, status, properties }. Rejects when PostHog can't be reached.
 */
export async function sendHealth(config, { canPay, sweepOk = null, purgeOk = null }, { fetch = globalThis.fetch, now = Date.now } = {}) {
  const target = healthTarget(config);
  if (!target.key) return { sent: false, reason: target.reason };
  const checks = {
    can_pay: canPay === true,
    sweep_ok: sweepOk,
    purge_ok: purgeOk,
    site_ok: config.siteUrl ? await siteReachable(config.siteUrl, { fetch }) : null,
  };
  const properties = {
    app: APP,
    target: config.target,
    network: config.network,
    ok: Object.values(checks).every((v) => v !== false),
    ...checks,
    $process_person_profile: false,
  };
  const res = await fetch(new URL('/i/v0/e/', target.host), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: target.key, event: HEALTH_EVENT, distinct_id: `${APP}-payout-service`, timestamp: new Date(now()).toISOString(), properties }),
    signal: AbortSignal.timeout(10_000),
  });
  return { sent: res.ok, status: res.status, properties };
}
