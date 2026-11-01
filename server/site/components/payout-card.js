'use client';
// The visitor's payout address: paste one, create a wallet here, or restore one
// from its backup file. All in the browser; only the address is remembered.
import { CheckIcon, CopyIcon, PencilIcon, SparklesIcon, UploadIcon, WalletIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { createWallet, isValidAddress, walletFromMnemonic } from 'tau-crypto/wallet.js';
import WalletDialog from '@/components/wallet-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { track } from '@/lib/analytics';
import { readBackup } from '@/lib/backup';

export default function PayoutCard({ network, address, ready, locked, onChoose, style, className }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState('');
  const [wallet, setWallet] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef(null);
  const typed = value.trim();
  const valid = isValidAddress(typed, network);
  const editor = ready && (!address || editing);

  const choose = (next, source) => {
    onChoose(next, source);
    setEditing(false);
    setValue('');
    setProblem('');
  };
  const create = () => {
    setProblem('');
    setWallet(createWallet({ network }));
    track('wallet_created');
  };
  const restore = async (file) => {
    setProblem('');
    if (!file) return;
    try {
      const { words, network: inFile } = readBackup(await file.text());
      if (inFile && inFile !== network) {
        throw Object.assign(new Error(`That backup is for ${inFile}, and this site uses ${network}.`), { reason: 'other_network' });
      }
      const restored = walletFromMnemonic(words, { network }).address;
      track('wallet_restored');
      choose(restored, 'restored');
    } catch (err) {
      const invalid = /checksum|mnemonic/.test(err.message);
      track('wallet_restore_failed', { reason: err.reason ?? (invalid ? 'invalid_words' : 'unreadable') });
      setProblem(invalid ? "Those aren't valid recovery words." : err.message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no clipboard: the address is selectable
    }
  };

  return (
    <Card id="payout" data-testid="payout-card" className={className} style={style}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WalletIcon className="size-4 text-primary" />
          Your payout address
        </CardTitle>
        <CardDescription>Where your payout is sent.</CardDescription>
        {address && !editor && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} disabled={locked} title={locked ? 'Stop mining to change it' : undefined} data-testid="change-address">
              <PencilIcon />
              Change
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {!ready && <div className="h-10 animate-pulse rounded-lg bg-muted" />}
        {editor && (
          <div className="space-y-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) choose(typed, 'typed');
              }}
            >
              <Input
                data-testid="address-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={network === 'mainnet' ? 'Paste your bc1… address' : 'Paste your address'}
                aria-label={`Your Bitcoin address (${network})`}
                aria-invalid={typed && !valid ? true : undefined}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                translate="no"
                className="notranslate font-mono"
              />
              <Button type="submit" disabled={!valid} data-testid="use-address">
                Use
              </Button>
            </form>
            {typed && !valid && <p className="text-xs text-destructive">That isn&apos;t a {network} Bitcoin address.</p>}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              no wallet yet?
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={create} data-testid="create-wallet">
                <SparklesIcon className="text-primary" />
                Create one
              </Button>
              <Button variant="outline" onClick={() => fileInput.current?.click()} data-testid="restore">
                <UploadIcon />
                Restore backup
              </Button>
            </div>
            <input ref={fileInput} type="file" accept=".txt,text/plain" className="hidden" data-testid="restore-file" onChange={(e) => restore(e.target.files?.[0])} />
            {problem && <p className="text-xs text-destructive">{problem}</p>}
            {address && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setEditing(false)}>
                Keep the current one
              </Button>
            )}
          </div>
        )}
        {ready && !editor && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-xl border bg-background/40 p-3">
              <code data-testid="payout-address" translate="no" className="notranslate min-w-0 flex-1 break-all font-mono text-[13px] leading-relaxed">
                {address}
              </code>
              <Button variant="ghost" size="icon-sm" onClick={copyAddress} aria-label="Copy the address">
                {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="success">Ready</Badge>
              Remembered on this device only.
            </div>
          </div>
        )}
      </CardContent>
      <WalletDialog
        wallet={wallet}
        onClose={() => setWallet(null)}
        onUse={(created) => {
          setWallet(null);
          choose(created, 'created');
        }}
      />
    </Card>
  );
}
