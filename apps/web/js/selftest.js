import { sha256 } from './sha256.js';
import * as lms from './lms.js';
import { loadWordlist, entropyToMnemonic, mnemonicToEntropy, mnemonicToSeed } from './bip39.js';
import { deriveTree } from './derive.js';
import { executePayload, rotatePayload, authorizationMessage } from './encoding.js';
import { hexlify, getBytes } from './eth.js';

const rows = document.getElementById('rows');
const summary = document.getElementById('summary');
let passed = 0, failed = 0;

function report(name, ok, detail = '') {
  ok ? passed++ : failed++;
  const tr = document.createElement('tr');
  tr.className = ok ? 'ok' : 'bad';
  tr.innerHTML = `<td>${name}</td><td>${ok ? 'PASS' : 'FAIL'}</td><td class="mono"></td>`;
  tr.lastChild.textContent = detail;
  rows.appendChild(tr);
}
const hx = (b) => hexlify(b);
const by = (h) => getBytes(h);
const eq = (a, b) => hx(a) === (typeof b === 'string' ? b.toLowerCase() : hx(b));

function treeInWorker(lmsType, otsType, I, seed) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./lms-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (ev) => {
      if (ev.data.progress !== undefined) return;
      w.terminate();
      ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data);
    };
    w.postMessage({ id: 1, lmsType, otsType, I, seed });
  });
}

async function run() {
  const fx = await (await fetch('test/fixtures.json')).json();

  // SHA-256
  let shaOk = true;
  for (const c of fx.sha256) shaOk &&= eq(sha256(by(c.data)), c.digest);
  for (const c of fx.sha256) {
    const web = new Uint8Array(await crypto.subtle.digest('SHA-256', by(c.data)));
    shaOk &&= eq(sha256(by(c.data)), web);
  }
  report('SHA-256 vs Python and WebCrypto', shaOk, `${fx.sha256.length} lengths around block boundaries`);

  // BIP-39
  const words = await loadWordlist();
  let b39 = true;
  for (const v of fx.bip39) {
    b39 &&= entropyToMnemonic(by('0x' + v.entropy), words) === v.mnemonic;
    b39 &&= eq(mnemonicToEntropy(v.mnemonic, words), '0x' + v.entropy);
    b39 &&= eq(await mnemonicToSeed(v.mnemonic, v.passphrase), '0x' + v.seed);
  }
  report('BIP-39 official vectors (24 words)', b39, `${fx.bip39.length} vectors: entropy, words, seed`);
  let badChecksum = false;
  try { mnemonicToEntropy(fx.bip39[0].mnemonic.replace(/\S+$/, 'zoo'), words); } catch { badChecksum = true; }
  report('BIP-39 rejects a wrong word / checksum', badChecksum);

  // Derivation
  const d = fx.derivation;
  const seed64 = await mnemonicToSeed(d.mnemonic);
  let dOk = eq(seed64, d.bip39Seed);
  for (const t of d.trees) {
    const r = await deriveTree(seed64, BigInt(t.chainId), t.accountIndex, t.epoch);
    dOk &&= eq(r.seed, t.seed) && eq(r.I, t.I);
  }
  report('QRAC key derivation vs Python', dOk, `${d.trees.length} (chain, account, epoch) trees`);

  // LMS small tree: full byte-for-byte
  const s = fx.lms_small;
  const Ts = lms.buildTree(s.lmsType, s.otsType, by(s.I), by(s.seed));
  const pkS = lms.publicKey(s.lmsType, s.otsType, by(s.I), Ts);
  let sOk = eq(pkS, s.publicKey);
  for (const sg of s.signatures) {
    const sig = lms.sign({ lmsType: s.lmsType, otsType: s.otsType, I: by(s.I), seed: by(s.seed), T: Ts }, sg.leaf,
      by(sg.message));
    sOk &&= eq(sig, sg.signature) && lms.verify(pkS, by(sg.message), sig);
  }
  report('LMS H5/W4: public key and signatures identical to Python', sOk, `${s.signatures.length} signatures`);
  const bad = by(s.signatures[1].signature); bad[100] ^= 1;
  report('LMS verify rejects a modified signature', !lms.verify(pkS, by(s.signatures[1].message), bad));

  // LMS H10 in a worker (production parameter set) + timing
  const b = fx.lms_h10;
  const r10 = await treeInWorker(b.lmsType, b.otsType, by(b.I), by(b.seed));
  const pk10 = lms.publicKey(b.lmsType, b.otsType, by(b.I), r10.T);
  const t0 = performance.now();
  const sig10 = lms.sign({ lmsType: 6, otsType: 3, I: by(b.I), seed: by(b.seed), T: r10.T }, b.signature.leaf,
    by(b.signature.message));
  const signMs = performance.now() - t0;
  report('LMS H10/W4 (1,024 keys) built in a Web Worker matches Python',
    eq(pk10, b.publicKey) && eq(sig10, b.signature.signature),
    `key tree ${(r10.ms / 1000).toFixed(2)} s, one signature ${signMs.toFixed(1)} ms`);

  // RFC 8554 Test Case 2 top tree
  const rfc = fx.rfc8554_tc2_top;
  const rr = await treeInWorker(6, 3, by(rfc.I), by(rfc.seed));
  const rpk = lms.publicKey(6, 3, by(rfc.I), rr.T);
  const rsig = lms.sign({ lmsType: 6, otsType: 3, I: by(rfc.I), seed: by(rfc.seed), T: rr.T }, 3, by(rfc.message));
  report('RFC 8554 Test Case 2: key tree and signature reproduced byte for byte',
    eq(rpk, rfc.publicKey) && eq(rsig, rfc.signature) && lms.verify(rpk, by(rfc.message), rsig));

  // Authorization encoding
  const a = fx.authorization;
  const payload = executePayload(a.calls);
  const msg = authorizationMessage(BigInt(a.chainId), a.account, a.header, a.leaf, payload);
  report('Authorization payload and message identical to Python', payload === a.payload && msg === a.message,
    `${getBytes(msg).length} bytes`);
  report('Rotation payload identical to Python', rotatePayload(fx.lms_small.publicKey, 3) === a.rotatePayload);

  summary.textContent = failed === 0 ? `All ${passed} checks passed` : `${failed} of ${passed + failed} checks FAILED`;
  summary.className = 'pill ' + (failed === 0 ? 'ok' : 'bad');
  window.QRAC_SELFTEST = { passed, failed };
}

run().catch((e) => {
  report('Self-test crashed', false, String(e && e.stack ? e.stack : e));
  summary.textContent = 'Self-test crashed';
  summary.className = 'pill bad';
  window.QRAC_SELFTEST = { passed, failed: failed || 1, error: String(e) };
});
