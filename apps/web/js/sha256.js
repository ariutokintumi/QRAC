// Synchronous SHA-256 (FIPS 180-4) for the LMS hot loops.
// WebCrypto's digest() is asynchronous and far too slow for ~1M small hashes per key tree.
// Verified against WebCrypto and the Python reference in the self-test page (test.html).

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const W = new Uint32Array(64);
const S = new Uint32Array(8);

function compress(state, buf, off) {
  for (let t = 0; t < 16; t++) {
    const o = off + 4 * t;
    W[t] = (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
  }
  for (let t = 16; t < 64; t++) {
    const w15 = W[t - 15], w2 = W[t - 2];
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let t = 0; t < 64; t++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[t] + W[t]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
}

let pad = new Uint8Array(128);

/**
 * SHA-256 of data[0 .. len) written into out[outOff .. outOff+32).
 * `out` may alias `data` (the input is fully consumed before the output is written).
 */
export function sha256Into(data, len, out, outOff = 0) {
  S[0] = 0x6a09e667; S[1] = 0xbb67ae85; S[2] = 0x3c6ef372; S[3] = 0xa54ff53a;
  S[4] = 0x510e527f; S[5] = 0x9b05688c; S[6] = 0x1f83d9ab; S[7] = 0x5be0cd19;
  const full = len - (len % 64);
  for (let off = 0; off < full; off += 64) compress(S, data, off);
  const rem = len - full;
  const tailLen = rem < 56 ? 64 : 128;
  if (pad.length < tailLen) pad = new Uint8Array(tailLen);
  pad.fill(0, 0, tailLen);
  for (let i = 0; i < rem; i++) pad[i] = data[full + i];
  pad[rem] = 0x80;
  const bitLen = len * 8;
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  pad[tailLen - 8] = hi >>> 24; pad[tailLen - 7] = hi >>> 16; pad[tailLen - 6] = hi >>> 8; pad[tailLen - 5] = hi;
  pad[tailLen - 4] = lo >>> 24; pad[tailLen - 3] = lo >>> 16; pad[tailLen - 2] = lo >>> 8; pad[tailLen - 1] = lo;
  compress(S, pad, 0);
  if (tailLen === 128) compress(S, pad, 64);
  for (let i = 0; i < 8; i++) {
    const v = S[i];
    out[outOff + 4 * i] = v >>> 24; out[outOff + 4 * i + 1] = v >>> 16;
    out[outOff + 4 * i + 2] = v >>> 8; out[outOff + 4 * i + 3] = v;
  }
  return out;
}

/** SHA-256 of a Uint8Array; returns a new 32-byte Uint8Array. */
export function sha256(data) {
  return sha256Into(data, data.length, new Uint8Array(32), 0);
}
