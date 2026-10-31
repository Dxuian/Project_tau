import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isValidAddress } from 'tau-crypto/wallet';
import { siteConfig } from '../../../lib/config.js';
import { miningAddress } from '../../../lib/payout-api.js';
import Miner from './miner.js';

export const dynamic = 'force-dynamic';

export default async function MinePage({ params }) {
  const { address } = await params;
  const config = siteConfig();
  if (!isValidAddress(address, config.network)) notFound();
  // This hour's address of ours, from the payout service (cached until the hour ends).
  let mining = null;
  let problem = '';
  try {
    mining = await miningAddress();
  } catch (err) {
    problem = err.message;
  }

  return (
    <>
      <h1>Mine</h1>
      <div className="panel">
        <p>
          Your payout address: <span className="mono">{address}</span> <Link href="/wallet">change</Link>
        </p>
        {mining ? (
          <p className="muted">
            Blocks found this hour pay our address <span className="mono" data-testid="mining-address">{mining.address}</span>
            {mining.until ? ` (until ${new Date(mining.until).toISOString().slice(11, 16)} UTC)` : ''}. We check that your miner
            found it, then send you 10%.
          </p>
        ) : (
          <p className="error">Mining is unavailable right now ({problem}). Try again in a minute.</p>
        )}
      </div>
      {mining && (
        <Miner
          address={address}
          network={config.network}
          bridgeUrl={config.bridgeUrl}
          pool={config.pool}
          minerUrl={config.minerUrl}
          slot={mining.index}
        />
      )}
    </>
  );
}
