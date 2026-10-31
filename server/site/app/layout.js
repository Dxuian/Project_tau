import Link from 'next/link';
import './globals.css';

export const metadata = {
  title: 'Project Tau: mine Bitcoin in your browser',
  description: 'Mine Bitcoin in your browser. If you find a block, you get a share of it.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Project Tau
          </Link>
          <nav>
            <Link href="/wallet">Wallet</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="foot">Nothing mines until you press Start. Mining uses your device&apos;s CPU and power.</footer>
      </body>
    </html>
  );
}
