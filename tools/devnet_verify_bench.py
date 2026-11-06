"""
Measure LMSVerifier.verify() gas on any EVM chain with a READ-ONLY eth_call: no funds, no deployment, nothing stored.
The VerifyBench creation code deploys a temporary verifier inside the call, measures one verification and reverts
with Result(valid, gasUsed).

Run (from the repository root):
    .venv\\Scripts\\python tools/devnet_verify_bench.py                         (alt-mempool devnet, chain 1337)
    .venv\\Scripts\\python tools/devnet_verify_bench.py https://<any-rpc-url>
"""

import json
import os
import random
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from eth_abi import decode, encode  # noqa: E402
from eth_utils import keccak  # noqa: E402

from qrac import lms  # noqa: E402
from qrac.evm import compile_contracts  # noqa: E402

DEFAULT_RPC = "https://altmempool.forshtat.com"


def rpc(url, method, params):
    req = urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                                                       "params": params}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "qrac-bench"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def main(url):
    c = compile_contracts("LMSVerifier.sol", "test/VerifyBench.sol")
    vec = json.load(open(os.path.join(HERE, "vectors", "rfc8554.json")))["vectors"]
    sig = bytes.fromhex(vec["tc2_signature"])
    pub0 = bytes.fromhex(vec["tc2_public_key"])[4:]
    l0 = lms.lms_signature_length(6, 3)
    cases = [("RFC 8554 Test Case 2 (H10/W4)", pub0, sig[4 + l0:4 + l0 + 56], sig[4:4 + l0])]
    rnd = random.Random(42)
    key = lms.lms_keygen(6, 3, rnd.randbytes(16), rnd.randbytes(32))
    for i in range(4):
        m = rnd.randbytes(32)  # a frame-transaction signature hash is 32 bytes
        cases.append((f"random 32-byte message #{i}", key.public_key(), m, key.sign(rnd.randrange(1024), m)))

    selector = keccak(text="Result(bool,uint256)")[:4]
    print(f"chain {int(rpc(url, 'eth_chainId', [])['result'], 16)} via {url}")
    for name, pk, msg, s in cases:
        data = "0x" + c["VerifyBench"]["bin"] + encode(["bytes", "bytes", "bytes"], [pk, msg, s]).hex()
        res = rpc(url, "eth_call", [{"data": data, "gas": hex(10_000_000)}, "latest"])
        err = res.get("error") or {}
        raw = err.get("data") if isinstance(err.get("data"), str) else ""
        out = bytes.fromhex(raw[2:]) if raw.startswith("0x") else b""
        if out[:4] != selector:
            print(f"  {name}: unexpected response {str(res)[:200]}")
            continue
        valid, used = decode(["bool", "uint256"], out[4:])
        print(f"  {name}: valid={valid} verify gas={used:,}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_RPC)
