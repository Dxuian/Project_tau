// What search engines, link previews and AI tools read about the site (app/layout.js,
// app/robots.js, app/sitemap.js, app/manifest.js, public/llms.txt): its name, address and
// description, in the page's own words. As on the page: no "lottery" or earnings claims.
export const SITE_URL = 'https://bitrush.online';
export const NAME = 'Bitrush';
export const TAGLINE = 'Mine Bitcoin in your browser.';
export const TITLE = 'Bitrush: mine Bitcoin in your browser';
export const DESCRIPTION =
  'Mine Bitcoin in your browser. Bitrush explains how Bitcoin mining works, creates a wallet on your device and mines with one button. No sign-up, no download.';
export const SHARE_ALT = '₿itrush: mine Bitcoin in your browser.';
export const COLORS = { background: '#24104f', accent: '#ffd23f' }; // Arcade, the default theme

export const KEYWORDS = [
  'Bitrush',
  'bitrush.online',
  'bitcoin mining',
  'mine bitcoin',
  'mine bitcoin in your browser',
  'browser bitcoin miner',
  'bitcoin miner online',
  'web bitcoin miner',
  'BTC mining',
  'BTC miner',
  'solo bitcoin mining',
  'bitcoin mining for beginners',
  'how bitcoin mining works',
  'learn bitcoin mining',
  'bitcoin mining tutorial',
  'crypto mining',
  'cryptocurrency mining',
  'bitcoin wallet',
  'bitcoin address',
  '12-word recovery phrase',
  'bitcoin block reward',
  'proof of work',
  'SHA-256',
  'hash rate',
  'blockchain',
  'decentralized money',
];

// The questions the tutorial answers (components/tutorial.js), in its words.
const FAQ = [
  [
    'How does Bitcoin mining work?',
    'About every 10 minutes, new payments are packed into a block. To add it, computers race to find a hash that starts with about 19 zeros. There is no shortcut, only guessing, and the winner gets 3.125 new bitcoin plus the fees from the payments inside.',
  ],
  [
    'Why does Bitcoin pay miners?',
    'A bank pays its staff to keep its books. Bitcoin has no staff, so it pays its miners instead, for adding each new block. That is the only way new bitcoin is made.',
  ],
  [
    'What do I need to mine on Bitrush?',
    'A wallet. Bitrush can create one in your browser, or you can upload a wallet file or paste an address you already have. Then press Mine BTC to start, and press it again to stop.',
  ],
  [
    'Does Bitrush see my 12 words?',
    "No. Your 12 words are made in your browser and never leave your device, and Bitrush doesn't monitor any sensitive data. Your address is safe to share: it's where bitcoin is sent to you.",
  ],
  [
    'When does a payout arrive?',
    'If your browser finds a block, the payout goes to your address once the block is confirmed, about 100 blocks (around 17 hours) later.',
  ],
];

const STRUCTURED = [
  { '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, alternateName: ['₿itrush', 'bitrush.online'], url: `${SITE_URL}/`, description: DESCRIPTION, inLanguage: 'en' },
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: NAME,
    url: `${SITE_URL}/`,
    description: DESCRIPTION,
    image: `${SITE_URL}/opengraph-image.png`,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any (runs in a web browser)',
    browserRequirements: 'Requires JavaScript and WebAssembly.',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      'Mines Bitcoin in the browser, started and stopped with one button',
      'A tutorial on how Bitcoin mining works, with a try-it guessing game',
      'Creates a Bitcoin wallet on the device; its 12 words never leave it',
      'A live speed graph, shares and payout status',
      '26 themes',
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
  },
];

/** The structured data (schema.org JSON-LD) for the page's <head>; `<` escaped, so it can't end the script. */
export const STRUCTURED_DATA = JSON.stringify(STRUCTURED).replace(/</g, '\\u003c');
