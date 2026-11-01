// The payout service's health event (health.js): what PostHog's "payout service
// unhealthy or silent" alert counts. One event per cron run, booleans only, ok
// only when every check passes, and nothing sent without a project key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { APP, HEALTH_EVENT, healthTarget, sendHealth } from '../health.js';
import { startFakePostHog } from './helpers.js';

/** A stand-in site whose GET /api/address answers `status` (with an address when 200). */
async function fakeSite(t, status = 200) {
  const server = createServer((req, res) => {
    const ok = status === 200 && req.url === '/api/address';
    res.writeHead(ok ? 200 : status === 200 ? 404 : status, { 'content-type': 'application/json' });
    res.end(ok ? JSON.stringify({ address: 'bc1qsiteanswerfortest', index: 7 }) : '{"error":"the payout service is unreachable"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const configFor = (ph, siteUrl) => ({ target: 'cloudflare', network: 'mainnet', posthog: { key: 'phc_tautest', host: ph.url }, siteUrl });
const allGood = { canPay: true, sweepOk: true, purgeOk: true };

test('one event per run: booleans and public settings only, ok when every check passes', async (t) => {
  const ph = await startFakePostHog();
  t.after(() => ph.close());
  const site = await fakeSite(t);
  const r = await sendHealth(configFor(ph, site), allGood, { now: () => Date.parse('2026-11-01T14:15:00Z') });
  assert.equal(r.sent, true);
  assert.deepEqual(ph.requests.map((q) => `${q.method} ${q.path}`), ['POST /i/v0/e/']);
  const [event] = ph.events();
  assert.deepEqual(
    { event: event.event, key: event.api_key, id: event.distinct_id, at: event.timestamp },
    { event: HEALTH_EVENT, key: 'phc_tautest', id: `${APP}-payout-service`, at: '2026-11-01T14:15:00.000Z' },
  );
  assert.deepEqual(event.properties, {
    app: 'project-tau',
    target: 'cloudflare',
    network: 'mainnet',
    ok: true,
    can_pay: true,
    sweep_ok: true,
    purge_ok: true,
    site_ok: true,
    $process_person_profile: false,
  });
  assert.ok(!ph.requests[0].text.includes('bc1q'), "nothing from the site's answer");
});

test('a failed job, the site down or unreachable, or no words: ok is false; a job that did not run is no failure', async (t) => {
  const ph = await startFakePostHog();
  t.after(() => ph.close());
  const up = await fakeSite(t);
  const down = await fakeSite(t, 502);
  const props = async (siteUrl, checks) => (await sendHealth(configFor(ph, siteUrl), checks)).properties;

  const noPurge = await props(up, { ...allGood, purgeOk: null });
  assert.deepEqual([noPurge.ok, noPurge.purge_ok], [true, null], 'no share retention set: no purge');
  const siteDown = await props(down, allGood);
  assert.deepEqual([siteDown.ok, siteDown.site_ok], [false, false], 'the site answers 502');
  const siteGone = await props('http://127.0.0.1:1', allGood);
  assert.deepEqual([siteGone.ok, siteGone.site_ok], [false, false], 'nothing listens there');
  const sweepFailed = await props(up, { ...allGood, sweepOk: false });
  assert.deepEqual([sweepFailed.ok, sweepFailed.sweep_ok], [false, false]);
  const purgeFailed = await props(up, { ...allGood, purgeOk: false });
  assert.deepEqual([purgeFailed.ok, purgeFailed.purge_ok], [false, false]);
  const noWords = await props(up, { ...allGood, canPay: false });
  assert.deepEqual([noWords.ok, noWords.can_pay], [false, false], 'without OWNER_MNEMONIC it cannot pay');
  const noSite = await props(undefined, allGood);
  assert.deepEqual([noSite.ok, noSite.site_ok], [true, null], 'no TAU_SITE_URL: no site check');
  assert.equal(ph.events().length, 7);
});

test('no project key, no event: a personal key or a bad host is refused, never sent', async (t) => {
  const ph = await startFakePostHog();
  t.after(() => ph.close());
  const base = { target: 'cloudflare', network: 'mainnet' };
  assert.deepEqual(await sendHealth({ ...base, posthog: { host: ph.url } }, allGood), { sent: false, reason: 'TAU_POSTHOG_KEY is not set' });
  const personal = await sendHealth({ ...base, posthog: { key: 'phx_personalkeyneversent', host: ph.url } }, allGood);
  assert.match(personal.reason, /not a PostHog project key/);
  const badHost = await sendHealth({ ...base, posthog: { key: 'phc_tautest', host: 'ftp://posthog.example' } }, allGood);
  assert.match(badHost.reason, /TAU_POSTHOG_HOST/);
  assert.equal(ph.requests.length, 0);
  assert.deepEqual(healthTarget({ posthog: { key: 'phc_tautest', host: 'https://us.i.posthog.com' } }), { key: 'phc_tautest', host: 'https://us.i.posthog.com' });
});

test("PostHog unreachable: sendHealth rejects, and the cron logs it", async () => {
  await assert.rejects(sendHealth({ target: 'node', network: 'mainnet', posthog: { key: 'phc_tautest', host: 'http://127.0.0.1:1' } }, allGood));
});
