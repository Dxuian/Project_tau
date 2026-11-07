// Reverse proxy for PostHog. The browser sends its events to this same-origin path
// (lib/analytics.js sets api_host to /ingest), and this forwards them to PostHog:
// events to the ingestion host (POSTHOG_HOST), and the scripts PostHog loads (the
// session-replay recorder and remote config, under /static/* and /array/*) to its
// assets host. Ad blockers block PostHog's own domains and silently drop 10-25% of
// events and those scripts; a first-party path they don't block. It only passes along
// what the browser already sends (lib/analytics.js masks the words and addresses out of
// replay and strips addresses from events), and adds nothing identifying: the visitor's
// IP is not forwarded, so PostHog sees this server, not them. Both destinations are
// fixed, so this is not an open proxy.
import { posthogAssetsHost, posthogHost } from '../../../lib/config.js';

export const dynamic = 'force-dynamic';

const PREFIX = '/ingest';
// PostHog serves its scripts (the recorder, remote config) from the assets host under
// these prefixes; everything else is event ingestion.
const ASSET_PREFIXES = ['/ingest/static/', '/ingest/array/'];

async function proxy(request) {
  const url = new URL(request.url);
  // Scripts go to the assets host, events to the ingestion host. Both hosts are fixed:
  // the browser can't change where this goes.
  const forAssets = ASSET_PREFIXES.some((p) => url.pathname.startsWith(p));
  const host = forAssets ? posthogAssetsHost() : posthogHost();
  if (!host) return new Response('{"status":0}', { status: 404, headers: { 'content-type': 'application/json' } });
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
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      // The versioned scripts may be cached; events never are.
      'cache-control': forAssets ? (res.headers.get('cache-control') ?? 'public, max-age=86400') : 'no-store',
    },
  });
}

export const GET = proxy;
export const POST = proxy;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
