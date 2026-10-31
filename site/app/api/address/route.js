// GET /api/address: this hour's mining address of ours, cacheable until the hour ends.
import { miningAddress } from '../../../lib/payout-api.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const mining = await miningAddress();
    const seconds = mining.until ? Math.max(0, Math.floor((Date.parse(mining.until) - Date.now()) / 1000)) : 300;
    return Response.json(mining, { headers: { 'cache-control': `public, max-age=${seconds}` } });
  } catch {
    return Response.json({ error: 'the payout service is unreachable' }, { status: 502 });
  }
}
