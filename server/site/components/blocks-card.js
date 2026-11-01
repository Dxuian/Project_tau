'use client';
// The visitor's blocks and their payouts (usePayouts in lib/hooks.js).
import { BlocksIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { btc } from '@/lib/format';

const STATUS = {
  paid: ['Paid', 'success'],
  'already-paid': ['Paid', 'success'],
  immature: ['Waiting for 100 confirmations', 'secondary'],
  'not-in-chain': ['Not in the chain (stale or orphaned)', 'destructive'],
  'not-ours': "Doesn't pay our address",
  'not-paid-yet': ['Verified; the payment is pending', 'secondary'],
  'needs-review': ['Being checked by hand', 'secondary'],
};

function txLink(network, txid) {
  if (network === 'mainnet') return `https://mempool.space/tx/${txid}`;
  if (network === 'testnet') return `https://mempool.space/testnet/tx/${txid}`;
  return null;
}

export default function BlocksCard({ network, address, payouts, checkedAt, checking, onCheck, style, className }) {
  const results = payouts?.results;
  return (
    <Card data-testid="payouts" className={className} style={style}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BlocksIcon className="size-4 text-primary" />
          Your blocks
        </CardTitle>
        <CardDescription>Paid out after 100 confirmations.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onCheck} disabled={!address || checking} data-testid="check-payout">
            <RefreshCwIcon className={checking ? 'animate-spin' : undefined} />
            Check now
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm">
        {!address && <p className="text-muted-foreground">Add a payout address to see your blocks.</p>}
        {address && !payouts && <p className="text-muted-foreground">Checking…</p>}
        {payouts?.error && <p className="text-destructive">{payouts.error}</p>}
        {results?.length === 0 && <p className="text-muted-foreground">No blocks found yet.</p>}
        {results?.length > 0 && (
          <ul className="space-y-2">
            {results.map((r) => {
              const [label, tone] = Array.isArray(STATUS[r.status]) ? STATUS[r.status] : [STATUS[r.status] ?? r.status, 'outline'];
              const link = r.txid && txLink(network, r.txid);
              return (
                <li key={r.blockHash} data-testid="payout" data-status={r.status} className="space-y-1.5 rounded-xl border bg-background/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs" translate="no">
                      {r.blockHash.slice(0, 16)}…
                    </span>
                    <Badge variant={tone}>{label}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    {r.confirmations !== undefined && r.status === 'immature' && <span>{r.confirmations}/100 confirmations</span>}
                    {r.payoutSats && <span className="font-mono text-foreground">{btc(r.payoutSats)}</span>}
                    {r.txid &&
                      (link ? (
                        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          transaction <ExternalLinkIcon className="size-3" />
                        </a>
                      ) : (
                        <span className="break-all font-mono">{r.txid}</span>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {checkedAt > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Checked {new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, again every 5 minutes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
