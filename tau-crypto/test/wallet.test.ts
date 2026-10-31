// Wallet creation and restore, checked against the BIP39 / BIP32 / BIP84 test vectors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { accountXpub, addressScript, createWallet, isValidAddress, newAddress, walletFromMnemonic } from '../src/wallet/index.ts';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('BIP84 test vector: first receive address', () => {
  const w = walletFromMnemonic(ABANDON);
  assert.equal(w.path, "m/84'/0'/0'/0/0");
  assert.equal(w.address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(addressScript(w.address), '0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2');
});

test('BIP84 test vector: newAddress gives the second receive address, then the ones after it', () => {
  const second = newAddress({ mnemonic: ABANDON });
  assert.deepEqual(second, {
    mnemonic: ABANDON,
    address: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
    path: "m/84'/0'/0'/0/1",
    network: 'mainnet',
    index: 1,
  });
  assert.equal(newAddress({ mnemonic: ABANDON }, { index: 0 }).address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  const third = newAddress(second);
  assert.equal(third.path, "m/84'/0'/0'/0/2");
  assert.equal(newAddress(third).path, "m/84'/0'/0'/0/3");
  // The same wallet gives the same address: nothing is remembered between calls.
  assert.deepEqual(newAddress(second), third);
  assert.deepEqual(newAddress({ mnemonic: ABANDON }, { index: 2 }), third);
  assert.equal(newAddress({ mnemonic: ` ${ABANDON.toUpperCase()} ` }).mnemonic, ABANDON);
});

test('newAddress keeps the wallet and its network, and walks distinct addresses', () => {
  const w = createWallet({ network: 'regtest' });
  assert.equal(w.index, 0);
  assert.equal(createWallet().index, 0);
  const seen = new Set([w.address]);
  let current = w;
  for (let i = 1; i <= 20; i++) {
    current = newAddress(current);
    assert.equal(current.index, i);
    assert.equal(current.path, `m/84'/1'/0'/0/${i}`);
    assert.equal(current.mnemonic, w.mnemonic);
    assert.equal(current.network, 'regtest');
    assert.match(current.address, /^bcrt1q/);
    assert.ok(isValidAddress(current.address, 'regtest'));
    assert.ok(!seen.has(current.address));
    seen.add(current.address);
  }
  assert.equal(newAddress(w, { index: 0 }).address, w.address);
});

test('newAddress rejects bad indexes, words and networks', () => {
  for (const index of [-1, 1.5, 2 ** 31, Number.NaN, '3' as unknown as number]) {
    assert.throws(() => newAddress({ mnemonic: ABANDON }, { index }), /index must be a whole number/);
  }
  assert.throws(() => newAddress({ mnemonic: ABANDON, index: 2 ** 31 - 1 }), /index must be a whole number/);
  assert.equal(newAddress({ mnemonic: ABANDON }, { index: 2 ** 31 - 1 }).index, 2 ** 31 - 1);
  assert.throws(() => newAddress({ mnemonic: ABANDON.replace('about', 'abandon') }), /checksum/);
  assert.throws(() => newAddress({ mnemonic: ABANDON, network: 'litecoin' as 'mainnet' }), /unknown network/);
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

// BIP84's published account key for the ABANDON words (m/84'/0'/0'), in its SLIP-132 form.
const BIP84_ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

test('BIP84 test vector: the account zpub derives the receive addresses without the words', () => {
  const first = newAddress({ xpub: BIP84_ZPUB }, { index: 0 });
  assert.deepEqual(first, {
    xpub: BIP84_ZPUB,
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    path: "m/84'/0'/0'/0/0",
    network: 'mainnet',
    index: 0,
  });
  assert.equal(newAddress(first).address, 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
  assert.equal(newAddress(first).path, "m/84'/0'/0'/0/1");
  assert.ok(!('mnemonic' in first), 'watch-only: no words');
});

test('accountXpub gives the same addresses as the words', () => {
  const xpub = accountXpub(ABANDON);
  assert.match(xpub, /^xpub/);
  for (const index of [0, 1, 7, 2 ** 31 - 1]) {
    assert.equal(newAddress({ xpub }, { index }).address, newAddress({ mnemonic: ABANDON }, { index }).address, `index ${index}`);
  }
  const reg = createWallet({ network: 'regtest' });
  const tpub = accountXpub(reg.mnemonic, { network: 'regtest' });
  assert.match(tpub, /^tpub/);
  assert.equal(newAddress({ xpub: tpub, network: 'regtest' }, { index: 0 }).address, reg.address);
  assert.equal(newAddress({ xpub: tpub, network: 'regtest' }, { index: 3 }).address, newAddress(reg, { index: 3 }).address);
});

test('watch-only keys: refuses private keys, other networks, other depths and garbage', async () => {
  const { HDKey } = await import('@scure/bip32');
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(ABANDON));
  const xpub = accountXpub(ABANDON);
  assert.throws(() => newAddress({ xpub: master.derive("m/84'/0'/0'").privateExtendedKey }, { index: 0 }), /account public key/);
  assert.throws(() => newAddress({ xpub, network: 'regtest' }, { index: 0 }), /regtest account public key/);
  assert.throws(() => newAddress({ xpub: master.publicExtendedKey }, { index: 0 }), /account public key/, 'depth 0');
  assert.throws(() => newAddress({ xpub: `${xpub.slice(0, -1)}x` }, { index: 0 }), /invalid xpub/);
  assert.throws(() => newAddress({ xpub }, { index: 2 ** 31 }), /index must be a whole number/);
  assert.throws(() => accountXpub('hello world'), /mnemonic/);
});
