// QRAC key derivation v1: one independent LMS tree per (chainId, accountIndex, epoch).
//
//   ctx      = u64be(chainId) || u32be(accountIndex) || u32be(epoch)
//   treeSeed = HMAC-SHA256(key = bip39Seed, "QRAC/v1/lms-seed" || 0x00 || ctx)          (32 bytes)
//   I        = HMAC-SHA256(key = bip39Seed, "QRAC/v1/lms-I"    || 0x00 || ctx)[0:16]    (16 bytes)
//
// Every account on every chain, and every epoch after a rotation, gets its own tree, so a
// one-time key is never shared between accounts. Mirrors tools/qrac/derive.py.

function ctxBytes(label, chainId, accountIndex, epoch) {
  const tag = new TextEncoder().encode('QRAC/v1/' + label);
  const out = new Uint8Array(tag.length + 1 + 16);
  out.set(tag, 0);
  out[tag.length] = 0;
  const v = new DataView(out.buffer, tag.length + 1);
  v.setBigUint64(0, BigInt(chainId));
  v.setUint32(8, accountIndex);
  v.setUint32(12, epoch);
  return out;
}

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

export async function deriveTree(bip39Seed, chainId, accountIndex, epoch) {
  const seed = await hmacSha256(bip39Seed, ctxBytes('lms-seed', chainId, accountIndex, epoch));
  const I = (await hmacSha256(bip39Seed, ctxBytes('lms-I', chainId, accountIndex, epoch))).slice(0, 16);
  return { seed, I };
}
