import { analyticsConfig } from '../lib/config.js';
import { COLORS, DESCRIPTION, KEYWORDS, NAME, SITE_URL, STRUCTURED_DATA, TITLE } from '../lib/site.js';
import { DEFAULT_THEME, THEME_SCRIPT } from '../lib/themes.js';
import Analytics from './analytics.js';
import './fonts.js';
import './globals.css';
import './themes.css';

// Rendered at request time, so a deployment's settings (POSTHOG_KEY) reach the page.
export const dynamic = 'force-dynamic';

// For search engines and link previews (lib/site.js). The icons (icon.svg, apple-icon.png,
// favicon.ico) and the share image (opengraph-image.png, twitter-image.png) are files in
// this folder, which Next.js links itself; scripts/brand-images.mjs makes them.
export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${NAME}` },
  description: DESCRIPTION,
  keywords: KEYWORDS,
  applicationName: NAME,
  authors: [{ name: NAME, url: SITE_URL }],
  creator: NAME,
  publisher: NAME,
  category: 'finance',
  // One address for the page, whichever host served it (workers.dev, www).
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
  openGraph: { type: 'website', url: '/', siteName: NAME, title: TITLE, description: DESCRIPTION, locale: 'en_US' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  appleWebApp: { capable: true, title: NAME, statusBarStyle: 'black-translucent' },
  // Addresses and numbers on the page are not phone numbers or places to link.
  formatDetection: { telephone: false, address: false, email: false },
  referrer: 'strict-origin-when-cross-origin',
  other: { 'msapplication-TileColor': COLORS.background },
};

export const viewport = {
  themeColor: COLORS.background,
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
        {/* What the page is, for search engines (constant: lib/site.js). */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: STRUCTURED_DATA }} />
      </head>
      <body>
        {analytics && <Analytics config={analytics} />}
        {/* Without JavaScript nothing can mine; say what the page is. */}
        <noscript>
          <div className="mx-auto max-w-xl space-y-2 p-6 text-sm leading-relaxed">
            <p>
              <b>{NAME}</b> mines Bitcoin in your browser, and it needs JavaScript to run. Turn JavaScript on and reload the page.
            </p>
            <p>
              It explains how Bitcoin mining works, creates a wallet on your device (its 12 words never leave it) and mines with one button: press Mine BTC to start, and
              again to stop.
            </p>
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
