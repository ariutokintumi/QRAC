"""
QRAC local dev node: a tiny Ethereum JSON-RPC endpoint backed by an in-memory EVM (py-evm via
eth-tester), plus a static file server for the dApp — one command, no MetaMask, no testnet.

    .venv\\Scripts\\python tools/devnode.py            then open http://localhost:8545

- Serves apps/web at /, JSON-RPC at /rpc.
- 10 unlocked test accounts with test ETH (eth_sendTransaction signs for them).
- Pre-deploys the shared LMSVerifier; the dApp reads its address with `qrac_devInfo`.
- State lives in memory only and is lost when the process stops.

Test-only. Implements just the JSON-RPC subset that ethers v6 and the QRAC dApp use.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from eth_abi import encode  # noqa: E402
from eth_tester.exceptions import TransactionFailed  # noqa: E402
from eth_utils import keccak, to_checksum_address  # noqa: E402

from qrac.evm import Chain, compile_contracts  # noqa: E402

WEB_ROOT = os.path.abspath(os.path.join(HERE, "..", "apps", "web"))
LOCK = threading.Lock()


class RpcError(Exception):
    def __init__(self, code: int, message: str, data: str | None = None):
        super().__init__(message)
        self.code, self.message, self.data = code, message, data


def camel(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(p.capitalize() for p in rest)


def to_rpc(value, key: str | None = None):
    """eth-tester objects (snake_case, ints, bytes) -> JSON-RPC (camelCase, hex quantities)."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            ck = camel(k)
            out[ck] = to_rpc(v, ck)
        return out
    if isinstance(value, (list, tuple)):
        return [to_rpc(v) for v in value]
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return hex(value)
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex()
    return value


def from_hex_int(v, default=None):
    if v is None:
        return default
    return int(v, 16) if isinstance(v, str) else int(v)


def revert_payload(exc: TransactionFailed) -> str:
    """Rebuild the raw revert data from eth-tester's exception."""
    for arg in exc.args:
        if isinstance(arg, (bytes, bytearray)):
            return "0x" + bytes(arg).hex()
        if isinstance(arg, str):
            if arg.startswith(("b'", 'b"')):
                try:
                    v = ast.literal_eval(arg)
                    if isinstance(v, bytes):
                        return "0x" + v.hex()
                except (ValueError, SyntaxError):
                    pass
            # plain revert("reason") -> Error(string)
            return "0x" + (keccak(text="Error(string)")[:4] + encode(["string"], [arg])).hex()
    return "0x"


class DevNode:
    def __init__(self):
        self.chain = Chain()
        self.t = self.chain.t
        self.chain_id = self.t.backend.chain.chain_id
        c = compile_contracts("LMSVerifier.sol")
        self.verifier = self.chain.deploy(c["LMSVerifier"]["bin"])

    # ---- helpers -------------------------------------------------------------------------
    def tx_params(self, tx: dict, with_gas=True) -> dict:
        out = {"from": to_checksum_address(tx.get("from") or self.chain.accounts[0])}
        if tx.get("to"):
            out["to"] = to_checksum_address(tx["to"])
        out["value"] = from_hex_int(tx.get("value"), 0)
        data = tx.get("data") or tx.get("input") or "0x"
        out["data"] = data
        if with_gas:
            out["gas"] = from_hex_int(tx.get("gas"), 15_000_000)
        return out

    def receipt(self, h: str):
        try:
            r = self.t.get_transaction_receipt(h)
        except Exception:
            return None
        tx = self.t.get_transaction_by_hash(h)
        out = to_rpc(r)
        out.setdefault("from", tx["from"])
        out.setdefault("to", tx.get("to") or None)
        out["to"] = out.get("to") or None
        out.setdefault("logsBloom", "0x" + "00" * 256)
        out.setdefault("effectiveGasPrice", to_rpc(tx.get("gas_price", 1)))
        out.setdefault("type", "0x2")
        for log in out.get("logs", []):
            log.setdefault("removed", False)
        return out

    def tx_object(self, h: str):
        try:
            tx = self.t.get_transaction_by_hash(h)
        except Exception:
            return None
        out = to_rpc(tx)
        if "data" in out:
            out["input"] = out.pop("data")
        out["to"] = out.get("to") or None
        out.setdefault("chainId", hex(self.chain_id))
        return out

    def block(self, tag, full=False):
        if isinstance(tag, str) and tag.startswith("0x"):
            tag = int(tag, 16)
        if tag in ("pending", "safe", "finalized"):
            tag = "latest"
        try:
            b = self.t.get_block_by_number(tag, full)
        except Exception:
            return None
        out = to_rpc(b)
        out.setdefault("baseFeePerGas", "0x1")
        return out

    # ---- dispatcher ----------------------------------------------------------------------
    def handle(self, method: str, params: list):
        t = self.t
        if method == "eth_chainId":
            return hex(self.chain_id)
        if method == "net_version":
            return str(self.chain_id)
        if method == "web3_clientVersion":
            return "qrac-devnode/py-evm"
        if method == "eth_blockNumber":
            return hex(t.get_block_by_number("latest")["number"])
        if method in ("eth_accounts", "eth_requestAccounts"):
            return list(self.chain.accounts)
        if method == "eth_getBalance":
            return hex(t.get_balance(to_checksum_address(params[0])))
        if method == "eth_getCode":
            return t.get_code(to_checksum_address(params[0]))
        if method == "eth_getTransactionCount":
            return hex(t.get_nonce(to_checksum_address(params[0])))
        if method == "eth_gasPrice":
            return hex(10**9)
        if method == "eth_maxPriorityFeePerGas":
            return hex(10**9)
        if method == "eth_feeHistory":
            return {"oldestBlock": "0x0", "baseFeePerGas": ["0x1"], "gasUsedRatio": [0.0], "reward": [["0x0"]]}
        if method == "eth_getBlockByNumber":
            return self.block(params[0], bool(params[1]) if len(params) > 1 else False)
        if method == "eth_getBlockByHash":
            return to_rpc(t.get_block_by_hash(params[0], bool(params[1]) if len(params) > 1 else False))
        if method == "eth_call":
            try:
                return t.call(self.tx_params(params[0]))
            except TransactionFailed as e:
                raise RpcError(3, "execution reverted", revert_payload(e))
        if method == "eth_estimateGas":
            try:
                return hex(t.estimate_gas(self.tx_params(params[0], with_gas=False)))
            except TransactionFailed as e:
                raise RpcError(3, "execution reverted", revert_payload(e))
        if method == "eth_sendTransaction":
            return t.send_transaction(self.tx_params(params[0]))
        if method == "eth_getTransactionReceipt":
            return self.receipt(params[0])
        if method == "eth_getTransactionByHash":
            return self.tx_object(params[0])
        if method == "eth_getLogs":
            return []
        if method == "qrac_devInfo":
            return {"chainId": str(self.chain_id), "verifier": self.verifier, "accounts": list(self.chain.accounts)}
        if method == "qrac_timeTravel":
            ts = t.get_block_by_number("latest")["timestamp"] + int(params[0])
            t.time_travel(ts)
            return hex(ts)
        raise RpcError(-32601, f"method not supported by qrac-devnode: {method}")


NODE: DevNode | None = None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_ROOT, **kwargs)

    def log_message(self, fmt, *args):  # keep the console readable
        if "/rpc" not in (str(args[0]) if args else ""):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") != "/rpc":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"null")
        reqs = body if isinstance(body, list) else [body]
        out = []
        for req in reqs:
            rid = req.get("id")
            try:
                with LOCK:
                    result = NODE.handle(req.get("method"), req.get("params") or [])
                out.append({"jsonrpc": "2.0", "id": rid, "result": result})
            except RpcError as e:
                err = {"code": e.code, "message": e.message}
                if e.data is not None:
                    err["data"] = e.data
                out.append({"jsonrpc": "2.0", "id": rid, "error": err})
            except Exception as e:  # noqa: BLE001
                out.append({"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": str(e)}})
        payload = json.dumps(out if isinstance(body, list) else out[0]).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    global NODE
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8545)
    args = ap.parse_args()
    NODE = DevNode()
    print(f"QRAC devnode  chainId={NODE.chain_id}  verifier={NODE.verifier}")
    print(f"dApp: http://localhost:{args.port}/   RPC: http://localhost:{args.port}/rpc")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
