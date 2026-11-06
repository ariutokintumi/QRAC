"""
Compile the contracts and write ABI + bytecode for the dApp to apps/web/artifacts/*.json
(lets the dApp deploy the verifier and accounts from the browser; Remix remains an alternative).

Run (from the repository root):  .venv\\Scripts\\python tools/build_web_artifacts.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from qrac.evm import EVM_VERSION, SOLC_VERSION, compile_contracts  # noqa: E402

OUT_DIR = os.path.join(HERE, "..", "apps", "web", "artifacts")


def main():
    compiled = compile_contracts("LMSVerifier.sol", "QRACAccount.sol")
    os.makedirs(OUT_DIR, exist_ok=True)
    for name in ("LMSVerifier", "QRACAccount"):
        c = compiled[name]
        out = {
            "contractName": name,
            "compiler": {"solc": SOLC_VERSION, "evmVersion": EVM_VERSION, "optimizer": {"enabled": True, "runs": 200}},
            "abi": c["abi"],
            "bytecode": "0x" + c["bin"],
        }
        path = os.path.join(OUT_DIR, name + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)
            f.write("\n")
        print("wrote", os.path.normpath(path))


if __name__ == "__main__":
    main()
