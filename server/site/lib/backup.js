// The wallet backup: plain text that a person can read and the restore button
// can read back. It holds the 12 words, so whoever has it can spend.
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

/**
 * The words in a backup file (its "Words:" line), or in text that is just the
 * words: { words, network } with network null if the text doesn't say.
 * Throws if there aren't 12 or 24 words.
 */
export function readBackup(text) {
  const line = /^\s*words\s*:\s*(.+)$/im.exec(text);
  const words = (line ? line[1] : text).toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length !== 12 && words.length !== 24) throw new Error('no 12 or 24 recovery words found in that file');
  const network = /^\s*network\s*:\s*(mainnet|testnet|regtest)\s*$/im.exec(text)?.[1] ?? null;
  return { words: words.join(' '), network };
}
