"""
Minimal local EVM harness: compile with solc (py-solc-x), run on py-evm (eth-tester).
Test-only; not needed to use QRAC.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import solcx
from eth_abi import decode, encode
from eth_tester import EthereumTester, PyEVMBackend
from eth_utils import function_signature_to_4byte_selector, to_checksum_address

SOLC_VERSION = "0.8.28"
EVM_VERSION = "cancun"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONTRACTS = os.path.join(ROOT, "contracts")


def compile_contracts(*relative_paths: str) -> dict:
    """Compile the given files (relative to contracts/). Returns {ContractName: {abi, bin}}."""
    solcx.install_solc(SOLC_VERSION)
    # Pass contents directly (the repo path contains spaces and '&', which solc's URL loader rejects).
    # Imports between contracts resolve by these relative keys, so list every file needed.
    sources = {}
    for p in relative_paths:
        with open(os.path.join(CONTRACTS, p), encoding="utf-8") as f:
            sources[p] = {"content": f.read()}
    out = solcx.compile_standard(
        {
            "language": "Solidity",
            "sources": sources,
            "settings": {
                "optimizer": {"enabled": True, "runs": 200},
                "evmVersion": EVM_VERSION,
                "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]}},
            },
        },
        solc_version=SOLC_VERSION,
    )
    result = {}
    for file_contracts in out["contracts"].values():
        for name, c in file_contracts.items():
            result[name] = {
                "abi": c["abi"],
                "bin": c["evm"]["bytecode"]["object"],
                "runtime_size": len(c["evm"]["deployedBytecode"]["object"]) // 2,
            }
    return result


def selector(signature: str) -> bytes:
    return function_signature_to_4byte_selector(signature)


def calldata(signature: str, types: list[str], args: list) -> bytes:
    return selector(signature) + encode(types, args)


@dataclass
class Receipt:
    status: int
    gas_used: int
    contract_address: str | None
    logs: list


class Chain:
    def __init__(self):
        self.t = EthereumTester(PyEVMBackend())
        self.accounts = self.t.get_accounts()

    def deploy(self, bytecode_hex: str, ctor_types: list[str] | None = None, ctor_args: list | None = None,
               sender: str | None = None, value: int = 0) -> str:
        data = bytes.fromhex(bytecode_hex)
        if ctor_types:
            data += encode(ctor_types, ctor_args)
        r = self.transact(None, data, sender=sender, value=value)
        if r.status != 1:
            raise RuntimeError("deployment failed")
        return r.contract_address

    def transact(self, to: str | None, data: bytes, sender: str | None = None, value: int = 0,
                 gas: int = 15_000_000) -> Receipt:
        tx = {"from": sender or self.accounts[0], "gas": gas, "value": value, "data": "0x" + data.hex()}
        if to is not None:
            tx["to"] = to
        h = self.t.send_transaction(tx)
        rc = self.t.get_transaction_receipt(h)
        return Receipt(rc.get("status", 1), rc["gas_used"], rc.get("contract_address"), rc.get("logs", []))

    def call(self, to: str, data: bytes, sender: str | None = None) -> bytes:
        tx = {"from": sender or self.accounts[0], "to": to, "gas": 15_000_000, "data": "0x" + data.hex()}
        ret = self.t.call(tx)
        return bytes.fromhex(ret[2:]) if isinstance(ret, str) else bytes(ret)

    def balance(self, addr: str) -> int:
        return self.t.get_balance(to_checksum_address(addr))


def decode_output(types: list[str], data: bytes):
    return decode(types, data)
