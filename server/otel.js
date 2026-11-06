// The payout service's telemetry for PostHog's Logs and Metrics products, over
// OTLP/HTTP (JSON, built by hand so the Worker needs no OpenTelemetry SDK). The
// cron sends these alongside the health event (health.js): one log line and a few
// 0/1 gauges per run, from the same checks. Like the health event, they carry
// booleans and the deployment's public settings only — never a secret, an address
// or an amount. Best-effort: a failure here never touches payouts or the health
// event, which stays the alert of record. Web-standard: only fetch.
//
// PostHog's OTLP endpoints: {host}/i/v1/logs and {host}/i/v1/metrics, authorized
// with the project key (phc_, the same one the health event uses; never a personal
// phx_ key). Metrics is in alpha and PostHog may change its endpoint.
import { APP, healthTarget } from './health.js';

/** service.name for both signals: the payout service, told apart from the site. */
const SERVICE = `${APP}-payouts`;
const SEVERITY = { info: 9, error: 17 };

/** A flat object as OTLP key/value attributes; null and undefined are left out. */
function attributes(props) {
  const out = [];
  for (const [key, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'boolean') out.push({ key, value: { boolValue: v } });
    else if (typeof v === 'number') out.push({ key, value: Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v } });
    else out.push({ key, value: { stringValue: String(v) } });
  }
  return out;
}

const resource = { attributes: attributes({ 'service.name': SERVICE }) };
const scope = { name: 'payout-service' };
const nanos = (now) => String(BigInt(now()) * 1_000_000n); // ms -> ns

/** The OTLP/JSON body for one log line describing this run. */
export function logsBody(checks, { now = Date.now } = {}) {
  const healthy = checks.ok !== false;
  return {
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope,
            logRecords: [
              {
                timeUnixNano: nanos(now),
                severityNumber: healthy ? SEVERITY.info : SEVERITY.error,
                severityText: healthy ? 'INFO' : 'ERROR',
                body: { stringValue: healthy ? 'payout service healthy' : 'payout service degraded' },
                attributes: attributes(checks),
              },
            ],
          },
        ],
      },
    ],
  };
}

/** The OTLP/JSON body for the run's booleans as 0/1 gauges. */
export function metricsBody(checks, { now = Date.now } = {}) {
  const time = nanos(now);
  const metrics = Object.entries(checks)
    .filter(([, v]) => typeof v === 'boolean')
    .map(([key, v]) => ({ name: `payout.${key}`, unit: '1', gauge: { dataPoints: [{ timeUnixNano: time, asInt: v ? '1' : '0' }] } }));
  return { resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics }] }] };
}

/** The booleans and public settings we send, taken from the health event's properties. */
function telemetryChecks(properties) {
  const keep = ['app', 'target', 'network', 'ok', 'can_pay', 'sweep_ok', 'purge_ok', 'site_ok'];
  return Object.fromEntries(keep.filter((k) => k in properties).map((k) => [k, properties[k]]));
}

/**
 * Sends one OTLP log line and the gauges to PostHog, from the health event's
 * `properties` (health.js). Both are best-effort and independent.
 * @returns { sent:false, reason } when there's no PostHog to send to, else
 *          { sent, logs, metrics, summary }: whether each was accepted.
 */
export async function sendTelemetry(config, properties, { fetch = globalThis.fetch, now = Date.now } = {}) {
  const target = healthTarget(config);
  if (!target.key) return { sent: false, reason: target.reason };
  const checks = telemetryChecks(properties);
  const post = (path, body) =>
    fetch(new URL(path, target.host), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    }).then(
      (res) => res.ok,
      () => false,
    );
  const [logs, metrics] = await Promise.all([post('/i/v1/logs', logsBody(checks, { now })), post('/i/v1/metrics', metricsBody(checks, { now }))]);
  return { sent: logs || metrics, logs, metrics, summary: `logs ${logs ? 'ok' : 'no'}, metrics ${metrics ? 'ok' : 'no'}` };
}
