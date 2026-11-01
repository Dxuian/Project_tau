'use client';
// A new wallet's 12 words, shown once (in the setup's second step), with the
// visitor's ways to keep them: download, copy, share. They leave the page only
// through those.
import { gsap } from 'gsap';
import { CheckIcon, CopyIcon, DownloadIcon, Share2Icon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics';
import { backupFileName, backupText } from '@/lib/backup';
import { downloadFile } from '@/lib/download';

export default function RecoveryPhrase({ wallet }) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(null); // null | 'confirm' | 'text'

  // The words come in one by one (GSAP) when the list mounts.
  const reveal = useCallback((list) => {
    if (!list || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.from(list.children, { opacity: 0, y: 10, scale: 0.94, duration: 0.45, ease: 'back.out(1.7)', stagger: 0.035 });
  }, []);

  const text = backupText(wallet);
  const download = () => {
    downloadFile(text, backupFileName(wallet), 'text/plain;charset=utf-8');
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
    <div className="space-y-4">
      <ol ref={reveal} key={wallet.address} data-testid="words" translate="no" className="notranslate grid grid-cols-2 gap-2 sm:grid-cols-3">
        {wallet.mnemonic.split(' ').map((w, i) => (
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
        <code data-testid="new-address" translate="no" className="notranslate font-mono break-all">
          {wallet.address}
        </code>
      </div>

      <div className="flex gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>Save the words now: they won&apos;t be shown again. Anyone who has them can take this wallet&apos;s bitcoin, so never post them anywhere.</p>
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
    </div>
  );
}
