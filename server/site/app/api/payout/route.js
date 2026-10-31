// POST /api/payout {"address"}: forwards to the payout service, which verifies
// that address's blocks and pays its share of each mature one, once.
import { isValidAddress } from 'tau-crypto/wallet.js';
import { siteConfig } from '../../../lib/config.js';
import { requestPayout } from '../../../lib/payout-api.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return Response.json({ error: 'body too large' }, { status: 413 });
  let address;
  try {
    address = (await request.json())?.address;
  } catch {
    return Response.json({ error: 'expected a JSON body {"address": "..."}' }, { status: 400 });
  }
  if (!isValidAddress(address, siteConfig().network)) return Response.json({ error: 'not an address on this network' }, { status: 400 });
  try {
    const { status, body } = await requestPayout(address);
    return new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch {
    return Response.json({ error: 'the payout service is unreachable' }, { status: 502 });
  }
}
