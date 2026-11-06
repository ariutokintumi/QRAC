// LMS / LM-OTS (RFC 8554), SHA-256 parameter sets (n = m = 32).
// Browser port of tools/qrac/lms.py; checked byte-for-byte against it in test.html.
// Private keys are derived from (SEED, I) per RFC 8554 Appendix A; C is deterministic (Appendix A).

import { sha256Into, sha256 } from './sha256.js';

export const D_PBLC = 0x8080;
export const D_MESG = 0x8181;
export const D_LEAF = 0x8282;
export const D_INTR = 0x8383;

export const LMOTS = {
  1: { w: 1, p: 265, ls: 7 },
  2: { w: 2, p: 133, ls: 6 },
  3: { w: 4, p: 67, ls: 4 },
  4: { w: 8, p: 34, ls: 0 },
};
export const LMS_H = { 5: 5, 6: 10, 7: 15, 8: 20, 9: 25 };

export const LMS_SHA256_M32_H10 = 6;
export const LMOTS_SHA256_N32_W4 = 3;

function setU32(buf, off, v) {
  buf[off] = v >>> 24; buf[off + 1] = v >>> 16; buf[off + 2] = v >>> 8; buf[off + 3] = v;
}
function setU16(buf, off, v) {
  buf[off] = v >>> 8; buf[off + 1] = v;
}
function getU32(buf, off) {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function coef(S, i, w) {
  return ((1 << w) - 1) & (S[(i * w) >> 3] >> (8 - (w * (i % (8 / w)) + w)));
}

/** Q || u16str(Cksm(Q)) as a 34-byte array. */
function digitsSource(Q, ots) {
  let sum = 0;
  const top = (1 << ots.w) - 1;
  for (let i = 0; i < 256 / ots.w; i++) sum += top - coef(Q, i, ots.w);
  sum = (sum << ots.ls) & 0xffff;
  const S = new Uint8Array(34);
  S.set(Q, 0);
  S[32] = sum >>> 8; S[33] = sum & 0xff;
  return S;
}

export function signatureLength(lmsType, otsType) {
  const ots = LMOTS[otsType], h = LMS_H[lmsType];
  if (!ots || !h) return 0;
  return 12 + 32 * (ots.p + 1) + 32 * h;
}

/**
 * Build the full LMS tree. Returns T as one Uint8Array: node r (1 .. 2^(h+1)-1) at offset 32*r.
 * About (2^h * p * 2^w) SHA-256 compressions: ~1.1M for H10/W4. Run it in a Web Worker.
 */
export function buildTree(lmsType, otsType, I, seed, onProgress) {
  const ots = LMOTS[otsType], h = LMS_H[lmsType];
  if (!ots || !h) throw new Error('unsupported LMS parameter set');
  if (I.length !== 16 || seed.length !== 32) throw new Error('I must be 16 bytes, SEED 32 bytes');
  const leaves = 1 << h, top = (1 << ots.w) - 1, p = ots.p;
  const T = new Uint8Array(64 * leaves);

  const buf = new Uint8Array(55);   // I | q | u16 i | u8 j | tmp
  const xbuf = new Uint8Array(55);  // I | q | u16 i | 0xff | SEED   (private element x_q[i])
  const kbuf = new Uint8Array(22 + 32 * p); // I | q | D_PBLC | y[0..p-1]
  const lbuf = new Uint8Array(54);  // I | u32 r | D_LEAF | K
  buf.set(I, 0); xbuf.set(I, 0); xbuf[22] = 0xff; xbuf.set(seed, 23);
  kbuf.set(I, 0); setU16(kbuf, 20, D_PBLC);
  lbuf.set(I, 0); setU16(lbuf, 20, D_LEAF);

  for (let q = 0; q < leaves; q++) {
    setU32(buf, 16, q); setU32(xbuf, 16, q); setU32(kbuf, 16, q);
    for (let i = 0; i < p; i++) {
      setU16(xbuf, 20, i);
      sha256Into(xbuf, 55, buf, 23); // tmp = x_q[i]
      setU16(buf, 20, i);
      for (let j = 0; j < top; j++) {
        buf[22] = j;
        sha256Into(buf, 55, buf, 23);
      }
      kbuf.set(buf.subarray(23, 55), 22 + 32 * i);
    }
    sha256Into(kbuf, kbuf.length, lbuf, 22); // K = OTS public key hash
    const r = leaves + q;
    setU32(lbuf, 16, r);
    sha256Into(lbuf, 54, T, 32 * r);
    if (onProgress && ((q + 1) % 16 === 0 || q + 1 === leaves)) onProgress(q + 1, leaves);
  }
  const ibuf = new Uint8Array(86); // I | u32 r | D_INTR | left | right
  ibuf.set(I, 0); setU16(ibuf, 20, D_INTR);
  for (let r = leaves - 1; r >= 1; r--) {
    setU32(ibuf, 16, r);
    ibuf.set(T.subarray(64 * r, 64 * r + 64), 22); // T[2r] || T[2r+1]
    sha256Into(ibuf, 86, T, 32 * r);
  }
  return T;
}

export function publicKey(lmsType, otsType, I, T) {
  const pk = new Uint8Array(56);
  setU32(pk, 0, lmsType); setU32(pk, 4, otsType);
  pk.set(I, 8); pk.set(T.subarray(32, 64), 24);
  return pk;
}

/** Sign `message` with leaf q. The CALLER must guarantee q is never used twice. */
export function sign({ lmsType, otsType, I, seed, T }, q, message) {
  const ots = LMOTS[otsType], h = LMS_H[lmsType];
  const leaves = 1 << h, p = ots.p;
  if (!(q >= 0 && q < leaves)) throw new Error('leaf index out of range');

  const tmp = new Uint8Array(55);
  tmp.set(I, 0); setU32(tmp, 16, q); setU16(tmp, 20, 0xfffd); tmp[22] = 0xff; tmp.set(seed, 23);
  const C = sha256(tmp);

  const mbuf = new Uint8Array(54 + message.length);
  mbuf.set(I, 0); setU32(mbuf, 16, q); setU16(mbuf, 20, D_MESG); mbuf.set(C, 22); mbuf.set(message, 54);
  const S = digitsSource(sha256(mbuf), ots);

  const sig = new Uint8Array(signatureLength(lmsType, otsType));
  setU32(sig, 0, q); setU32(sig, 4, otsType); sig.set(C, 8);
  const buf = new Uint8Array(55), xbuf = new Uint8Array(55);
  buf.set(I, 0); setU32(buf, 16, q);
  xbuf.set(I, 0); setU32(xbuf, 16, q); xbuf[22] = 0xff; xbuf.set(seed, 23);
  for (let i = 0; i < p; i++) {
    setU16(xbuf, 20, i);
    sha256Into(xbuf, 55, buf, 23);
    setU16(buf, 20, i);
    const a = coef(S, i, ots.w);
    for (let j = 0; j < a; j++) {
      buf[22] = j;
      sha256Into(buf, 55, buf, 23);
    }
    sig.set(buf.subarray(23, 55), 40 + 32 * i);
  }
  const otsEnd = 8 + 32 * (p + 1);
  setU32(sig, otsEnd, lmsType);
  let node = leaves + q;
  for (let k = 0; k < h; k++) {
    const sib = node ^ 1;
    sig.set(T.subarray(32 * sib, 32 * sib + 32), otsEnd + 4 + 32 * k);
    node >>= 1;
  }
  return sig;
}

export function leafOf(signature) {
  return getU32(signature, 0);
}

/** RFC 8554 Algorithms 6 / 6a. Returns false for any malformed input. */
export function verify(pub, message, sig) {
  if (pub.length !== 56) return false;
  const lmsType = getU32(pub, 0), otsType = getU32(pub, 4);
  const ots = LMOTS[otsType], h = LMS_H[lmsType];
  if (!ots || !h) return false;
  if (sig.length !== signatureLength(lmsType, otsType)) return false;
  const q = getU32(sig, 0), p = ots.p, top = (1 << ots.w) - 1;
  const otsEnd = 8 + 32 * (p + 1);
  if (q >= (1 << h) || getU32(sig, 4) !== otsType || getU32(sig, otsEnd) !== lmsType) return false;
  const I = pub.subarray(8, 24);

  const mbuf = new Uint8Array(54 + message.length);
  mbuf.set(I, 0); setU32(mbuf, 16, q); setU16(mbuf, 20, D_MESG); mbuf.set(sig.subarray(8, 40), 22);
  mbuf.set(message, 54);
  const S = digitsSource(sha256(mbuf), ots);

  const buf = new Uint8Array(55);
  const kbuf = new Uint8Array(22 + 32 * p);
  buf.set(I, 0); setU32(buf, 16, q);
  kbuf.set(I, 0); setU32(kbuf, 16, q); setU16(kbuf, 20, D_PBLC);
  for (let i = 0; i < p; i++) {
    setU16(buf, 20, i);
    buf.set(sig.subarray(40 + 32 * i, 72 + 32 * i), 23);
    for (let j = coef(S, i, ots.w); j < top; j++) {
      buf[22] = j;
      sha256Into(buf, 55, buf, 23);
    }
    kbuf.set(buf.subarray(23, 55), 22 + 32 * i);
  }
  const lbuf = new Uint8Array(54);
  let node = (1 << h) + q;
  lbuf.set(I, 0); setU32(lbuf, 16, node); setU16(lbuf, 20, D_LEAF);
  sha256Into(kbuf, kbuf.length, lbuf, 22);
  let tmp = sha256(lbuf);
  const ibuf = new Uint8Array(86);
  ibuf.set(I, 0); setU16(ibuf, 20, D_INTR);
  for (let k = 0; node > 1; k++) {
    const sib = sig.subarray(otsEnd + 4 + 32 * k, otsEnd + 36 + 32 * k);
    setU32(ibuf, 16, node >> 1);
    if (node & 1) { ibuf.set(sib, 22); ibuf.set(tmp, 54); } else { ibuf.set(tmp, 22); ibuf.set(sib, 54); }
    tmp = sha256(ibuf);
    node >>= 1;
  }
  for (let i = 0; i < 32; i++) if (tmp[i] !== pub[24 + i]) return false;
  return true;
}
