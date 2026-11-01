'use client';
// The payout address, on the miner's screen: copy it, download it as an address
// file (it can be uploaded again here, on any device), or change it (back to the
// wallet setup).
import { CheckIcon, CopyIcon, DownloadIcon, PencilIcon, WalletIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { track } from '@/lib/analytics';
import { ADDRESS_FILE_NAME, addressFile } from '@/lib/backup';
import { downloadFile } from '@/lib/download';

export default function PayoutCard({ network, address, locked, onChange, style, className }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no clipboard: the address is selectable
    }
  };
  const download = () => {
    downloadFile(addressFile(address, network), ADDRESS_FILE_NAME, 'application/json');
    track('address_downloaded');
  };

  return (
    <Card id="payout" data-testid="payout-card" className={className} style={style}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WalletIcon className="size-4 text-primary" />
          Your payout address
        </CardTitle>
        <CardDescription>Where your payout is sent.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={onChange} disabled={locked} title={locked ? 'Stop mining to change it' : undefined} data-testid="change-address">
            <PencilIcon />
            Change
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-start gap-1 rounded-xl border bg-background/40 p-3">
          <code data-testid="payout-address" translate="no" className="notranslate min-w-0 flex-1 font-mono text-[13px] leading-relaxed break-all">
            {address}
          </code>
          <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy the address">
            {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={download} aria-label="Download the address" data-testid="download-address">
            <DownloadIcon />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Remembered on this device only.</p>
      </CardContent>
    </Card>
  );
}
