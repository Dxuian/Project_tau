// Product analytics in the browser (PostHog), limited to what this site chooses
// to send: page views, uncaught errors, and the named events passed to track().
// Nothing reads the page: no autocapture, session replay, heatmaps, surveys or
// web vitals, and no remote config or scripts from PostHog, because the wallet
// page shows the visitor's 12 words. Bitcoin addresses are cut out of everything
// sent (the mine page's URL holds the visitor's), and every event carries `app`
// (lib/config.js).
import posthog from 'posthog-js';

// bech32 (bc1, tb1, bcrt1, either case) and base58 (1, 2, 3, m, n) addresses.
const BECH32 = /\b(?:bc|tb|bcrt)1[02-9ac-hj-np-z]{6,87}\b/gi;
const BASE58 = /\b[1-3mn][1-9A-HJ-NP-Za-km-z]{25,34}\b/g;

const plain = (value) => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** `value` with every Bitcoin address in its strings (nested too) replaced by [address]. */
export function scrubAddresses(value) {
  if (typeof value === 'string') return value.replace(BECH32, '[address]').replace(BASE58, '[address]');
  if (Array.isArray(value)) return value.map(scrubAddresses);
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubAddresses(v)]));
  return value;
}

/** What PostHog's before_send does to every event: addresses out, `app` and the network in. */
export function prepareEvent(event, { app, network }) {
  if (!event) return event;
  return {
    ...event,
    properties: { ...scrubAddresses(event.properties ?? {}), app, network },
    ...(event.$set ? { $set: scrubAddresses(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: scrubAddresses(event.$set_once) } : {}),
  };
}

let started = false;

/** Starts PostHog once, with `config` from analyticsConfig() (null: analytics stays off). */
export function startAnalytics(config) {
  if (started || !config || typeof window === 'undefined') return;
  started = true;
  posthog.init(config.key, {
    api_host: config.host,
    // Page views, also on client-side navigation; everything else comes from track().
    capture_pageview: 'history_change',
    autocapture: false,
    mask_all_text: true,
    mask_all_element_attributes: true,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    disable_product_tours: true,
    disable_conversations: true,
    // No remote config (it could switch features on) and no scripts loaded from PostHog.
    advanced_disable_flags: true,
    advanced_disable_toolbar_metrics: true,
    disable_external_dependency_loading: true,
    // Anonymous visitors: no person profiles, no cookies, nothing when the browser asks not to be tracked.
    person_profiles: 'identified_only',
    persistence: 'localStorage',
    respect_dnt: true,
    before_send: (event) => prepareEvent(event, config),
  });
  // Uncaught errors (React reports render errors the same way), for PostHog's error
  // tracking: the core captureException, since its own autocapture would load a script.
  // Stack traces resolve through the public source maps (next.config.mjs).
  window.addEventListener('error', (e) => {
    if (e.error || e.message !== 'Script error.') posthog.captureException(e.error ?? new Error(e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    posthog.captureException(e.reason instanceof Error ? e.reason : new Error(String(e.reason)));
  });
}

/** Sends a named event; does nothing while analytics is off. Never pass words or addresses. */
export function track(event, properties) {
  if (started) posthog.capture(event, properties);
}
