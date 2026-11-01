'use client';
// Before the miner: where payouts go. Create a wallet here (its 12 words shown
// once, to download, copy or share, then confirmed saved), upload a wallet or
// address file, or paste an address. All in the browser; only the address is
// remembered. The miner shows only once this is done.
import { ArrowLeftIcon, FileUpIcon, SparklesIcon, WalletIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { createWallet, isValidAddress, walletFromMnemonic } from 'tau-crypto/wallet.js';
import RecoveryPhrase from '@/components/recovery-phrase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { track } from '@/lib/analytics';
import { fileError, readWalletFile } from '@/lib/backup';

export default function WalletSetup({ network, onDone, onCancel }) {
  const [wallet, setWallet] = useState(null);
  const [kept, setKept] = useState(false);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState('');
  const fileInput = useRef(null);
  const typed = value.trim();
  const valid = isValidAddress(typed, network);

  const create = () => {
    setProblem('');
    setKept(false);
    setWallet(createWallet({ network }));
    track('wallet_created');
  };
  const upload = async (file) => {
    setProblem('');
    if (!file) return;
    try {
      const found = readWalletFile(await file.text());
      if (found.network && found.network !== network) throw fileError(`That file is for ${found.network}, and this site uses ${network}.`, 'other_network');
      if (found.words) {
        const address = walletFromMnemonic(found.words, { network }).address;
        track('wallet_restored');
        onDone(address, 'restored');
      } else {
        if (!isValidAddress(found.address, network)) throw fileError(`That file's address isn't a ${network} Bitcoin address.`, 'invalid_address');
        track('address_uploaded');
        onDone(found.address, 'uploaded');
      }
    } catch (err) {
      const invalid = /checksum|mnemonic/.test(err.message);
      track('wallet_restore_failed', { reason: err.reason ?? (invalid ? 'invalid_words' : 'unreadable') });
      // Our own messages only: never anything from the file.
      setProblem(invalid ? "Those aren't valid recovery words." : err.reason ? err.message : "That file couldn't be read.");
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  if (wallet) {
    return (
      <Card data-testid="reveal" className="reveal mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-lg">Your recovery phrase</CardTitle>
          <CardDescription>These 12 words are the wallet, made in this browser. Nobody else, us included, ever sees them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <RecoveryPhrase wallet={wallet} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} data-testid="saved" className="size-4 accent-[var(--primary)]" />
              I&apos;ve saved my recovery phrase
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setWallet(null)}>
                <ArrowLeftIcon />
                Back
              </Button>
              <Button disabled={!kept} onClick={() => onDone(wallet.address, 'created')} data-testid="use-wallet">
                Continue to miner
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div data-testid="setup" className="mx-auto w-full max-w-5xl space-y-6">
      <div className="reveal text-center" style={{ '--i': 1 }}>
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Set up your wallet</h2>
        <p className="mt-2 text-sm text-muted-foreground">You need a wallet before you can mine. Make a new one here, or bring your own.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="reveal" style={{ '--i': 2 }}>
          <CardHeader>
            <SparklesIcon className="mb-2 size-5 text-primary" />
            <CardTitle>Create a wallet</CardTitle>
            <CardDescription>A new 12-word recovery phrase, made in this browser.</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button className="w-full" onClick={create} data-testid="create-wallet">
              Create wallet
            </Button>
          </CardContent>
        </Card>

        <Card className="reveal" style={{ '--i': 3 }}>
          <CardHeader>
            <FileUpIcon className="mb-2 size-5 text-primary" />
            <CardTitle>Upload a wallet</CardTitle>
            <CardDescription>Your backup .txt, or a .json with your words or an address.</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button variant="outline" className="w-full" onClick={() => fileInput.current?.click()} data-testid="upload">
              Choose file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.json,text/plain,application/json"
              className="hidden"
              data-testid="restore-file"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </CardContent>
        </Card>

        <Card className="reveal" style={{ '--i': 4 }}>
          <CardHeader>
            <WalletIcon className="mb-2 size-5 text-primary" />
            <CardTitle>Use an address</CardTitle>
            <CardDescription>Already have a Bitcoin address? Paste it.</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto space-y-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) onDone(typed, 'typed');
              }}
            >
              <Input
                data-testid="address-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={network === 'mainnet' ? 'bc1…' : 'Your address'}
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
          </CardContent>
        </Card>
      </div>

      {problem && (
        <p role="alert" className="text-center text-sm text-destructive">
          {problem}
        </p>
      )}
      {onCancel && (
        <div className="text-center">
          <Button variant="ghost" onClick={onCancel} data-testid="setup-cancel">
            <ArrowLeftIcon />
            Back to the miner
          </Button>
        </div>
      )}
    </div>
  );
}
