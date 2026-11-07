// Product analytics in the browser (PostHog), limited to what this site chooses
// to send: page views, uncaught errors, the named events passed to track(), and
// masked session replay. The page shows a new wallet's 12 words, so replay never
// records them: the words' element is dropped entirely (ph-no-capture), and all
// .notranslate text (words, addresses, the backup box) and every input value are
// masked before anything is serialized (initOptions). Autocapture, heatmaps and
// surveys stay off; web vitals (CLS/FCP/LCP/INP — performance numbers, never page
// content) are on. Bitcoin addresses are also cut out of every (non-replay) event,
// and every event carries `app` (lib/config.js).
// Events and the recorder go to a same-origin path (api_host '/ingest'), which the
// site proxies to PostHog (app/ingest), so ad blockers that block PostHog's domains
// don't drop them. posthog-js loads in its own chunk once analytics starts (after the
// page has shown), so it doesn't hold up the first paint; calls made while it loads
// wait for it.

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
  // Replay snapshots are already masked (initOptions): their DOM carries no words or
  // addresses, so they're only tagged, not walked — the address scrub would run over a
  // large payload every couple of seconds, on the CPU the miner shares.
  if (event.event === '$snapshot') return { ...event, properties: { ...(event.properties ?? {}), app, network } };
  return {
    ...event,
    properties: { ...scrubAddresses(event.properties ?? {}), app, network },
    ...(event.$set ? { $set: scrubAddresses(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: scrubAddresses(event.$set_once) } : {}),
  };
}

let started = false;
let posthog = null; // the library, once loaded and started
const waiting = []; // calls made while it loads

/** Runs `fn(posthog)` now, or once PostHog has loaded; nothing while analytics is off. */
function withPostHog(fn) {
  if (posthog) fn(posthog);
  else if (started) waiting.push(fn);
}

/** Starts PostHog once, with `config` from analyticsConfig() (null: analytics stays off). */
export function startAnalytics(config) {
  if (started || !config || typeof window === 'undefined') return;
  started = true;
  // Uncaught errors (React reports render errors the same way), for PostHog's error
  // tracking: the core captureException, since its own autocapture would load a script.
  // Stack traces resolve through the public source maps (next.config.mjs).
  window.addEventListener('error', (e) => {
    if (e.error || e.message !== 'Script error.') withPostHog((ph) => ph.captureException(e.error ?? new Error(e.message)));
  });
  window.addEventListener('unhandledrejection', (e) => {
    withPostHog((ph) => ph.captureException(e.reason instanceof Error ? e.reason : new Error(String(e.reason))));
  });
  import('posthog-js').then(
    ({ default: ph }) => {
      init(ph, config);
      posthog = ph;
      for (const fn of waiting.splice(0)) fn(ph);
    },
    () => {
      // The chunk didn't load (offline, blocked): analytics stays off.
      started = false;
      waiting.length = 0;
    },
  );
}

/** The posthog.init options (pure, so it can be checked in a test): masked replay on, nothing that reads the page unmasked. */
export function initOptions(config) {
  return {
    // Same-origin (app/ingest proxies to PostHog), so ad blockers don't drop events;
    // ui_host keeps "view in PostHog" links pointing at the real host.
    api_host: config.apiHost,
    ui_host: config.uiHost,
    // Page views, also on client-side navigation; everything else comes from track().
    capture_pageview: 'history_change',
    autocapture: false,
    mask_all_text: true,
    mask_all_element_attributes: true,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    // Web vitals only (CLS/FCP/LCP/INP): performance numbers and element selectors, never
    // page text or input values. Network timing stays off (it would capture request URLs).
    capture_performance: { web_vitals: true, network_timing: false },
    // Session replay, masked. The words (a fresh phrase) are dropped from the recording
    // entirely by ph-no-capture on their element; on top of that, every input value and
    // all .notranslate text (the words, every address, the backup box) are masked before
    // anything is serialized. Recording is still gated by PostHog's "Record user sessions"
    // project setting: off there, nothing records.
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '.notranslate',
    },
    disable_surveys: true,
    disable_web_experiments: true,
    disable_product_tours: true,
    disable_conversations: true,
    // Remote config (/flags) is read so PostHog can turn session replay on. It can't turn
    // anything else on: the options above are the ceiling (a feature off here stays off),
    // and the only script loaded from PostHog is the replay recorder, first-party via /ingest.
    advanced_disable_toolbar_metrics: true,
    disable_external_dependency_loading: false,
    // Anonymous visitors: no person profiles, no cookies, nothing when the browser asks not to be tracked.
    person_profiles: 'identified_only',
    persistence: 'localStorage',
    respect_dnt: true,
    before_send: (event) => prepareEvent(event, config),
  };
}

function init(posthog, config) {
  posthog.init(config.key, initOptions(config));
}

/** Sends a named event (once PostHog has loaded); does nothing while analytics is off. Never pass words or addresses. */
export function track(event, properties) {
  withPostHog((ph) => ph.capture(event, properties));
}
