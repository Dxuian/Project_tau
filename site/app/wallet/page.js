import { siteConfig } from '../../lib/config.js';
import WalletSetup from './wallet-setup.js';

export const dynamic = 'force-dynamic';

export default function WalletPage() {
  const { network } = siteConfig();
  return (
    <>
      <h1>Your payout address</h1>
      <p className="muted">If you find a block, your share is sent here. Pick one way in.</p>
      <WalletSetup network={network} />
    </>
  );
}
