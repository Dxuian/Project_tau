// The files a visitor keeps: the wallet backup (plain text a person can read, with
// the 12 words, so whoever has it can spend) and the address file (just the
// address, public). The upload accepts either, or a .json with words or an address.
export function backupText(wallet) {
  return [
    'Project Tau wallet backup',
    "Anyone who has these words can spend this wallet's bitcoin. Keep them private.",
    '',
    `Words: ${wallet.mnemonic}`,
    `Address: ${wallet.address}`,
    `Network: ${wallet.network}`,
    `Path: ${wallet.path}`,
    '',
  ].join('\n');
}

export function backupFileName(wallet) {
  return `tau-wallet-${wallet.address.slice(0, 14)}.txt`;
}

/** The address file: { address, network } as JSON. No words in it. */
export function addressFile(address, network) {
  return `${JSON.stringify({ address, network }, null, 2)}\n`;
}

export const ADDRESS_FILE_NAME = 'tau-address.json';

/** An error whose message is ours (fixed text, never the file's content), with a reason for analytics. */
export function fileError(message, reason) {
  return Object.assign(new Error(message), { reason });
}

function wordList(text) {
  const words = String(text).toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length !== 12 && words.length !== 24) throw fileError('No 12 or 24 recovery words in that file.', 'no_words');
  return words.join(' ');
}

/**
 * What an uploaded file holds: { words, network } or { address, network }
 * (network null when it doesn't say). Accepts:
 *   - the backup .txt (its "Words:" line), or text that is just the 12 or 24 words;
 *   - text that is just an address, or has an "Address:" line and no words;
 *   - .json with "mnemonic" (or "words"), or "address" (or "addresses": [...]).
 * Throws fileError, whose messages never repeat the file's content.
 */
export function readWalletFile(text) {
  const t = String(text).trim();
  if (t.startsWith('{')) {
    let json;
    try {
      json = JSON.parse(t);
    } catch {
      throw fileError("That file isn't valid JSON.", 'unreadable');
    }
    const network = typeof json?.network === 'string' ? json.network : null;
    const words = typeof json?.mnemonic === 'string' ? json.mnemonic : typeof json?.words === 'string' ? json.words : null;
    if (words) return { words: wordList(words), network };
    const address = typeof json?.address === 'string' ? json.address : Array.isArray(json?.addresses) ? json.addresses.find((a) => typeof a === 'string') : null;
    if (address) return { address: address.trim(), network };
    throw fileError('No recovery words or address in that file.', 'empty');
  }
  const network = /^\s*network\s*:\s*(mainnet|testnet|regtest)\s*$/im.exec(t)?.[1] ?? null;
  const wordsLine = /^\s*words\s*:\s*(.+)$/im.exec(t);
  if (wordsLine) return { words: wordList(wordsLine[1]), network };
  const addressLine = /^\s*address\s*:\s*(\S+)\s*$/im.exec(t);
  if (addressLine) return { address: addressLine[1], network };
  if (!/\s/.test(t) && t) return { address: t, network };
  return { words: wordList(t), network };
}
