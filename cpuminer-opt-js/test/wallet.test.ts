// Wallet creation and restore, checked against the BIP39 / BIP32 / BIP84 test vectors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { addressScript, createWallet, isValidAddress, walletFromMnemonic } from '../src/wallet/index.ts';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('BIP84 test vector: first receive address', () => {
  const w = walletFromMnemonic(ABANDON);
  assert.equal(w.path, "m/84'/0'/0'/0/0");
  assert.equal(w.address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(addressScript(w.address), '0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2');
});

test('BIP39 test vectors (Trezor, passphrase "TREZOR")', () => {
  const vectors = [
    [
      '00000000000000000000000000000000',
      ABANDON,
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    ],
    [
      '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
      '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607',
    ],
  ];
  for (const [entropy, words, seed] of vectors) {
    assert.equal(entropyToMnemonic(Buffer.from(entropy, 'hex'), wordlist), words);
    assert.equal(hex(mnemonicToSeedSync(words, 'TREZOR')), seed);
  }
});

test('BIP32 test vector 1', () => {
  const m = HDKey.fromMasterSeed(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));
  assert.equal(
    m.privateExtendedKey,
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
  );
  assert.equal(
    m.derive("m/0'").privateExtendedKey,
    'xprv9uHRZZhk6KAJC1avXpDAp4MDc3sQKNxDiPvvkX8Br5ngLNv1TxvUxt4cV1rGL5hj6KCesnDYUhd7oWgT11eZG7XnxHrnYeSvkzY7d2bhkJ7',
  );
});

test('createWallet makes valid, unique wallets that restore to the same address', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const w = createWallet();
    assert.equal(w.mnemonic.split(' ').length, 12);
    assert.ok(validateMnemonic(w.mnemonic, wordlist));
    assert.match(w.address, /^bc1q[02-9ac-hj-np-z]{38}$/);
    assert.equal(walletFromMnemonic(w.mnemonic).address, w.address);
    assert.ok(!seen.has(w.mnemonic));
    seen.add(w.mnemonic);
  }
  const long = createWallet({ words: 24 });
  assert.equal(long.mnemonic.split(' ').length, 24);
  const reg = createWallet({ network: 'regtest' });
  assert.match(reg.address, /^bcrt1q/);
  assert.equal(reg.path, "m/84'/1'/0'/0/0");
  assert.ok(isValidAddress(reg.address, 'regtest'));
  assert.ok(!isValidAddress(reg.address, 'mainnet'));
});

test('rejects bad words, bad checksums and bad options', () => {
  assert.throws(() => walletFromMnemonic(ABANDON.replace('about', 'abandon')), /checksum/);
  assert.throws(() => walletFromMnemonic('hello world'), /mnemonic/);
  assert.throws(() => createWallet({ words: 13 as 12 }), /12 or 24/);
  assert.throws(() => createWallet({ network: 'litecoin' as 'mainnet' }), /unknown network/);
  // Extra spaces and capitals are tolerated.
  assert.equal(walletFromMnemonic(`  ${ABANDON.toUpperCase()}  `).address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
});

test('address validation', () => {
  assert.ok(isValidAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'));
  assert.ok(isValidAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')); // P2PKH
  assert.ok(!isValidAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv')); // checksum
  assert.ok(!isValidAddress('not an address'));
  assert.ok(!isValidAddress(42));
});
