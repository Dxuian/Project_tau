// Reverse proxy for PostHog. The browser sends its events to this same-origin path
// (lib/analytics.js sets api_host to /ingest), and this forwards them to PostHog
// (POSTHOG_HOST). Ad blockers block PostHog's own domain and silently drop 10-25% of
// events; a first-party path they don't block. It only passes along what the browser
// already sends (lib/analytics.js strips addresses and disables everything that reads
// the page), and adds nothing identifying: the visitor's IP is not forwarded, so
// PostHog sees this server, not them. The destination is fixed (POSTHOG_HOST), so this
// is not an open proxy.
import { posthogHost } from '../../../lib/config.js';

export const dynamic = 'force-dynamic';

const PREFIX = '/ingest';

async function proxy(request) {
  const host = posthogHost();
  if (!host) return new Response('{"status":0}', { status: 404, headers: { 'content-type': 'application/json' } });
  const url = new URL(request.url);
  // The path and query after /ingest, appended to the fixed host: the browser can't change where this goes.
  const target = `${host}${url.pathname.slice(PREFIX.length) || '/'}${url.search}`;
  const headers = new Headers();
  const type = request.headers.get('content-type');
  if (type) headers.set('content-type', type); // PostHog reads compression from the query, not a header
  const method = request.method;
  const res = await fetch(target, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
  });
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET = proxy;
export const POST = proxy;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
