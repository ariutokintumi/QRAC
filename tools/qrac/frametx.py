"""
EIP-8141 frame transactions, as implemented by the public alt-mempool devnet (chain 1337, ethrex `eip8141-tracer`
+ the ERC-8421 sidecar). Python port of the reference codec in `@forshtat/hegota-support` (profile
`ethrex-eip8141-tracer`) and the sidecar's `FrameTxService/codec.ts`.

    raw tx   = 0x06 || rlp([chainId, nonceKeys, nonceSeq, sender, frames, signatures, fees,
                            blobVersionedHashes, recentRootReferences])
    frame    = [mode, flags, target, [executionGas, stateGas], value, data]      (target empty = tx.sender)
    sig      = [scheme, signer, msg, signature]
    fees     = [maxPriorityFeePerGas, maxFeePerGas, maxFeePerBlobGas]
    sigHash  = keccak256(raw tx with the `signature` bytes of every empty-`msg` entry set to empty)
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import rlp
from eth_utils import keccak, to_checksum_address

TX_TYPE = 0x06

MODE_DEFAULT, MODE_VERIFY, MODE_SENDER = 0, 1, 2
SCOPE_NONE, SCOPE_PAYMENT, SCOPE_EXECUTION, SCOPE_EXECUTION_AND_PAYMENT = 0, 1, 2, 3
FLAG_ATOMIC_BATCH = 0x4
SCHEME_ARBITRARY, SCHEME_SECP256K1, SCHEME_P256 = 0, 1, 2


def _int(n: int) -> bytes:
    if n < 0:
        raise ValueError("negative integer")
    return b"" if n == 0 else n.to_bytes((n.bit_length() + 7) // 8, "big")


def _hex_bytes(h: str | bytes | None) -> bytes:
    if h is None:
        return b""
    if isinstance(h, (bytes, bytearray)):
        return bytes(h)
    return bytes.fromhex(h[2:] if h.startswith("0x") else h)


def _q(n: int) -> str:
    return hex(n)


@dataclass
class Frame:
    mode: int
    flags: int = 0
    target: str | None = None  # None = tx.sender
    execution_gas: int = 0
    state_gas: int = 0
    value: int = 0
    data: bytes = b""

    def rlp(self):
        return [_int(self.mode), _int(self.flags), _hex_bytes(self.target),
                [_int(self.execution_gas), _int(self.state_gas)], _int(self.value), bytes(self.data)]

    def wire(self):
        return {"mode": self.mode, "flags": self.flags,
                "target": to_checksum_address(self.target) if self.target else None,
                "limits": {"execution": _q(self.execution_gas), "state": _q(self.state_gas)},
                "value": _q(self.value), "data": "0x" + bytes(self.data).hex()}


@dataclass
class Signature:
    scheme: int
    signer: bytes = b""  # empty = tx.sender
    msg: bytes = b""  # empty = the transaction's signature hash
    signature: bytes = b""

    def rlp(self):
        return [_int(self.scheme), bytes(self.signer), bytes(self.msg), bytes(self.signature)]

    def wire(self):
        return {"scheme": self.scheme, "signer": "0x" + self.signer.hex(), "msg": "0x" + self.msg.hex(),
                "signature": "0x" + self.signature.hex()}


@dataclass
class FrameTx:
    chain_id: int
    sender: str
    frames: list[Frame]
    signatures: list[Signature]
    nonce_keys: list[int] = field(default_factory=lambda: [0])
    nonce_seq: int = 0
    max_priority_fee_per_gas: int = 0
    max_fee_per_gas: int = 0
    max_fee_per_blob_gas: int = 0
    blob_versioned_hashes: list[bytes] = field(default_factory=list)
    recent_root_references: list = field(default_factory=list)  # not used by QRAC

    def rlp_payload(self):
        return [
            _int(self.chain_id),
            [_int(k) for k in self.nonce_keys],
            _int(self.nonce_seq),
            _hex_bytes(self.sender),
            [f.rlp() for f in self.frames],
            [s.rlp() for s in self.signatures],
            [_int(self.max_priority_fee_per_gas), _int(self.max_fee_per_gas), _int(self.max_fee_per_blob_gas)],
            list(self.blob_versioned_hashes),
            [],
        ]

    def raw(self) -> bytes:
        return bytes([TX_TYPE]) + rlp.encode(self.rlp_payload())

    def sig_hash(self) -> bytes:
        elided = replace(self, signatures=[replace(s, signature=b"") if s.msg == b"" else s for s in self.signatures])
        return keccak(elided.raw())

    def tx_hash(self) -> bytes:
        return keccak(self.raw())

    def wire(self) -> dict:
        """The JSON shape the sidecar's eth_sendFrameTransaction takes."""
        return {
            "chainId": _q(self.chain_id),
            "nonceKeys": [_q(k) for k in self.nonce_keys],
            "nonceSeq": _q(self.nonce_seq),
            "sender": to_checksum_address(self.sender),
            "frames": [f.wire() for f in self.frames],
            "signatures": [s.wire() for s in self.signatures],
            "fees": {"maxPriorityFeePerGas": _q(self.max_priority_fee_per_gas),
                     "maxFeePerGas": _q(self.max_fee_per_gas),
                     "maxFeePerBlobGas": _q(self.max_fee_per_blob_gas)},
            "blobVersionedHashes": ["0x" + h.hex() for h in self.blob_versioned_hashes],
            "recentRootReferences": [],
        }


def decode_raw(raw: bytes) -> list:
    """Decoded RLP items of a raw frame transaction (for round-trip checks)."""
    if raw[0] != TX_TYPE:
        raise ValueError("not a type 0x06 transaction")
    return rlp.decode(raw[1:])
