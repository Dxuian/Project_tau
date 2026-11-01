import { analyticsConfig } from '../lib/config.js';
import { DEFAULT_THEME, THEME_SCRIPT } from '../lib/themes.js';
import Analytics from './analytics.js';
import './fonts.js';
import './globals.css';
import './themes.css';

// Rendered at request time, so a deployment's settings (POSTHOG_KEY) reach the page.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Project Tau: mine Bitcoin in your browser',
  description: 'Mine Bitcoin in your browser.',
};

export const viewport = {
  themeColor: '#24104f',
  colorScheme: 'dark light',
};

// Arcade by default; the theme picker (components/theme-picker.js) switches and remembers it.
export default function RootLayout({ children }) {
  const analytics = analyticsConfig();
  return (
    <html lang="en" data-theme={DEFAULT_THEME} className="dark" suppressHydrationWarning>
      <head>
        {/* The visitor's saved theme, before the page paints (a constant script: lib/themes.js). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {analytics && <Analytics config={analytics} />}
        {children}
      </body>
    </html>
  );
}
