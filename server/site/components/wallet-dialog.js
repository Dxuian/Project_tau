'use client';
// A new wallet, made in this browser (PayoutCard creates it). Its 12 words are
// shown once, here, and leave the page only through the visitor's own download,
// copy or share. Closing without "Use this wallet" throws it away.
import { gsap } from 'gsap';
import { CheckIcon, CopyIcon, DownloadIcon, Share2Icon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { track } from '@/lib/analytics';
import { backupFileName, backupText } from '@/lib/backup';

export default function WalletDialog({ wallet, onClose, onUse }) {
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(null); // null | 'confirm' | 'text'

  // The words come in one by one (GSAP) when the list mounts.
  const reveal = useCallback((list) => {
    if (!list || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.from(list.children, { opacity: 0, y: 10, scale: 0.94, duration: 0.45, ease: 'back.out(1.7)', stagger: 0.035 });
  }, []);

  const close = () => {
    setKept(false);
    setCopied(false);
    setSharing(null);
    onClose();
  };
  if (!wallet) return null;
  const text = backupText(wallet);
  const words = wallet.mnemonic.split(' ');

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: backupFileName(wallet) });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    track('backup_downloaded');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.mnemonic);
      setCopied(true);
      track('words_copied', { via: 'clipboard' });
    } catch {
      setSharing('text'); // no clipboard access: the words to copy by hand
      track('words_copied', { via: 'text_box' });
    }
  };
  // Phones get their share sheet (WhatsApp, Telegram, SMS...); laptops a text box.
  const share = async () => {
    const phone = typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
    track('words_shared', { via: phone ? 'share_sheet' : 'text_box' });
    if (!phone) return setSharing('text');
    setSharing(null);
    try {
      await navigator.share({ title: 'Project Tau wallet backup', text });
    } catch {
      // cancelled
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Your new wallet</DialogTitle>
          <DialogDescription>These 12 words are the wallet. They were made in this browser, and nobody else, us included, ever sees them.</DialogDescription>
        </DialogHeader>

        <ol ref={reveal} key={wallet.address} data-testid="words" translate="no" className="notranslate grid grid-cols-2 gap-2 sm:grid-cols-3">
          {words.map((w, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border bg-background/50 px-3 py-2">
              <span className="w-5 text-right font-mono text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <span data-testid="word" className="font-mono text-sm font-medium">
                {w}
              </span>
            </li>
          ))}
        </ol>

        <div className="rounded-xl border bg-background/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Its address: </span>
          <code data-testid="new-address" translate="no" className="notranslate break-all font-mono">
            {wallet.address}
          </code>
        </div>

        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-200">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p>Save the words now: this won&apos;t show them again. Anyone who has them can take this wallet&apos;s bitcoin, so never post them anywhere.</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" onClick={download} data-testid="download">
            <DownloadIcon />
            Download
          </Button>
          <Button variant="outline" onClick={copy} data-testid="copy">
            {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" onClick={() => setSharing('confirm')} data-testid="share">
            <Share2Icon />
            Share…
          </Button>
        </div>

        {sharing === 'confirm' && (
          <div role="alertdialog" aria-label="Share your words?" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="font-medium">Share your 12 words?</p>
            <p className="text-muted-foreground">
              Sending them in a message app stores them on that service and on every device in that chat. Anyone who can read them can take this wallet&apos;s bitcoin. Only send them to
              yourself.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={share} data-testid="share-confirm">
                Share anyway
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSharing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {sharing === 'text' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Your backup. Copy it somewhere only you can read.</p>
            <textarea
              readOnly
              value={text}
              data-testid="share-text"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              translate="no"
              onFocus={(e) => e.target.select()}
              className="notranslate h-40 w-full resize-none rounded-lg border bg-background/50 p-3 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button size="sm" variant="outline" onClick={() => setSharing(null)} data-testid="share-done">
              Done
            </Button>
          </div>
        )}

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} data-testid="saved" className="size-4 accent-[var(--primary)]" />
            I&apos;ve saved my 12 words somewhere safe
          </label>
          <Button disabled={!kept} onClick={() => onUse(wallet.address)} data-testid="use-wallet">
            Use this wallet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
