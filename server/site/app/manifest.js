// /manifest.webmanifest: the site's name and icons when it's added to a home screen.
import { COLORS, DESCRIPTION, NAME } from '../lib/site.js';

export default function manifest() {
  return {
    name: NAME,
    short_name: NAME,
    description: DESCRIPTION,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: COLORS.background,
    theme_color: COLORS.background,
    categories: ['finance', 'education', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
