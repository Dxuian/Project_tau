// The payout service's OTLP telemetry (server/otel.js): the log line and the
// gauges it builds, and that sendTelemetry posts them to PostHog's OTLP endpoints
// with the project key, carrying only booleans and public settings.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { logsBody, metricsBody, sendTelemetry } from '../otel.js';

const now = () => 1_700_000_000_000; // fixed ms, so timeUnixNano is 1_700_000_000_000_000_000
const checks = { app: 'project-tau', target: 'cloudflare', network: 'mainnet', ok: true, can_pay: true, sweep_ok: true, purge_ok: null, site_ok: false };

/** A stand-in OTLP receiver: records every request (method, path, auth, parsed body), answers `status`. */
async function startFakeOtlp(status = 200) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const { pathname } = new URL(req.url, 'http://localhost');
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      /* leave null */
    }
    requests.push({ method: req.method, path: pathname, auth: req.headers.authorization, type: req.headers['content-type'], body });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

test('logsBody: one record, severity from ok, booleans as attributes, no nulls', () => {
  const record = logsBody(checks, { now }).resourceLogs[0].scopeLogs[0].logRecords[0];
  assert.equal(record.severityText, 'INFO');
  assert.equal(record.body.stringValue, 'payout service healthy');
  assert.equal(record.timeUnixNano, '1700000000000000000');
  const attrs = Object.fromEntries(record.attributes.map((a) => [a.key, a.value]));
  assert.deepEqual(attrs.can_pay, { boolValue: true });
  assert.deepEqual(attrs.site_ok, { boolValue: false });
  assert.deepEqual(attrs.target, { stringValue: 'cloudflare' });
  assert.ok(!('purge_ok' in attrs), 'null checks are left out');

  const degraded = logsBody({ ...checks, ok: false }, { now }).resourceLogs[0].scopeLogs[0].logRecords[0];
  assert.equal(degraded.severityText, 'ERROR');
  assert.equal(degraded.severityNumber, 17);
});

test('metricsBody: one 0/1 gauge per boolean, nulls and strings skipped', () => {
  const metrics = metricsBody(checks, { now }).resourceMetrics[0].scopeMetrics[0].metrics;
  const byName = Object.fromEntries(metrics.map((m) => [m.name, m]));
  assert.deepEqual(Object.keys(byName).sort(), ['payout.can_pay', 'payout.ok', 'payout.site_ok', 'payout.sweep_ok']);
  assert.equal(byName['payout.ok'].gauge.dataPoints[0].asInt, '1');
  assert.equal(byName['payout.site_ok'].gauge.dataPoints[0].asInt, '0');
  assert.equal(byName['payout.ok'].gauge.dataPoints[0].timeUnixNano, '1700000000000000000');
});

test('sendTelemetry: posts both signals to PostHog with the project key', async (t) => {
  const otlp = await startFakeOtlp();
  t.after(() => otlp.close());
  const config = { posthog: { key: 'phc_test', host: otlp.url } };
  const result = await sendTelemetry(config, checks, { now });
  assert.deepEqual({ sent: result.sent, logs: result.logs, metrics: result.metrics }, { sent: true, logs: true, metrics: true });

  const paths = otlp.requests.map((r) => r.path).sort();
  assert.deepEqual(paths, ['/i/v1/logs', '/i/v1/metrics']);
  for (const r of otlp.requests) {
    assert.equal(r.method, 'POST');
    assert.equal(r.auth, 'Bearer phc_test');
    assert.equal(r.type, 'application/json');
  }
  // Service name on both; the resource and records carry only the expected keys, never a secret or address.
  const bodies = JSON.stringify(otlp.requests.map((r) => r.body));
  assert.match(bodies, /project-tau-payouts/);
  assert.ok(!bodies.includes('$process_person_profile'), 'the capture-only field is not forwarded');
  assert.ok(!bodies.includes('phc_test'), 'the key is a header, never in the body');
});

test('sendTelemetry: no PostHog key means nothing is sent', async () => {
  const result = await sendTelemetry({ posthog: { key: '', host: 'https://us.i.posthog.com' } }, checks, { now });
  assert.equal(result.sent, false);
  assert.match(result.reason, /TAU_POSTHOG_KEY/);
});

test('sendTelemetry: a phx_ personal key is refused, like the health event', async () => {
  const result = await sendTelemetry({ posthog: { key: 'phx_personal', host: 'https://us.i.posthog.com' } }, checks, { now });
  assert.equal(result.sent, false);
  assert.match(result.reason, /project key/);
});

test('sendTelemetry: one signal failing does not fail the other', async (t) => {
  const otlp = await startFakeOtlp(500); // PostHog rejects both
  t.after(() => otlp.close());
  const result = await sendTelemetry({ posthog: { key: 'phc_test', host: otlp.url } }, checks, { now });
  assert.deepEqual({ sent: result.sent, logs: result.logs, metrics: result.metrics }, { sent: false, logs: false, metrics: false });
});
