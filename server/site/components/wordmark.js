// The site's name, Bitrush, with its B drawn as Bitcoin's ₿ in the theme's font (.btc-b in
// app/globals.css). Never translated; read as "Bitrush".
import { cn } from '@/lib/utils';

const NAME = 'Bitrush';

/** "₿itrush", for a heading or the logo (`letter` alone: just the ₿). */
export default function Wordmark({ letter = false, className }) {
  return (
    <span translate="no" role="img" aria-label={NAME} className={cn('notranslate', className)}>
      <span aria-hidden className="btc-b">
        B
      </span>
      {!letter && <span aria-hidden>itrush</span>}
    </span>
  );
}
