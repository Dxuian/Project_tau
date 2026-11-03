// The site's icons and share image, from one pixel-art ₿ in Arcade's colors (the default
// theme). Writes app/icon.svg, app/apple-icon.png, app/favicon.ico, app/opengraph-image.png,
// app/twitter-image.png and public/icon-*.png. Run it again after changing the look, in
// Docker, from server/:
//   server/dev shell node site/scripts/brand-images.mjs
// It draws with Playwright's Chromium (playwright-core, a dependency of server/) and the
// site's own fonts; nothing is fetched. Not part of the build: the files are committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { COLORS, NAME, SHARE_ALT, TAGLINE } from '../lib/site.js';

const SITE = new URL('..', import.meta.url).pathname;
const INK = '#fff4da';
const MUTED = '#c2b2ee';

// The ₿: Press Start 2P's B (7 × 7) with Bitcoin's two strokes, a pixel above and below.
const B = ['..X.X..', 'XXXXXX.', 'XX...XX', 'XX...XX', 'XXXXXX.', 'XX...XX', 'XX...XX', 'XXXXXX.', '..X.X..'];

/** The ₿ as SVG rects, `px` per pixel, its top left at (x, y). */
const glyph = (x, y, px, fill) =>
  `<g fill="${fill}">${B.flatMap((row, r) => [...row].map((c, k) => (c === 'X' ? `<rect x="${x + k * px}" y="${y + r * px}" width="${px}" height="${px}"/>` : ''))).join('')}</g>`;

/** The icon: the ₿ in the accent's ink on the accent, `size` square, rounded unless `square`. */
function icon(size, { square = false, pad = 0.12 } = {}) {
  const px = Math.floor((size * (1 - 2 * pad)) / B.length);
  const x = Math.round((size - px * 7) / 2);
  const y = Math.round((size - px * B.length) / 2);
  const corner = square ? 0 : Math.round(size * 0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" rx="${corner}" fill="${COLORS.accent}"/>${glyph(x, y, px, COLORS.background)}</svg>`;
}

const font = (family, file) =>
  `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${readFileSync(`${SITE}node_modules/@fontsource/${file}`).toString('base64')}) format('woff2')}`;

// The share image: 1200 × 630, Arcade's backdrop, the icon and "₿itrush" with the tagline.
const share = `<!doctype html><html><head><style>
${font('Press Start 2P', 'press-start-2p/files/press-start-2p-latin-400-normal.woff2')}
${font('VT323', 'vt323/files/vt323-latin-400-normal.woff2')}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:${COLORS.background};color:${INK};display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;position:relative}
body::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 2px,transparent 2px 4px),linear-gradient(rgba(85,51,158,.35) 1px,transparent 1px) 0 0/48px 48px,linear-gradient(90deg,rgba(85,51,158,.35) 1px,transparent 1px) 0 0/48px 48px}
.tile{position:relative;flex:none;filter:drop-shadow(0 0 48px rgba(255,210,63,.55))}
.text{position:relative;display:flex;flex-direction:column;gap:30px}
h1{margin:0;font:400 92px/1 'Press Start 2P';display:flex;align-items:flex-end;gap:6px}
h1 svg{display:block}
p{margin:0;font:400 46px/1 VT323;color:${MUTED};white-space:nowrap}
.url{font:400 44px/1 VT323;color:${COLORS.accent}}
</style></head><body>
<div class="tile">${icon(260)}</div>
<div class="text">
  <h1><svg viewBox="0 0 70 90" width="${(92 * 7) / 8}" height="${(92 * 9) / 8}" style="margin-bottom:-${92 / 8}px" shape-rendering="crispEdges">${glyph(0, 0, 10, INK)}</svg><span>${NAME.slice(1)}</span></h1>
  <p>${TAGLINE}</p>
  <p class="url">bitrush.online</p>
</div></body></html>`;

/** An .ico holding these PNGs (each entry points at a whole PNG file, which every browser reads). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const png = async (html, width, height) => {
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
  };
  const svgPage = (svg) => `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`;

  writeFileSync(`${SITE}app/icon.svg`, `${icon(64)}\n`);
  writeFileSync(`${SITE}app/apple-icon.png`, await png(svgPage(icon(180, { square: true })), 180, 180));
  writeFileSync(`${SITE}app/favicon.ico`, ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(svgPage(icon(size, { pad: 0.08 })), size, size) })))));
  writeFileSync(`${SITE}public/icon-192.png`, await png(svgPage(icon(192)), 192, 192));
  writeFileSync(`${SITE}public/icon-512.png`, await png(svgPage(icon(512)), 512, 512));
  // Maskable: full bleed, the ₿ inside the middle 60% that every mask keeps.
  writeFileSync(`${SITE}public/icon-maskable-512.png`, await png(svgPage(icon(512, { square: true, pad: 0.25 })), 512, 512));
  const image = await png(share, 1200, 630);
  for (const name of ['opengraph-image', 'twitter-image']) {
    writeFileSync(`${SITE}app/${name}.png`, image);
    writeFileSync(`${SITE}app/${name}.alt.txt`, SHARE_ALT);
  }
  console.log('wrote the icons and the share image');
} finally {
  await browser.close();
}
