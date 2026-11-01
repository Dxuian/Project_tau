// Numbers and addresses for display.

/** The unit a hash rate reads best in: { unit, scale, digits }. */
export function rateUnit(hps) {
  if (hps >= 1e9) return { unit: 'GH/s', scale: 1e9, digits: 2 };
  if (hps >= 1e6) return { unit: 'MH/s', scale: 1e6, digits: 2 };
  if (hps >= 1e3) return { unit: 'kH/s', scale: 1e3, digits: 1 };
  return { unit: 'H/s', scale: 1, digits: 0 };
}

export function rateText(hps) {
  const { unit, scale, digits } = rateUnit(hps);
  return `${(hps / scale).toFixed(digits)} ${unit}`;
}

/** 3725000 -> "1h 02m", 245000 -> "4m 05s", 9000 -> "9s". */
export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(s % 60)}s`;
  return `${s}s`;
}

/** mm:ss (or h:mm:ss) until `until`. */
export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export const btc = (sats) => `${(Number(sats) / 1e8).toFixed(8)} BTC`;

/** The network's hash rate, roughly (about 10^21 hashes a second), for the odds. */
export const NETWORK_HPS = 1e21;

/** How long `hps` takes, on average, to find a block: "3.8 billion years". */
export function oddsText(hps) {
  if (!(hps > 0)) return null;
  const years = (NETWORK_HPS / hps) * 600 / 31_557_600;
  const big = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ];
  for (const [n, word] of big) if (years >= n) return `${(years / n).toFixed(years / n >= 100 ? 0 : 1)} ${word} years`;
  return `${Math.round(years)} years`;
}
