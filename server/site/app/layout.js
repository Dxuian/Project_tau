import { analyticsConfig } from '../lib/config.js';
import Analytics from './analytics.js';
import './globals.css';

// Rendered at request time, so a deployment's settings (POSTHOG_KEY) reach the page.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Project Tau: mine Bitcoin in your browser',
  description: 'Mine Bitcoin in your browser. If you find a block, you get 10% of it.',
};

export const viewport = {
  themeColor: '#0e0e16',
  colorScheme: 'dark light',
};

// Dark by default; the theme toggle (components/theme-toggle.js) switches to light and remembers it.
export default function RootLayout({ children }) {
  const analytics = analyticsConfig();
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        {analytics && <Analytics config={analytics} />}
        {children}
      </body>
    </html>
  );
}
