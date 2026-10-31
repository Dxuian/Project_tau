'use client';
// Getting a payout address, all in the browser: type one in, create a wallet
// (its words never leave this page except through the visitor's own download,
// copy or share), or restore one from its backup file. Only the address is
// remembered on this device.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createWallet, isValidAddress, walletFromMnemonic } from 'tau-crypto/wallet.js';
import { backupFileName, backupText, readBackup } from '../../lib/backup.js';

const SAVED = 'tau.address';

export default function WalletSetup({ network }) {
  const router = useRouter();
  const [mode, setMode] = useState('address');
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
      if (s?.network === network && isValidAddress(s.address, network)) setSaved(s.address);
    } catch {
      // nothing saved
    }
  }, [network]);

  const go = (address) => {
    localStorage.setItem(SAVED, JSON.stringify({ address, network }));
    router.push(`/mine/${address}`);
  };
  const pick = (next) => {
    setError('');
    setMode(next);
  };

  return (
    <>
      {saved && (
        <div className="panel">
          <p>
            This device remembers <span className="mono">{saved}</span>.
          </p>
          <button className="primary" onClick={() => go(saved)}>
            Continue with it
          </button>
        </div>
      )}
      <div className="tabs" role="group" aria-label="How to get an address">
        <button aria-pressed={mode === 'address'} onClick={() => pick('address')}>
          I have an address
        </button>
        <button aria-pressed={mode === 'create'} onClick={() => pick('create')}>
          Create a wallet
        </button>
        <button aria-pressed={mode === 'restore'} onClick={() => pick('restore')}>
          Restore from backup file
        </button>
      </div>
      {mode === 'address' && <EnterAddress network={network} onDone={go} />}
      {mode === 'create' && <CreateWallet network={network} onDone={go} />}
      {mode === 'restore' && <RestoreWallet network={network} onDone={go} onError={setError} />}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function EnterAddress({ network, onDone }) {
  const [value, setValue] = useState('');
  const address = value.trim();
  const valid = isValidAddress(address, network);
  return (
    <div className="panel">
      <label htmlFor="address">Your Bitcoin address ({network})</label>
      <input id="address" type="text" data-testid="address-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="bc1q…" spellCheck={false} />
      {address && !valid && <p className="error">That isn&apos;t a {network} Bitcoin address.</p>}
      <button className="primary" disabled={!valid} onClick={() => onDone(address)}>
        Continue
      </button>
    </div>
  );
}

function CreateWallet({ network, onDone }) {
  const [wallet, setWallet] = useState(null);
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(null); // null | 'confirm' | 'text'

  if (!wallet) {
    return (
      <div className="panel">
        <p>This creates a new wallet in your browser. You get 12 words: they are the wallet. Nobody else, us included, ever sees them.</p>
        <button className="primary" data-testid="create" onClick={() => setWallet(createWallet({ network }))}>
          Create my wallet
        </button>
      </div>
    );
  }

  const text = backupText(wallet);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: backupFileName(wallet) });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.mnemonic);
      setCopied(true);
    } catch {
      setSharing('text'); // no clipboard access: show the words to copy by hand
    }
  };
  // Phones get their share sheet (WhatsApp, Telegram, SMS...); laptops a text box.
  const share = async () => {
    const phone = typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (!phone) return setSharing('text');
    setSharing(null);
    try {
      await navigator.share({ title: 'Project Tau wallet backup', text });
    } catch {
      // cancelled
    }
  };

  return (
    <div className="panel">
      <p>
        Your address: <span className="mono" data-testid="new-address">{wallet.address}</span>
      </p>
      <p>Your 12 words, in order:</p>
      <ol className="words" data-testid="words">
        {wallet.mnemonic.split(' ').map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ol>
      <div className="warn">
        Save these words now; this page won&apos;t show them again. Anyone who has them can take this wallet&apos;s bitcoin, so don&apos;t post them anywhere public.
      </div>
      <button onClick={download} data-testid="download">
        Download backup
      </button>
      <button onClick={copy} data-testid="copy">
        {copied ? 'Copied' : 'Copy words'}
      </button>
      <button onClick={() => setSharing('confirm')} data-testid="share">
        Share…
      </button>
      <label className="check">
        <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} data-testid="saved" />
        <span>I have saved my 12 words somewhere safe.</span>
      </label>
      <button className="primary" disabled={!kept} onClick={() => onDone(wallet.address)} data-testid="continue">
        Continue
      </button>

      {sharing === 'confirm' && (
        <div className="modal" role="dialog" aria-label="Share your words">
          <div>
            <h2>Share your 12 words?</h2>
            <p>
              Sending them in a message app stores them on that service and on every device in that chat. Anyone who can read them
              can take this wallet&apos;s bitcoin. Only send them to yourself.
            </p>
            <button className="primary" onClick={share} data-testid="share-confirm">
              Share anyway
            </button>
            <button onClick={() => setSharing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {sharing === 'text' && (
        <div className="modal" role="dialog" aria-label="Your backup">
          <div>
            <h2>Your backup</h2>
            <p className="muted">Copy it somewhere only you can read.</p>
            <textarea readOnly value={text} data-testid="share-text" onFocus={(e) => e.target.select()} />
            <button onClick={() => setSharing(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RestoreWallet({ network, onDone, onError }) {
  const [restored, setRestored] = useState(null);
  const load = async (file) => {
    onError('');
    setRestored(null);
    if (!file) return;
    try {
      const { words, network: inFile } = readBackup(await file.text());
      if (inFile && inFile !== network) throw new Error(`that backup is for ${inFile}, and this site uses ${network}`);
      setRestored(walletFromMnemonic(words, { network }).address);
    } catch (err) {
      onError(/checksum|mnemonic/.test(err.message) ? "those aren't valid recovery words" : err.message);
    }
  };
  return (
    <div className="panel">
      <label htmlFor="backup">Your backup file (the .txt you downloaded)</label>
      <input id="backup" type="file" accept=".txt,text/plain" data-testid="restore-file" onChange={(e) => load(e.target.files?.[0])} />
      {restored && (
        <>
          <p>
            Restored: <span className="mono" data-testid="restored-address">{restored}</span>
          </p>
          <button className="primary" onClick={() => onDone(restored)}>
            Continue
          </button>
        </>
      )}
    </div>
  );
}
