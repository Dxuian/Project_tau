// The site's browser analytics (site/lib/analytics.js) and the PostHog hosts
// (site/lib/config.js): masked session replay is on, but nothing that reads the
// page unmasked is, addresses are cut out of events, and the replay recorder is
// loaded first-party. These lock the privacy posture so it can't quietly regress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initOptions, prepareEvent, scrubAddresses } from '../site/lib/analytics.js';
import { posthogAssetsHost } from '../site/lib/config.js';

const config = { key: 'phc_x', apiHost: '/ingest', uiHost: 'https://us.i.posthog.com', app: 'project-tau', network: 'mainnet' };

test('initOptions: masked session replay on, nothing else that reads the page', () => {
  const o = initOptions(config);
  // Replay is on, but masked: every input value and all .notranslate text (the words,
  // addresses, the backup box) are masked before serialization.
  assert.equal(o.disable_session_recording, false);
  assert.equal(o.session_recording.maskAllInputs, true);
  assert.equal(o.session_recording.maskTextSelector, '.notranslate');
  // The recorder script loads (first-party, through /ingest/static), and remote config is read.
  assert.equal(o.disable_external_dependency_loading, false);
  assert.ok(!('advanced_disable_flags' in o), 'the /flags request is allowed, so PostHog can turn replay on');
  // The ceiling: everything that reads the page unmasked stays off; remote config can only
  // turn replay on, not raise any of these.
  assert.equal(o.autocapture, false);
  assert.equal(o.capture_heatmaps, false);
  assert.equal(o.capture_exceptions, false);
  assert.equal(o.capture_dead_clicks, false);
  assert.equal(o.rageclick, false);
  assert.equal(o.disable_surveys, true);
  // Web vitals are the one performance signal that's on (numbers only); network timing stays off.
  assert.deepEqual(o.capture_performance, { web_vitals: true, network_timing: false });
  // First-party ingestion; links still point at the real host.
  assert.equal(o.api_host, '/ingest');
  assert.equal(o.ui_host, 'https://us.i.posthog.com');
  assert.equal(o.respect_dnt, true);
  assert.equal(typeof o.before_send, 'function');
});

test('prepareEvent: tags every event, cuts addresses, leaves the already-masked snapshot alone', () => {
  const addr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const normal = prepareEvent({ event: 'mining_started', properties: { note: `pays ${addr}` } }, config);
  assert.deepEqual([normal.properties.app, normal.properties.network], ['project-tau', 'mainnet']);
  assert.equal(normal.properties.note, 'pays [address]', 'addresses are cut out of ordinary events');

  // A replay snapshot is already masked by the recorder, so it's only tagged, not walked.
  const snap = prepareEvent({ event: '$snapshot', properties: { $snapshot_data: [{ type: 2 }] } }, config);
  assert.deepEqual([snap.properties.app, snap.properties.network], ['project-tau', 'mainnet']);
  assert.deepEqual(snap.properties.$snapshot_data, [{ type: 2 }], 'the snapshot payload is passed through untouched');
});

test('scrubAddresses: both address styles, anywhere in the value', () => {
  const bech = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const base58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
  assert.equal(scrubAddresses(`to ${bech} and ${base58}`), 'to [address] and [address]');
  assert.deepEqual(scrubAddresses({ a: [bech], b: { c: base58 } }), { a: ['[address]'], b: { c: '[address]' } });
});

test('posthogAssetsHost: PostHog Cloud serves the recorder from a regional assets host', () => {
  assert.equal(posthogAssetsHost({ POSTHOG_HOST: 'https://us.i.posthog.com' }), 'https://us-assets.i.posthog.com');
  assert.equal(posthogAssetsHost({ POSTHOG_HOST: 'https://eu.i.posthog.com' }), 'https://eu-assets.i.posthog.com');
  assert.equal(posthogAssetsHost({}), 'https://us-assets.i.posthog.com', 'the default host is US cloud');
  assert.equal(posthogAssetsHost({ POSTHOG_HOST: 'https://ph.example.com' }), 'https://ph.example.com', 'a custom host serves its own scripts');
  assert.equal(posthogAssetsHost({ POSTHOG_HOST: 'not a url' }), null);
});
