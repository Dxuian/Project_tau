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
