"""
BIP-39 (24 words) and QRAC key derivation v1. Python reference for apps/web/js/bip39.js and derive.js.

    ctx      = u64be(chainId) || u32be(accountIndex) || u32be(epoch)
    treeSeed = HMAC-SHA256(key = bip39Seed, "QRAC/v1/lms-seed" || 0x00 || ctx)
    I        = HMAC-SHA256(key = bip39Seed, "QRAC/v1/lms-I"    || 0x00 || ctx)[0:16]
"""

from __future__ import annotations

import hashlib
import hmac
import os
import unicodedata

WORDLIST_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", "assets", "bip39-english.txt")


def load_wordlist() -> list[str]:
    with open(WORDLIST_PATH, encoding="utf-8") as f:
        words = [w.strip() for w in f if w.strip()]
    assert len(words) == 2048
    return words


def _nfkd(s: str) -> str:
    return unicodedata.normalize("NFKD", s)


def entropy_to_mnemonic(entropy: bytes, words: list[str]) -> str:
    if len(entropy) != 32:
        raise ValueError("QRAC uses 256-bit entropy (24 words)")
    bits = int.from_bytes(entropy + hashlib.sha256(entropy).digest()[:1], "big")
    return " ".join(words[(bits >> (11 * (23 - i))) & 0x7FF] for i in range(24))


def mnemonic_to_seed(mnemonic: str, passphrase: str = "") -> bytes:
    m = " ".join(_nfkd(mnemonic).strip().lower().split())
    return hashlib.pbkdf2_hmac("sha512", m.encode(), ("mnemonic" + _nfkd(passphrase)).encode(), 2048)


def _ctx(label: str, chain_id: int, account_index: int, epoch: int) -> bytes:
    return (("QRAC/v1/" + label).encode() + b"\x00" + chain_id.to_bytes(8, "big")
            + account_index.to_bytes(4, "big") + epoch.to_bytes(4, "big"))


def derive_tree(bip39_seed: bytes, chain_id: int, account_index: int, epoch: int) -> tuple[bytes, bytes]:
    """Returns (treeSeed 32 bytes, I 16 bytes)."""
    seed = hmac.new(bip39_seed, _ctx("lms-seed", chain_id, account_index, epoch), hashlib.sha256).digest()
    ident = hmac.new(bip39_seed, _ctx("lms-I", chain_id, account_index, epoch), hashlib.sha256).digest()[:16]
    return seed, ident
