"""
Reference implementation of LMS / LM-OTS hash-based signatures (RFC 8554),
SHA-256 parameter sets only (n = m = 32).

Pure Python standard library. This is the *reference* used to produce and
cross-check test vectors for the Solidity verifier and the browser signer.
It favours clarity over speed and is not hardened against side channels.

Private-key derivation follows RFC 8554 Appendix A (pseudorandom key
generation from SEED and I).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Constants (RFC 8554, Sections 4.1, 5.1 and Appendix A)
# ---------------------------------------------------------------------------

D_PBLC = 0x8080
D_MESG = 0x8181
D_LEAF = 0x8282
D_INTR = 0x8383

N = 32  # hash output length for all SHA-256 parameter sets


@dataclass(frozen=True)
class LmotsParams:
    type_id: int
    w: int   # Winternitz parameter (bits per digit)
    p: int   # number of n-byte elements in a signature
    ls: int  # left shift applied to the checksum


@dataclass(frozen=True)
class LmsParams:
    type_id: int
    h: int   # tree height


LMOTS_TYPES = {
    1: LmotsParams(1, 1, 265, 7),   # LMOTS_SHA256_N32_W1
    2: LmotsParams(2, 2, 133, 6),   # LMOTS_SHA256_N32_W2
    3: LmotsParams(3, 4, 67, 4),    # LMOTS_SHA256_N32_W4
    4: LmotsParams(4, 8, 34, 0),    # LMOTS_SHA256_N32_W8
}

LMS_TYPES = {
    5: LmsParams(5, 5),     # LMS_SHA256_M32_H5
    6: LmsParams(6, 10),    # LMS_SHA256_M32_H10
    7: LmsParams(7, 15),    # LMS_SHA256_M32_H15
    8: LmsParams(8, 20),    # LMS_SHA256_M32_H20
    9: LmsParams(9, 25),    # LMS_SHA256_M32_H25
}

LMOTS_SHA256_N32_W4 = 3
LMS_SHA256_M32_H10 = 6


def u32(x: int) -> bytes:
    return x.to_bytes(4, "big")


def u16(x: int) -> bytes:
    return x.to_bytes(2, "big")


def u8(x: int) -> bytes:
    return x.to_bytes(1, "big")


def H(*parts: bytes) -> bytes:
    return hashlib.sha256(b"".join(parts)).digest()


class LmsError(ValueError):
    """Raised for malformed or unsupported keys / signatures."""


# ---------------------------------------------------------------------------
# LM-OTS (RFC 8554, Section 4)
# ---------------------------------------------------------------------------

def coef(S: bytes, i: int, w: int) -> int:
    return ((1 << w) - 1) & (S[(i * w) // 8] >> (8 - (w * (i % (8 // w)) + w)))


def cksm(S: bytes, w: int, ls: int) -> int:
    total = 0
    for i in range((N * 8) // w):
        total += (1 << w) - 1 - coef(S, i, w)
    return (total << ls) & 0xFFFF


def digits(Q: bytes, ots: LmotsParams) -> list[int]:
    """The p base-2^w digits signed by LM-OTS: Q followed by its checksum."""
    Qc = Q + u16(cksm(Q, ots.w, ots.ls))
    return [coef(Qc, i, ots.w) for i in range(ots.p)]


def chain(I: bytes, q: int, i: int, start: int, stop: int, tmp: bytes) -> bytes:
    """Apply the Winternitz chain function for j = start .. stop-1."""
    prefix = I + u32(q) + u16(i)
    for j in range(start, stop):
        tmp = H(prefix, u8(j), tmp)
    return tmp


def ots_private_key(ots: LmotsParams, I: bytes, q: int, seed: bytes) -> list[bytes]:
    """RFC 8554 Appendix A: x_q[i] = H(I || u32str(q) || u16str(i) || u8str(0xff) || SEED)."""
    return [H(I, u32(q), u16(i), u8(0xFF), seed) for i in range(ots.p)]


def ots_public_key_hash(ots: LmotsParams, I: bytes, q: int, x: list[bytes]) -> bytes:
    top = (1 << ots.w) - 1
    ys = [chain(I, q, i, 0, top, x[i]) for i in range(ots.p)]
    return H(I, u32(q), u16(D_PBLC), *ys)


def ots_sign(ots: LmotsParams, I: bytes, q: int, x: list[bytes], C: bytes, message: bytes) -> bytes:
    Q = H(I, u32(q), u16(D_MESG), C, message)
    a = digits(Q, ots)
    ys = [chain(I, q, i, 0, a[i], x[i]) for i in range(ots.p)]
    return u32(ots.type_id) + C + b"".join(ys)


def ots_candidate_key(sig: bytes, I: bytes, q: int, message: bytes, expected_type: int) -> bytes:
    """RFC 8554 Algorithm 4b: compute the candidate OTS public key hash Kc."""
    if len(sig) < 4:
        raise LmsError("LM-OTS signature too short")
    sigtype = int.from_bytes(sig[0:4], "big")
    if sigtype != expected_type:
        raise LmsError("LM-OTS type mismatch")
    ots = LMOTS_TYPES.get(sigtype)
    if ots is None:
        raise LmsError("unsupported LM-OTS type")
    if len(sig) != 4 + N * (ots.p + 1):
        raise LmsError("LM-OTS signature length")
    C = sig[4:4 + N]
    Q = H(I, u32(q), u16(D_MESG), C, message)
    a = digits(Q, ots)
    top = (1 << ots.w) - 1
    zs = []
    for i in range(ots.p):
        y = sig[4 + N * (i + 1):4 + N * (i + 2)]
        zs.append(chain(I, q, i, a[i], top, y))
    return H(I, u32(q), u16(D_PBLC), *zs)


# ---------------------------------------------------------------------------
# LMS (RFC 8554, Section 5)
# ---------------------------------------------------------------------------

@dataclass
class LmsPrivateKey:
    """An LMS tree built from (SEED, I). Holds the full node array T[1 .. 2^(h+1)-1]."""

    lms_type: int
    ots_type: int
    I: bytes
    seed: bytes
    T: list[bytes] = field(repr=False, default_factory=list)

    @property
    def lms(self) -> LmsParams:
        return LMS_TYPES[self.lms_type]

    @property
    def ots(self) -> LmotsParams:
        return LMOTS_TYPES[self.ots_type]

    @property
    def capacity(self) -> int:
        return 1 << self.lms.h

    @property
    def root(self) -> bytes:
        return self.T[1]

    def public_key(self) -> bytes:
        return u32(self.lms_type) + u32(self.ots_type) + self.I + self.root

    def message_randomizer(self, q: int) -> bytes:
        """Deterministic C per RFC 8554 Appendix A (u16str(0xFFFD) diversifier).

        Deterministic C is acceptable because a leaf must never sign twice; the
        signer journal enforces that.
        """
        return H(self.I, u32(q), u16(0xFFFD), u8(0xFF), self.seed)

    def sign(self, q: int, message: bytes) -> bytes:
        """Sign with leaf q. The CALLER is responsible for never reusing q."""
        if not 0 <= q < self.capacity:
            raise LmsError("leaf index out of range")
        x = ots_private_key(self.ots, self.I, q, self.seed)
        ots_sig = ots_sign(self.ots, self.I, q, x, self.message_randomizer(q), message)
        node = self.capacity + q
        path = []
        for _ in range(self.lms.h):
            path.append(self.T[node ^ 1])
            node >>= 1
        return u32(q) + ots_sig + u32(self.lms_type) + b"".join(path)


def lms_keygen(lms_type: int, ots_type: int, I: bytes, seed: bytes, progress=None) -> LmsPrivateKey:
    if lms_type not in LMS_TYPES or ots_type not in LMOTS_TYPES:
        raise LmsError("unsupported parameter set")
    if len(I) != 16 or len(seed) != N:
        raise LmsError("I must be 16 bytes and SEED 32 bytes")
    key = LmsPrivateKey(lms_type, ots_type, I, seed)
    h = key.lms.h
    leaves = 1 << h
    T = [b""] * (2 * leaves)
    for q in range(leaves):
        x = ots_private_key(key.ots, I, q, seed)
        K = ots_public_key_hash(key.ots, I, q, x)
        r = leaves + q
        T[r] = H(I, u32(r), u16(D_LEAF), K)
        if progress is not None:
            progress(q + 1, leaves)
    for r in range(leaves - 1, 0, -1):
        T[r] = H(I, u32(r), u16(D_INTR), T[2 * r], T[2 * r + 1])
    key.T = T
    return key


def lms_signature_length(lms_type: int, ots_type: int) -> int:
    return 4 + (4 + N * (LMOTS_TYPES[ots_type].p + 1)) + 4 + N * LMS_TYPES[lms_type].h


def lms_verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """RFC 8554 Algorithms 6 and 6a. Returns False for any invalid or malformed input."""
    try:
        return _lms_verify(public_key, message, signature)
    except LmsError:
        return False


def _lms_verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    if len(public_key) != 24 + N:
        raise LmsError("public key length")
    pub_type = int.from_bytes(public_key[0:4], "big")
    pub_ots = int.from_bytes(public_key[4:8], "big")
    I = public_key[8:24]
    root = public_key[24:56]
    lms = LMS_TYPES.get(pub_type)
    ots = LMOTS_TYPES.get(pub_ots)
    if lms is None or ots is None:
        raise LmsError("unsupported parameter set")
    if len(signature) != lms_signature_length(pub_type, pub_ots):
        raise LmsError("signature length")
    q = int.from_bytes(signature[0:4], "big")
    ots_len = 4 + N * (ots.p + 1)
    ots_sig = signature[4:4 + ots_len]
    sig_type = int.from_bytes(signature[4 + ots_len:8 + ots_len], "big")
    if sig_type != pub_type:
        raise LmsError("LMS type mismatch")
    if q >= (1 << lms.h):
        raise LmsError("leaf index out of range")
    path_bytes = signature[8 + ots_len:]
    Kc = ots_candidate_key(ots_sig, I, q, message, pub_ots)
    node = (1 << lms.h) + q
    tmp = H(I, u32(node), u16(D_LEAF), Kc)
    i = 0
    while node > 1:
        sibling = path_bytes[N * i:N * (i + 1)]
        if node & 1:
            tmp = H(I, u32(node >> 1), u16(D_INTR), sibling, tmp)
        else:
            tmp = H(I, u32(node >> 1), u16(D_INTR), tmp, sibling)
        node >>= 1
        i += 1
    return tmp == root


def lms_signature_leaf(signature: bytes) -> int:
    return int.from_bytes(signature[0:4], "big")


# ---------------------------------------------------------------------------
# HSS (RFC 8554, Section 6) — verification only, used for the RFC test vectors
# ---------------------------------------------------------------------------

def hss_verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    try:
        L = int.from_bytes(public_key[0:4], "big")
        nspk = int.from_bytes(signature[0:4], "big")
        if nspk + 1 != L:
            return False
        pub = public_key[4:]
        off = 4
        for _ in range(nspk):
            lms_type = int.from_bytes(pub[0:4], "big")
            ots_type = int.from_bytes(pub[4:8], "big")
            slen = lms_signature_length(lms_type, ots_type)
            sig_i = signature[off:off + slen]
            off += slen
            next_pub = signature[off:off + 24 + N]
            off += 24 + N
            if not _lms_verify(pub, next_pub, sig_i):
                return False
            pub = next_pub
        return _lms_verify(pub, message, signature[off:])
    except (LmsError, KeyError):
        return False
