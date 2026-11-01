// The one screen. The server reads the deployment's settings and this hour's
// mining address (from the payout service); everything else happens in the browser.
import { siteConfig } from '../lib/config.js';
import { miningAddress } from '../lib/payout-api.js';
import { TrackOnce } from './analytics.js';
import Dashboard from './dashboard.js';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const config = siteConfig();
  let mining = null;
  try {
    mining = await miningAddress();
  } catch {
    // shown as "mining is unavailable"; the page retries
  }
  return (
    <>
      <Dashboard
        network={config.network}
        bridgeUrl={config.bridgeUrl}
        pool={config.pool}
        minerUrl={config.minerUrl}
        initialMining={mining}
      />
      {!mining && <TrackOnce event="mining_unavailable" />}
    </>
  );
}
