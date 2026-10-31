'use client';
// Consent-first mining in the browser. The miner (tau-crypto's dist, copied to
// /tau-crypto/ at build time) is loaded only when the visitor presses Start; it
// mines through the payout service's bridge, which logs it in with this hour's
// address of ours (`slot`). Payout status comes from the site's /api/payout.
import { useCallback, useEffect, useRef, useState } from 'react';

const STATUS = {
  paid: 'Paid',
  'already-paid': 'Paid',
  immature: 'Block found: waiting for 100 confirmations',
  'not-in-chain': 'Not in the chain (stale or orphaned)',
  'not-ours': "Doesn't pay our address",
  'not-paid-yet': 'Verified; the payment is pending',
  'needs-review': 'Being checked by hand',
};

const btc = (sats) => `${(Number(sats) / 1e8).toFixed(8)} BTC`;
function rate(hps) {
  if (hps >= 1e6) return `${(hps / 1e6).toFixed(2)} MH/s`;
  if (hps >= 1e3) return `${(hps / 1e3).toFixed(1)} kH/s`;
  return `${Math.round(hps)} H/s`;
}
function txLink(network, txid) {
  if (network === 'mainnet') return `https://mempool.space/tx/${txid}`;
  if (network === 'testnet') return `https://mempool.space/testnet/tx/${txid}`;
  return null;
}

export default function Miner({ address, network, bridgeUrl, pool, minerUrl, slot }) {
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState('idle');
  const [hps, setHps] = useState(0);
  const [shares, setShares] = useState({ accepted: 0, rejected: 0 });
  const [throttle, setThrottle] = useState(0);
  const [error, setError] = useState('');
  const [payouts, setPayouts] = useState(null);
  const miner = useRef(null);

  useEffect(() => () => void miner.current?.stop(), []);

  const start = async () => {
    setError('');
    setState('starting');
    try {
      const lib = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ minerUrl);
      const url = `${bridgeUrl}${bridgeUrl.includes('?') ? '&' : '?'}slot=${slot}`;
      const m = await lib.mineBTC(address, url, { pool, network, throttle });
      miner.current = m;
      m.on('state', setState);
      m.on('hashrate', (h) => setHps(h.hps));
      m.on('share', (s) => setShares((c) => (s.accepted ? { ...c, accepted: c.accepted + 1 } : { ...c, rejected: c.rejected + 1 })));
      m.on('error', (e) => setError(e.message));
      setState('running');
    } catch (err) {
      setError(err.message);
      setState('idle');
    }
  };
  const stop = async () => {
    const m = miner.current;
    miner.current = null;
    await m?.stop();
    setState('stopped');
    setHps(0);
  };
  const changeThrottle = (value) => {
    setThrottle(value);
    miner.current?.setThrottle(value);
  };

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/payout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) });
      const body = await res.json().catch(() => ({}));
      setPayouts(res.ok ? { results: body.results ?? [] } : { error: body.error ?? `error ${res.status}` });
    } catch {
      setPayouts({ error: 'the payout service is unreachable' });
    }
  }, [address]);
  useEffect(() => {
    check();
    const timer = setInterval(check, 5 * 60_000);
    return () => clearInterval(timer);
  }, [check]);

  const running = state === 'running' || state === 'starting' || state === 'paused';
  return (
    <>
      <div className="panel">
        <h2>Mining</h2>
        <label className="check">
          <input type="checkbox" checked={consent} disabled={running} onChange={(e) => setConsent(e.target.checked)} data-testid="consent" />
          <span>
            I agree to mine with this device. It uses the CPU (and power) while this page is open, and pauses when I switch away.
          </span>
        </label>
        {!running ? (
          <button className="primary" disabled={!consent} onClick={start} data-testid="start">
            Start mining
          </button>
        ) : (
          <button onClick={stop} data-testid="stop">
            Stop
          </button>
        )}
        <label>
          Speed{' '}
          <select value={throttle} onChange={(e) => changeThrottle(Number(e.target.value))} style={{ width: 'auto' }}>
            <option value={0}>Full</option>
            <option value={0.25}>75%</option>
            <option value={0.5}>Half</option>
            <option value={0.75}>Quarter</option>
          </select>
        </label>
        <div className="stats">
          <div className="stat">
            State<b data-testid="state">{state}</b>
          </div>
          <div className="stat">
            Speed<b data-testid="hashrate">{rate(hps)}</b>
          </div>
          <div className="stat">
            Shares<b>
              {shares.accepted} accepted{shares.rejected ? `, ${shares.rejected} rejected` : ''}
            </b>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel" data-testid="payouts">
        <h2>Your blocks</h2>
        {!payouts && <p className="muted">Checking…</p>}
        {payouts?.error && <p className="error">{payouts.error}</p>}
        {payouts?.results?.length === 0 && <p className="muted">No blocks found yet.</p>}
        {payouts?.results?.length > 0 && (
          <ul>
            {payouts.results.map((r) => (
              <li key={r.blockHash} data-testid="payout" data-status={r.status}>
                <span className="mono">{r.blockHash.slice(0, 16)}…</span>: {STATUS[r.status] ?? r.status}
                {r.confirmations !== undefined && r.status === 'immature' ? ` (${r.confirmations}/100)` : ''}
                {r.payoutSats ? `, ${btc(r.payoutSats)}` : ''}
                {r.txid && (txLink(network, r.txid) ? <> (<a href={txLink(network, r.txid)}>transaction</a>)</> : <span className="mono"> {r.txid}</span>)}
              </li>
            ))}
          </ul>
        )}
        <button onClick={check} data-testid="check-payout">
          Check now
        </button>
      </div>
    </>
  );
}
