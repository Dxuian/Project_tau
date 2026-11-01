// The site's themes. Arcade is the default; the others come from the 24-theme set,
// plus Tau, the earlier look (dark and light). app/themes.css holds their styles.
export const DEFAULT_THEME = 'arcade';
export const THEME_KEY = 'tau.theme';

export const THEMES = [
  { id: 'arcade', name: 'Arcade', dark: true },
  { id: 'tau', name: 'Tau', dark: true },
  { id: 'tau-light', name: 'Tau Light', dark: false },
  { id: 'ledger', name: 'Ledger', dark: false },
  { id: 'vault', name: 'Vault', dark: true },
  { id: 'blueprint', name: 'Blueprint', dark: true },
  { id: 'terminal', name: 'Terminal', dark: true },
  { id: 'neon', name: 'Neon', dark: true },
  { id: 'swiss', name: 'Swiss', dark: false },
  { id: 'gold', name: 'Gold', dark: true },
  { id: 'comic', name: 'Comic', dark: false },
  { id: 'forest', name: 'Forest', dark: false },
  { id: 'brutal', name: 'Brutal', dark: false },
  { id: 'sunset', name: 'Sunset', dark: true },
  { id: 'ocean', name: 'Ocean', dark: true },
  { id: 'candy', name: 'Candy', dark: false },
  { id: 'copper', name: 'Copper', dark: true },
  { id: 'frost', name: 'Frost', dark: false },
  { id: 'volcano', name: 'Volcano', dark: true },
  { id: 'royal', name: 'Royal', dark: true },
  { id: 'mint', name: 'Mint', dark: false },
  { id: 'cyber', name: 'Cyber', dark: true },
  { id: 'lottery', name: 'Lottery', dark: false },
  { id: 'royale', name: 'Grand Casino', dark: true },
  { id: 'casinobtc', name: '₿ Bitcoin Casino', dark: true },
  { id: 'deluxe', name: 'Deluxe ₿ Casino', dark: true },
];

const IDS = THEMES.map((t) => t.id);
const LIGHT = THEMES.filter((t) => !t.dark).map((t) => t.id);

/**
 * Runs in <head> before the page paints, so a visitor's saved theme doesn't flash:
 * a constant string (no user data goes into it), and it only sets an attribute
 * and a class, for a theme id from the list above.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(IDS)}.indexOf(t)<0)return;var d=document.documentElement;d.setAttribute('data-theme',t);d.classList.toggle('dark',${JSON.stringify(LIGHT)}.indexOf(t)<0)}catch(e){}})()`;

/** Switches the page to theme `id` and remembers it on this device. */
export function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.classList.toggle('dark', theme.dark);
  try {
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {
    // not remembered
  }
  return theme;
}
