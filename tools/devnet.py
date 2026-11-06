"""
QRAC on the EIP-8141 frame-transaction devnet (chain 1337) with the ERC-8421 alternative mempool. Phase 3.

    .venv\\Scripts\\python tools/devnet.py <command>

Commands (in order):
    init        create a throwaway devnet EOA key and a QRAC devnet LMS key   (state in .devnet/, git-ignored)
    fund        ask the devnet faucet (skandha_explorer_faucet) to fund the EOA
    probe       send a plain EOA frame transaction (SECP256K1): proves our codec and signature hash
    deploy      deploy LMSVerifier, the locked QRACFrameAccount implementation and QRACFrameFactory
    mint        mint the QRAC account through the factory and fund it
    send        PQ-signed frame transaction from the QRAC account: simulate, then submit
                  --route alt        standard alternative mempool (sidecar)          [default]
                  --route canonical  canonical mempool (raw tx straight to ethrex)
                  --dry-run          simulate only
    stake       the account stakes itself through its Phase 1 submit() path (ordinary transaction)
    status      addresses, balances, stake, nonce, one-time keys used

The EOA only pays for deployment and for the staking transaction. QRAC frame transactions carry NO ECDSA
signature: the account validates its own post-quantum (LMS) signature and pays its own gas.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from eth_abi import decode, encode  # noqa: E402
from eth_account import Account  # noqa: E402
from eth_utils import keccak, to_checksum_address  # noqa: E402

from qrac import authorization as auth  # noqa: E402
from qrac import frametx as ft  # noqa: E402
from qrac import lms  # noqa: E402
from qrac.evm import calldata, compile_contracts  # noqa: E402

CHAIN_ID = 1337
EL_RPC = "https://altmempool.forshtat.com"                 # ethrex (canonical rules, plain transactions)
ALT_RPC = "https://altmempoolgateway.forshtat.com/rpc"     # ERC-8421 sidecar gateway (standard alt mempool)
EXPLORER = "https://explorer.altmempool.wtf/"
STAKING_REGISTRY = "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f"
STAKE_WEI = 12 * 10**15            # 0.012 ETH, above the devnet minStake of 0.01 ETH
UNSTAKE_DELAY = 86400
RECIPIENT = "0x8943545177806ED17B9F23F0a21ee5948eCaa776"
MAX_FEE = 2 * 10**9
STATE_DIR = os.path.join(ROOT, ".devnet")
STATE = os.path.join(STATE_DIR, "state.json")

V = "vendor/hegota-support/"
SOURCES = ("LMSVerifier.sol", "QRACAccount.sol", "QRACFrameAccount.sol", "QRACFrameFactory.sol",
           V + "HegotaSupport.sol", V + "Devnet.sol", V + "Opcode.sol", V + "Params.sol",
           V + "internal/HelperCalls.sol", V + "generated/HelperCode.sol")


# ------------------------------------------------------------------------------------------------ plumbing

class RpcError(Exception):
    def __init__(self, err):
        super().__init__(err.get("message") if isinstance(err, dict) else str(err))
        self.err = err


def rpc(url, method, params=None):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode()
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json", "user-agent": "qrac"})
    out = json.loads(urllib.request.urlopen(req, timeout=120).read())
    if "error" in out:
        raise RpcError(out["error"])
    return out["result"]


def load():
    if not os.path.exists(STATE):
        sys.exit("no devnet state: run `init` first")
    return json.load(open(STATE))


def save(s):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, STATE)


def compiled():
    return compile_contracts(*SOURCES)


def eoa(s):
    return Account.from_key(s["eoa_key"])


def balance(addr):
    return int(rpc(EL_RPC, "eth_getBalance", [to_checksum_address(addr), "latest"]), 16)


def wait_receipt(h, url=EL_RPC, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            r = rpc(url, "eth_getTransactionReceipt", [h])
        except RpcError:
            r = None
        if r:
            return r
        time.sleep(2)
    raise TimeoutError(f"{h} not mined after {timeout}s")


def send_plain(s, to, data=b"", value=0, gas=None):
    """An ordinary EIP-1559 transaction from the devnet EOA (deployments, minting, funding, staking)."""
    acct = eoa(s)
    tx = {"from": acct.address, "value": hex(value), "data": "0x" + data.hex()}
    if to:
        tx["to"] = to_checksum_address(to)
    if gas is None:
        gas = int(int(rpc(EL_RPC, "eth_estimateGas", [tx]), 16) * 1.25) + 50_000
    signed = acct.sign_transaction({
        "chainId": CHAIN_ID, "type": 2, "nonce": int(rpc(EL_RPC, "eth_getTransactionCount", [acct.address, "pending"]), 16),
        "maxFeePerGas": MAX_FEE, "maxPriorityFeePerGas": 10**9, "gas": gas,
        "to": to_checksum_address(to) if to else b"", "value": value, "data": data,
    })
    raw = signed.raw_transaction if hasattr(signed, "raw_transaction") else signed.rawTransaction
    h = rpc(EL_RPC, "eth_sendRawTransaction", ["0x" + raw.hex()])
    r = wait_receipt(h)
    if r["status"] != "0x1":
        raise SystemExit(f"transaction {h} reverted")
    return h, r


def call(to, sig, types=(), args=(), out=None):
    res = rpc(EL_RPC, "eth_call", [{"to": to_checksum_address(to), "data": "0x" + calldata(sig, list(types), list(args)).hex()}, "latest"])
    return decode(out, bytes.fromhex(res[2:])) if out else res


def lms_key(s):
    k = s.get("_lms_cache")
    if k is None:
        k = lms.lms_keygen(lms.LMS_SHA256_M32_H10, lms.LMOTS_SHA256_N32_W4, bytes.fromhex(s["lms_I"]), bytes.fromhex(s["lms_seed"]))
    return k


def reserve_leaf(s, purpose):
    """Journal rule: reserve and persist the one-time key BEFORE signing; never release it."""
    leaf = s["next_leaf"]
    s["next_leaf"] = leaf + 1
    s.setdefault("journal", []).append({"leaf": leaf, "purpose": purpose, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    save(s)
    return leaf


def note(s, leaf, **kw):
    for e in s["journal"]:
        if e["leaf"] == leaf:
            e.update(kw)
    save(s)


# ------------------------------------------------------------------------------------------------ commands

def cmd_init(a):
    if os.path.exists(STATE) and not a.force:
        sys.exit("state exists (.devnet/state.json); use --force to start over")
    acct = Account.create()
    s = {"chain_id": CHAIN_ID, "eoa_key": acct.key.hex(), "eoa": acct.address,
         "lms_seed": secrets.token_bytes(32).hex(), "lms_I": secrets.token_bytes(16).hex(), "next_leaf": 0, "journal": []}
    save(s)
    print("devnet EOA (gas payer for setup only):", acct.address)
    print("QRAC devnet LMS key created (H10/W4, 1,024 one-time keys). State: .devnet/state.json (git-ignored)")


def cmd_fund(a):
    s = load()
    before = balance(s["eoa"])
    print("EOA balance:", before / 1e18, "ETH")
    if before >= 10**17 and not a.force:
        print("already funded")
        return
    print("asking the devnet faucet…", rpc(ALT_RPC, "skandha_explorer_faucet", [s["eoa"]]))
    for _ in range(60):
        time.sleep(3)
        b = balance(s["eoa"])
        if b > before:
            print("EOA balance:", b / 1e18, "ETH")
            return
    sys.exit("faucet transfer not seen yet; run `status` later")


def cmd_probe(a):
    """Plain EOA frame transaction signed with SECP256K1 over OUR sigHash: if the node accepts it, the codec matches."""
    s = load()
    acct = eoa(s)
    nonce = int(rpc(EL_RPC, "eth_getTransactionCount", [acct.address, "latest"]), 16)
    tx = ft.FrameTx(
        chain_id=CHAIN_ID, sender=acct.address, nonce_keys=[0], nonce_seq=nonce,
        frames=[ft.Frame(ft.MODE_VERIFY, ft.SCOPE_EXECUTION_AND_PAYMENT, None, 30_000),
                ft.Frame(ft.MODE_SENDER, 0, RECIPIENT, 50_000, 200_000, 10**9)],
        signatures=[ft.Signature(ft.SCHEME_SECP256K1)],
        max_priority_fee_per_gas=MAX_FEE, max_fee_per_gas=MAX_FEE)
    sig = Account._sign_hash(tx.sig_hash(), acct.key) if hasattr(Account, "_sign_hash") else acct.unsafe_sign_hash(tx.sig_hash())
    tx.signatures[0].signature = bytes([sig.v - 27 if sig.v >= 27 else sig.v]) + sig.r.to_bytes(32, "big") + sig.s.to_bytes(32, "big")
    h = rpc(ALT_RPC, "eth_sendFrameTransaction", [tx.wire()])
    print("sidecar accepted, hash", h, "| our tx hash", "0x" + tx.tx_hash().hex(), "| match:", h.lower() == "0x" + tx.tx_hash().hex())
    r = wait_receipt(h, ALT_RPC)
    print("mined in block", int(r["blockNumber"], 16), "status", r["status"])


def cmd_deploy(a):
    s = load()
    c = compiled()
    _, r = send_plain(s, None, bytes.fromhex(c["LMSVerifier"]["bin"]))
    s["verifier"] = to_checksum_address(r["contractAddress"]); save(s)
    print("LMSVerifier", s["verifier"], "gas", int(r["gasUsed"], 16))
    _, r = send_plain(s, None, bytes.fromhex(c["QRACFrameAccount"]["bin"]) + encode(["address", "bytes"], [s["verifier"], b""]))
    s["implementation"] = to_checksum_address(r["contractAddress"]); save(s)
    print("QRACFrameAccount implementation (locked)", s["implementation"], "gas", int(r["gasUsed"], 16))
    _, r = send_plain(s, None, bytes.fromhex(c["QRACFrameFactory"]["bin"]) + encode(["address"], [s["implementation"]]))
    s["factory"] = to_checksum_address(r["contractAddress"]); save(s)
    print("QRACFrameFactory", s["factory"], "gas", int(r["gasUsed"], 16))
    # keep the dApp's frame page in sync (after a devnet reset, `deploy` is the only step needed)
    path = os.path.join(ROOT, "apps", "web", "deployments.json")
    known = json.load(open(path, encoding="utf-8"))
    known.setdefault("1337", {}).update({"verifier": s["verifier"], "frameImplementation": s["implementation"],
                                         "frameFactory": s["factory"]})
    with open(path, "w", encoding="utf-8") as f:
        json.dump(known, f, indent=1)
        f.write("\n")
    print("updated apps/web/deployments.json (chain 1337)")


def cmd_mint(a):
    s = load()
    pk = lms_key(s).public_key()
    predicted = to_checksum_address(call(s["factory"], "predictAddress(bytes)", ["bytes"], [pk], ["address"])[0])
    if rpc(EL_RPC, "eth_getCode", [predicted, "latest"]) in ("0x", ""):
        h, r = send_plain(s, s["factory"], calldata("mint(bytes)", ["bytes"], [pk]))
        print("minted", predicted, "tx", h, "gas", int(r["gasUsed"], 16))
    s["account"] = predicted; save(s)
    amount = int(float(a.amount) * 1e18)
    h, r = send_plain(s, predicted, value=amount)
    print(f"funded account with {a.amount} ETH: {h}; balance {balance(predicted) / 1e18} ETH")


def frame_nonce_key(epoch, leaf):
    return ((epoch << 32) | leaf) + 1


def build_qrac_frame_tx(s, to, value, leaf, epoch):
    account = s["account"]
    tx = ft.FrameTx(
        chain_id=CHAIN_ID, sender=account, nonce_keys=[frame_nonce_key(epoch, leaf)], nonce_seq=0,
        # measured on the devnet: the VERIFY frame uses ~247k gas (PQ check ~200k + helpers); 320k leaves margin
        frames=[ft.Frame(ft.MODE_VERIFY, ft.SCOPE_EXECUTION_AND_PAYMENT, account, 320_000, 0, 0,
                         keccak(text="validateFrameTx()")[:4]),
                ft.Frame(ft.MODE_SENDER, 0, to, 60_000, 200_000, value)],
        signatures=[ft.Signature(ft.SCHEME_ARBITRARY)],
        max_priority_fee_per_gas=MAX_FEE, max_fee_per_gas=MAX_FEE)
    return tx


def cmd_send(a):
    s = load()
    account = s["account"]
    epoch = call(account, "epoch()", out=["uint64"])[0]
    leaf = reserve_leaf(s, f"frame tx {a.route}{' dry-run' if a.dry_run else ''}")
    tx = build_qrac_frame_tx(s, a.to or RECIPIENT, int(float(a.value) * 1e18), leaf, epoch)
    h = tx.sig_hash()
    message = encode(["bytes32", "bytes32"], [keccak(text="QRAC.FrameTx.v1"), h])
    onchain_msg = call(account, "frameMessage(bytes32)", ["bytes32"], [h], ["bytes"])[0]
    assert onchain_msg == message, "frameMessage mismatch"
    sig = lms_key(s).sign(leaf, message)
    tx.signatures[0].signature = sig
    note(s, leaf, sig_hash="0x" + h.hex(), tx_hash="0x" + tx.tx_hash().hex(), nonce_key=frame_nonce_key(epoch, leaf))
    print(f"one-time key #{leaf} (epoch {epoch}) -> nonce key {frame_nonce_key(epoch, leaf)}, seq 0")
    print("sigHash", "0x" + h.hex(), "| LMS signature", len(sig), "bytes | ECDSA signatures in this tx: 0")

    try:
        sim = rpc(EL_RPC, "ethrex_simulateFrameTransaction", ["0x" + tx.raw().hex(), "latest", {"trace": False}])
        print("simulation:", json.dumps(sim)[:600])
    except RpcError as e:
        print("simulation error:", e.err)
    if a.dry_run:
        return
    try:
        if a.route == "canonical":
            res = rpc(EL_RPC, "eth_sendRawTransaction", ["0x" + tx.raw().hex()])
        else:
            res = rpc(ALT_RPC, "eth_sendFrameTransaction", [tx.wire()])
    except RpcError as e:
        note(s, leaf, result="rejected", error=e.err)
        print(f"REJECTED by the {a.route} mempool:", json.dumps(e.err)[:800])
        return
    print(f"ACCEPTED by the {a.route} mempool: {res}")
    note(s, leaf, result="accepted", submitted_hash=res, wire=tx.wire())
    r = wait_receipt(res, ALT_RPC if a.route == "alt" else EL_RPC)
    print("mined in block", int(r["blockNumber"], 16), "status", r["status"], "gasUsed", int(r.get("gasUsed", "0x0"), 16))
    note(s, leaf, block=int(r["blockNumber"], 16), status=r["status"])
    print("explorer:", EXPLORER, "(search", res, ")")


def _try_submit(label, wire):
    try:
        res = rpc(ALT_RPC, "eth_sendFrameTransaction", [wire])
        print(f"  [{label}] UNEXPECTEDLY ACCEPTED: {res}")
        return False
    except RpcError as e:
        msg = e.err.get("message", str(e.err)) if isinstance(e.err, dict) else str(e.err)
        print(f"  [{label}] rejected: {msg[:260]}")
        return True


def cmd_attacks(a):
    """Attacks against the live account through the alternative mempool. Every one must be rejected."""
    s = load()
    account = s["account"]
    epoch = call(account, "epoch()", out=["uint64"])[0]
    ok = True

    # 1) replay: resubmit the exact bytes of the last accepted (mined) QRAC frame transaction
    done = [e for e in s["journal"] if e.get("result") == "accepted" and e.get("wire")]
    if done:
        ok &= _try_submit("replay of a mined tx (same one-time key / nonce key)", done[-1]["wire"])

    # 2) tamper: sign a transfer, then change the recipient and amount before submitting
    leaf = reserve_leaf(s, "attack: tamper after signing")
    tx = build_qrac_frame_tx(s, RECIPIENT, 10**12, leaf, epoch)
    tx.signatures[0].signature = lms_key(s).sign(leaf, encode(["bytes32", "bytes32"], [keccak(text="QRAC.FrameTx.v1"), tx.sig_hash()]))
    tx.frames[1].target = s["eoa"]
    tx.frames[1].value = 10**16
    ok &= _try_submit("tampered recipient and amount after signing", tx.wire())

    # 3) a correct signature, but a nonce key that does not belong to the one-time key used
    leaf = reserve_leaf(s, "attack: wrong nonce key")
    tx = build_qrac_frame_tx(s, RECIPIENT, 10**12, leaf, epoch)
    tx.nonce_keys = [frame_nonce_key(epoch, leaf) + 1000]
    tx.signatures[0].signature = lms_key(s).sign(leaf, encode(["bytes32", "bytes32"], [keccak(text="QRAC.FrameTx.v1"), tx.sig_hash()]))
    ok &= _try_submit("valid PQ signature but a nonce key not bound to its one-time key", tx.wire())

    # 4) the ECDSA attacker: the devnet EOA (think: stolen or quantum-broken key) signs a frame tx for the account
    acct = eoa(s)
    tx = build_qrac_frame_tx(s, acct.address, balance(account) // 2, 999, epoch)
    tx.signatures = [ft.Signature(ft.SCHEME_SECP256K1, bytes.fromhex(acct.address[2:]))]
    sig = acct.unsafe_sign_hash(tx.sig_hash())
    tx.signatures[0].signature = bytes([sig.v - 27 if sig.v >= 27 else sig.v]) + sig.r.to_bytes(32, "big") + sig.s.to_bytes(32, "big")
    ok &= _try_submit("ECDSA-signed frame tx draining the account (no PQ signature)", tx.wire())

    print("ALL ATTACKS REJECTED" if ok else "SOME ATTACK WAS ACCEPTED: investigate")


def cmd_stake(a):
    """The account stakes itself through its Phase 1 path: an ordinary tx calling submit() with a PQ-signed EXECUTE."""
    s = load()
    account = s["account"]
    epoch = call(account, "epoch()", out=["uint64"])[0]
    nonce = call(account, "nonce()", out=["uint64"])[0]
    payload = auth.execute_payload([auth.Call(to_checksum_address(STAKING_REGISTRY), STAKE_WEI,
                                              calldata("addStake(uint32)", ["uint32"], [UNSTAKE_DELAY]), False)])
    header = auth.Header(epoch, nonce, auth.KIND_EXECUTE)
    leaf = reserve_leaf(s, "stake via submit()")
    msg = auth.message(CHAIN_ID, account, header, leaf, payload)
    sig = lms_key(s).sign(leaf, msg)
    h, r = send_plain(s, account, calldata(f"submit({auth.HEADER_TYPE},bytes,bytes)", [auth.HEADER_TYPE, "bytes", "bytes"],
                                           [header.as_tuple(), payload, sig]))
    note(s, leaf, tx_hash=h, status=r["status"])
    print("staked through submit():", h, "gas", int(r["gasUsed"], 16))
    print_stake(account)


def print_stake(addr):
    try:
        info = rpc(EL_RPC, "eth_call", [{"to": to_checksum_address(STAKING_REGISTRY),
                                         "data": "0x" + calldata("getDepositInfo(address)", ["address"], [addr]).hex()}, "latest"])
        print("registry getDepositInfo:", info[:200])
    except RpcError as e:
        print("registry read error:", e.err)


def cmd_status(a):
    s = load()
    print("EOA", s["eoa"], balance(s["eoa"]) / 1e18, "ETH")
    for k in ("verifier", "implementation", "factory", "account"):
        if k in s:
            print(k, s[k])
    if "account" in s:
        acct = s["account"]
        print("account balance", balance(acct) / 1e18, "ETH | epoch", call(acct, "epoch()", out=["uint64"])[0],
              "| submit() nonce", call(acct, "nonce()", out=["uint64"])[0])
        print_stake(acct)
    print("one-time keys reserved:", s["next_leaf"])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init").add_argument("--force", action="store_true")
    sub.add_parser("fund").add_argument("--force", action="store_true")
    sub.add_parser("probe")
    sub.add_parser("deploy")
    m = sub.add_parser("mint"); m.add_argument("--amount", default="0.05")
    sd = sub.add_parser("send")
    sd.add_argument("--route", choices=("alt", "canonical"), default="alt")
    sd.add_argument("--dry-run", action="store_true")
    sd.add_argument("--to", default=None)
    sd.add_argument("--value", default="0.000001")
    sub.add_parser("stake")
    sub.add_parser("attacks")
    sub.add_parser("status")
    a = p.parse_args()
    globals()["cmd_" + a.cmd.replace("-", "_")](a)


if __name__ == "__main__":
    main()
