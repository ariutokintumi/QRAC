"""
Reference encoder for QRAC authorizations (must match QRACAccount.authorizationMessage byte for byte).

Signed message:
    abi.encode(bytes32 DOMAIN, uint256 chainId, address account, uint64 epoch, uint64 nonce,
               uint32 leaf, uint8 kind, address allowedSubmitter, uint64 validAfter,
               uint64 validUntil, bytes payload)
"""

from __future__ import annotations

from dataclasses import dataclass

from eth_abi import encode
from eth_utils import keccak

DOMAIN = keccak(b"QRAC.Authorization.v1")

KIND_EXECUTE = 1
KIND_ROTATE = 2
KIND_CANCEL = 3

ZERO_ADDRESS = "0x" + "00" * 20

HEADER_TYPE = "(uint64,uint64,uint8,address,uint64,uint64)"
CALL_ARRAY_TYPE = "(address,uint256,bytes,bool)[]"


@dataclass
class Header:
    epoch: int
    nonce: int
    kind: int
    allowed_submitter: str = ZERO_ADDRESS
    valid_after: int = 0
    valid_until: int = 0

    def as_tuple(self):
        return (self.epoch, self.nonce, self.kind, self.allowed_submitter, self.valid_after, self.valid_until)


@dataclass
class Call:
    target: str
    value: int = 0
    data: bytes = b""
    check_return: bool = False

    def as_tuple(self):
        return (self.target, self.value, self.data, self.check_return)


def execute_payload(calls: list[Call]) -> bytes:
    return encode([CALL_ARRAY_TYPE], [[c.as_tuple() for c in calls]])


def rotate_payload(new_public_key: bytes, next_epoch: int) -> bytes:
    return encode(["bytes", "uint64"], [new_public_key, next_epoch])


def cancel_payload() -> bytes:
    return b""


def message(chain_id: int, account: str, header: Header, leaf: int, payload: bytes) -> bytes:
    return encode(
        ["bytes32", "uint256", "address", "uint64", "uint64", "uint32", "uint8", "address", "uint64", "uint64",
         "bytes"],
        [DOMAIN, chain_id, account, header.epoch, header.nonce, leaf, header.kind, header.allowed_submitter,
         header.valid_after, header.valid_until, payload],
    )
