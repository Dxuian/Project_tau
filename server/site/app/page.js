import Link from 'next/link';

export default function Home() {
  return (
    <>
      <h1>Mine Bitcoin in your browser</h1>
      <p>
        Your browser helps mine Bitcoin blocks. If it finds a block, the reward comes to us first, then we send <b>10%</b> of it to
        your address. We verify that your miner found it before anything is paid.
      </p>
      <div className="warn">
        <b>The odds are tiny.</b> A browser does a few million hashes a second; the whole Bitcoin network does about 10
        <sup>21</sup>. One browser finds a block roughly once in two billion years, so think of it as a lottery ticket, not income.
      </div>
      <div className="panel">
        <h2>How it works</h2>
        <ol>
          <li>Enter your Bitcoin address, or create a wallet here. Its 12 words never leave your device.</li>
          <li>Agree to mine and press Start. It uses your CPU while the page is open, and pauses when you switch away.</li>
          <li>If your miner finds a block, wait for 100 confirmations (about 17 hours). Then we pay your share.</li>
        </ol>
        <Link href="/wallet" className="button primary">
          Get started
        </Link>
      </div>
    </>
  );
}
