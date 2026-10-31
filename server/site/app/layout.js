import Link from 'next/link';
import { analyticsConfig } from '../lib/config.js';
import Analytics from './analytics.js';
import './globals.css';

// Rendered at request time, so a deployment's settings (POSTHOG_KEY) reach every page.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Project Tau: mine Bitcoin in your browser',
  description: 'Mine Bitcoin in your browser. If you find a block, you get a share of it.',
};

export default function RootLayout({ children }) {
  const analytics = analyticsConfig();
  return (
    <html lang="en">
      <body>
        {analytics && <Analytics config={analytics} />}
        <header className="top">
          <Link href="/" className="brand">
            Project Tau
          </Link>
          <nav>
            <Link href="/wallet">Wallet</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="foot">
          Nothing mines until you press Start. Mining uses your device&apos;s CPU and power.
          {analytics && ' We count visits and button presses with PostHog, never your words or your address.'}
        </footer>
      </body>
    </html>
  );
}
