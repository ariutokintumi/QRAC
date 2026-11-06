// BIP-39: 24 words = 256 bits of fresh entropy + 8-bit checksum. Standard mnemonic-to-seed
// (PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic" + passphrase). QRAC uses an empty passphrase.
// Wordlist: assets/bip39-english.txt (official list, SHA-256 2f5eed53...dbda).

import { sha256 } from './sha256.js';

let WORDS = null;

export async function loadWordlist() {
  if (WORDS) return WORDS;
  const text = await (await fetch(new URL('../assets/bip39-english.txt', import.meta.url))).text();
  const words = text.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
  if (words.length !== 2048) throw new Error('BIP-39 wordlist must have 2048 words');
  WORDS = words;
  return WORDS;
}

export function entropyToMnemonic(entropy, words) {
  if (entropy.length !== 32) throw new Error('QRAC uses 256-bit entropy (24 words)');
  const checksum = sha256(entropy)[0]; // 256 / 32 = 8 checksum bits
  const bytes = new Uint8Array(33);
  bytes.set(entropy, 0);
  bytes[32] = checksum;
  const out = [];
  for (let i = 0; i < 24; i++) {
    let idx = 0;
    for (let b = 0; b < 11; b++) {
      const bit = i * 11 + b;
      idx = (idx << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    out.push(words[idx]);
  }
  return out.join(' ');
}

/** Returns the 32-byte entropy, or throws if words, count or checksum are invalid. */
export function mnemonicToEntropy(mnemonic, words) {
  const list = normalizeMnemonic(mnemonic).split(' ');
  if (list.length !== 24) throw new Error(`expected 24 words, got ${list.length}`);
  const bytes = new Uint8Array(33);
  list.forEach((w, i) => {
    const idx = words.indexOf(w);
    if (idx < 0) throw new Error(`unknown word: "${w}"`);
    for (let b = 0; b < 11; b++) {
      if ((idx >> (10 - b)) & 1) {
        const bit = i * 11 + b;
        bytes[bit >> 3] |= 1 << (7 - (bit & 7));
      }
    }
  });
  const entropy = bytes.slice(0, 32);
  if (sha256(entropy)[0] !== bytes[32]) throw new Error('invalid checksum (a word is wrong or out of order)');
  return entropy;
}

export function generateMnemonic(words) {
  const entropy = new Uint8Array(32);
  crypto.getRandomValues(entropy);
  return entropyToMnemonic(entropy, words);
}

export function normalizeMnemonic(m) {
  return m.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');
}

/** 64-byte BIP-39 seed. */
export async function mnemonicToSeed(mnemonic, passphrase = '') {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(normalizeMnemonic(mnemonic)), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-512', salt: enc.encode('mnemonic' + passphrase.normalize('NFKD')), iterations: 2048 },
    key,
    512,
  );
  return new Uint8Array(bits);
}
