"""
QRACAccount behaviour tests on a local in-memory EVM, with REAL LMS signatures and the REAL verifier
(no mocked authorization).

Account roles used in these tests:
    deployer  (accounts[0]) deploys and funds the QRAC account. Treated as a COMPROMISED EOA:
              the attacker knows its private key (simulated ECDSA compromise, no quantum hardware).
    relayer   (accounts[1]) an unrelated EOA that pays gas to deliver authorizations.
    recipient (accounts[2]) receives funds.
    other     (accounts[3]) any other EOA.
"""

import ast
import os
import random
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from eth_abi import encode  # noqa: E402
from eth_utils import keccak, to_checksum_address  # noqa: E402

from qrac import authorization as auth  # noqa: E402
from qrac import lms  # noqa: E402
from qrac.evm import Chain, calldata, compile_contracts, decode_output  # noqa: E402

ETH = 10**18
SUBMIT_SIG = f"submit({auth.HEADER_TYPE},bytes,bytes)"
SUBMIT_TYPES = [auth.HEADER_TYPE, "bytes", "bytes"]

ERRORS = {
    name: keccak(text=sig)[:4]
    for name, sig in {
        "Reentrancy": "Reentrancy()",
        "InvalidPublicKey": "InvalidPublicKey()",
        "UnknownKind": "UnknownKind(uint8)",
        "WrongEpoch": "WrongEpoch(uint64,uint64)",
        "WrongNonce": "WrongNonce(uint64,uint64)",
        "SubmitterNotAllowed": "SubmitterNotAllowed(address,address)",
        "NotYetValid": "NotYetValid(uint64)",
        "Expired": "Expired(uint64)",
        "LeafAlreadyUsed": "LeafAlreadyUsed(uint64,uint32)",
        "BadSignature": "BadSignature()",
        "EmptyBatch": "EmptyBatch()",
        "TooManyCalls": "TooManyCalls()",
        "SelfCallNotAllowed": "SelfCallNotAllowed(uint256)",
        "CallFailed": "CallFailed(uint256,bytes)",
        "BadReturnValue": "BadReturnValue(uint256)",
        "CancelPayloadNotEmpty": "CancelPayloadNotEmpty()",
        "BadNextEpoch": "BadNextEpoch(uint64,uint64)",
        "ParameterSetChange": "ParameterSetChange()",
        "KeyAlreadyUsed": "KeyAlreadyUsed(bytes32)",
    }.items()
}

COMPILED = None


def compiled():
    global COMPILED
    if COMPILED is None:
        COMPILED = compile_contracts("LMSVerifier.sol", "QRACAccount.sol", "test/Mocks.sol")
    return COMPILED


def revert_data(exc: Exception) -> bytes:
    for arg in exc.args:
        if isinstance(arg, (bytes, bytearray)):
            return bytes(arg)
        if isinstance(arg, str) and arg.startswith(("b'", 'b"')):
            # eth-tester passes custom-error data as the repr() of a bytes object
            value = ast.literal_eval(arg)
            if isinstance(value, bytes):
                return value
        if isinstance(arg, str) and arg.startswith("0x"):
            try:
                return bytes.fromhex(arg[2:])
            except ValueError:
                pass
    return str(exc.args).encode()


def new_key(seed_byte: int, lms_type: int = 5, ots_type: int = lms.LMOTS_SHA256_N32_W4) -> lms.LmsPrivateKey:
    rnd = random.Random(seed_byte)
    return lms.lms_keygen(lms_type, ots_type, rnd.randbytes(16), rnd.randbytes(32))


class Signer:
    """Test signer. Allocates each leaf once, like the real signer journal must."""

    def __init__(self, key: lms.LmsPrivateKey):
        self.key = key
        self.next_leaf = 0

    def take_leaf(self) -> int:
        q = self.next_leaf
        self.next_leaf += 1
        return q


class AccountTestBase(unittest.TestCase):
    def setUp(self):
        c = compiled()
        self.c = c
        self.chain = Chain()
        self.deployer, self.relayer, self.recipient, self.other = self.chain.accounts[:4]
        self.chain_id = self.chain.t.backend.chain.chain_id
        self.verifier = self.chain.deploy(c["LMSVerifier"]["bin"], sender=self.deployer)
        self.signer = Signer(new_key(1))
        self.account = self.deploy_account(self.signer.key.public_key())
        # Fund the account from the (compromised) deployer EOA.
        r = self.chain.transact(self.account, b"", sender=self.deployer, value=10 * ETH)
        self.assertEqual(r.status, 1)

    # --- helpers ---------------------------------------------------------------------------

    def deploy_account(self, public_key: bytes) -> str:
        return self.chain.deploy(self.c["QRACAccount"]["bin"], ["address", "bytes"], [self.verifier, public_key],
                                 sender=self.deployer)

    def deploy_mock(self, name: str) -> str:
        return self.chain.deploy(self.c[name]["bin"], sender=self.deployer)

    def view(self, sig: str, types: list, args: list, out_types: list, account: str | None = None):
        out = self.chain.call(account or self.account, calldata(sig, types, args))
        return decode_output(out_types, out)

    def nonce(self, account=None) -> int:
        return self.view("nonce()", [], [], ["uint64"], account)[0]

    def epoch(self, account=None) -> int:
        return self.view("epoch()", [], [], ["uint64"], account)[0]

    def leaf_used(self, epoch: int, leaf: int) -> bool:
        return self.view("isLeafUsed(uint64,uint32)", ["uint64", "uint32"], [epoch, leaf], ["bool"])[0]

    def now(self) -> int:
        return self.chain.t.get_block_by_number("latest")["timestamp"]

    def authorize(self, kind: int, payload: bytes, *, signer: Signer | None = None, nonce: int | None = None,
                  epoch: int | None = None, submitter: str = auth.ZERO_ADDRESS, valid_after: int = 0,
                  valid_until: int = 0, leaf: int | None = None, account: str | None = None):
        signer = signer or self.signer
        account = account or self.account
        header = auth.Header(
            epoch=self.epoch(account) if epoch is None else epoch,
            nonce=self.nonce(account) if nonce is None else nonce,
            kind=kind, allowed_submitter=submitter, valid_after=valid_after, valid_until=valid_until,
        )
        q = signer.take_leaf() if leaf is None else leaf
        msg = auth.message(self.chain_id, account, header, q, payload)
        return header, payload, signer.key.sign(q, msg)

    def submit_data(self, header, payload, sig) -> bytes:
        return calldata(SUBMIT_SIG, SUBMIT_TYPES, [header.as_tuple(), payload, sig])

    def submit(self, header, payload, sig, sender=None, account=None):
        r = self.chain.transact(account or self.account, self.submit_data(header, payload, sig),
                                sender=sender or self.relayer)
        self.assertEqual(r.status, 1, "submit should succeed")
        return r

    def assert_fails(self, error: str, header, payload, sig, sender=None, account=None):
        """The eth_call must revert with `error`, and the real transaction must revert too."""
        data = self.submit_data(header, payload, sig)
        target = account or self.account
        with self.assertRaises(Exception) as ctx:
            self.chain.call(target, data, sender=sender or self.relayer)
        got = revert_data(ctx.exception)
        self.assertEqual(got[:4], ERRORS[error], f"expected {error}, got {got[:4].hex()} / {ctx.exception.args}")
        r = self.chain.transact(target, data, sender=sender or self.relayer)
        self.assertEqual(r.status, 0)
        return got

    def transfer_payload(self, to: str, amount: int) -> bytes:
        return auth.execute_payload([auth.Call(to, amount, b"")])


# =========================================================================================
class Encoding(AccountTestBase):
    def test_message_matches_python_reference_byte_for_byte(self):
        payloads = {
            auth.KIND_EXECUTE: [
                auth.execute_payload([auth.Call(self.recipient, 1)]),
                auth.execute_payload([auth.Call(self.recipient, 0, b""), auth.Call(self.other, 5, b"\x01" * 33, True),
                                      auth.Call(self.recipient, 2**200, os.urandom(300), False)]),
            ],
            auth.KIND_ROTATE: [auth.rotate_payload(new_key(9).public_key(), 1)],
            auth.KIND_CANCEL: [b""],
        }
        for kind, plist in payloads.items():
            for payload in plist:
                header = auth.Header(3, 7, kind, self.relayer, 11, 2**63)
                ours = auth.message(self.chain_id, self.account, header, 513, payload)
                theirs = self.view("authorizationMessage(" + auth.HEADER_TYPE + ",uint32,bytes)",
                                   [auth.HEADER_TYPE, "uint32", "bytes"], [header.as_tuple(), 513, payload],
                                   ["bytes"])[0]
                self.assertEqual(ours, theirs)

    def test_initial_state(self):
        self.assertEqual(self.view("publicKey()", [], [], ["bytes"])[0], self.signer.key.public_key())
        self.assertEqual((self.epoch(), self.nonce()), (0, 0))
        fp = keccak(self.signer.key.public_key())
        self.assertTrue(self.view("keyFingerprintUsed(bytes32)", ["bytes32"], [fp], ["bool"])[0])
        self.assertEqual(self.chain.balance(self.account), 10 * ETH)


# =========================================================================================
class Authority(AccountTestBase):
    def test_native_transfer_delivered_by_unrelated_relayer(self):
        before = self.chain.balance(self.recipient)
        h, p, s = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, ETH))
        self.submit(h, p, s, sender=self.relayer)
        self.assertEqual(self.chain.balance(self.recipient) - before, ETH)
        self.assertEqual(self.chain.balance(self.account), 9 * ETH)
        self.assertEqual(self.nonce(), 1)
        self.assertTrue(self.leaf_used(0, 0))

    def test_compromised_deployer_key_cannot_spend(self):
        """The attacker holds the deployer's ECDSA key and sends VALID outer transactions."""
        payload = self.transfer_payload(self.deployer, 10 * ETH)
        header = auth.Header(0, 0, auth.KIND_EXECUTE)
        sig_len = lms.lms_signature_length(5, lms.LMOTS_SHA256_N32_W4)
        # 1) random bytes of the right length
        self.assert_fails("BadSignature", header, payload, os.urandom(sig_len), sender=self.deployer)
        # 2) a perfectly valid LMS signature from the attacker's OWN key
        attacker = new_key(66)
        msg = auth.message(self.chain_id, self.account, header, 0, payload)
        self.assert_fails("BadSignature", header, payload, attacker.sign(0, msg), sender=self.deployer)
        # 3) empty signature
        self.assert_fails("BadSignature", header, payload, b"", sender=self.deployer)
        # 4) plain ETH transfers / unknown calls cannot move funds out
        r = self.chain.transact(self.account, keccak(text="withdraw()")[:4], sender=self.deployer)
        self.assertEqual(r.status, 0)
        self.assertEqual(self.chain.balance(self.account), 10 * ETH)
        self.assertEqual(self.nonce(), 0)

    def test_only_submit_changes_state(self):
        """ABI surface: the only non-view entry point is submit(); receive() only accepts funds."""
        mutating = sorted(
            f["name"] for f in self.c["QRACAccount"]["abi"]
            if f["type"] == "function" and f["stateMutability"] in ("nonpayable", "payable")
        )
        self.assertEqual(mutating, ["submit"])

    def test_replay_rejected(self):
        h, p, s = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, ETH))
        self.submit(h, p, s)
        self.assert_fails("WrongNonce", h, p, s)

    def test_tampered_fields_rejected(self):
        payload = self.transfer_payload(self.recipient, ETH)
        h, p, s = self.authorize(auth.KIND_EXECUTE, payload)
        # payload: other recipient, other amount
        self.assert_fails("BadSignature", h, self.transfer_payload(self.other, ETH), s)
        self.assert_fails("BadSignature", h, self.transfer_payload(self.recipient, ETH + 1), s)
        # header fields covered by the signature
        for changed in (
            auth.Header(0, 0, auth.KIND_EXECUTE, self.relayer, 0, 0),           # submitter
            auth.Header(0, 0, auth.KIND_EXECUTE, auth.ZERO_ADDRESS, 0, 2**40),  # validUntil
            auth.Header(0, 0, auth.KIND_EXECUTE, auth.ZERO_ADDRESS, 1, 0),      # validAfter
        ):
            self.assert_fails("BadSignature", changed, p, s)
        # kind change (CANCEL with same signature)
        self.assert_fails("BadSignature", auth.Header(0, 0, auth.KIND_ROTATE), p, s)
        # leaf index change inside the signature
        self.assert_fails("BadSignature", h, p, (5).to_bytes(4, "big") + s[4:])
        # the untouched authorization still works
        self.submit(h, p, s)

    def test_signature_for_other_chain_or_account_rejected(self):
        payload = self.transfer_payload(self.recipient, ETH)
        header = auth.Header(0, 0, auth.KIND_EXECUTE)
        q = self.signer.take_leaf()
        wrong_chain = self.signer.key.sign(q, auth.message(self.chain_id + 1, self.account, header, q, payload))
        self.assert_fails("BadSignature", header, payload, wrong_chain)
        # Same key installed in a second account (test only: real signers never share keys):
        # an authorization for account A is useless on account B.
        account_b = self.deploy_account(self.signer.key.public_key())
        self.chain.transact(account_b, b"", sender=self.deployer, value=ETH)
        h, p, s = self.authorize(auth.KIND_EXECUTE, payload)
        self.assert_fails("BadSignature", h, p, s, account=account_b)
        self.submit(h, p, s)
        self.assertEqual(self.nonce(account_b), 0)
        self.assertEqual(self.chain.balance(account_b), ETH)

    def test_unknown_kind_rejected(self):
        h, p, s = self.authorize(9, b"")
        self.assert_fails("UnknownKind", h, p, s)


# =========================================================================================
class SubmissionPolicy(AccountTestBase):
    def test_restricted_submitter(self):
        h, p, s = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, ETH), submitter=self.relayer)
        self.assert_fails("SubmitterNotAllowed", h, p, s, sender=self.other)
        self.assert_fails("SubmitterNotAllowed", h, p, s, sender=self.deployer)
        self.submit(h, p, s, sender=self.relayer)

    def test_fresh_submitters_need_no_owner_change(self):
        """Two different EOAs deliver consecutive actions; no owner reassignment exists or is needed."""
        h, p, s = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1), submitter=self.other)
        self.submit(h, p, s, sender=self.other)
        h, p, s = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1))
        self.submit(h, p, s, sender=self.chain.accounts[5])
        self.assertEqual(self.nonce(), 2)

    def test_validity_window_and_exact_retry(self):
        now = self.now()
        h, p, s = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1), valid_until=now - 1)
        self.assert_fails("Expired", h, p, s)
        # Not yet valid; later the SAME bytes are retried without re-signing.
        h, p, s = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1), valid_after=now + 3600)
        self.assert_fails("NotYetValid", h, p, s)
        self.chain.t.time_travel(now + 3700)
        self.submit(h, p, s)
        self.assertEqual(self.nonce(), 1)


# =========================================================================================
class Lifecycle(AccountTestBase):
    def test_leaf_reuse_rejected_on_chain(self):
        h, p, s = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1), leaf=3)
        self.submit(h, p, s)
        # A (buggy) second signature with the same leaf for the next nonce is refused.
        h2, p2, s2 = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 2), leaf=3)
        self.assert_fails("LeafAlreadyUsed", h2, p2, s2)

    def test_failed_batch_is_atomic_and_replaceable(self):
        target = self.deploy_mock("Target")
        bump = keccak(text="bump()")[:4]
        fail = keccak(text="fail()")[:4]
        bad = auth.execute_payload([auth.Call(target, ETH, bump), auth.Call(target, 0, fail)])
        h, p, s = self.authorize(auth.KIND_EXECUTE, bad)
        self.assert_fails("CallFailed", h, p, s)
        # Everything rolled back: target untouched, nonce unchanged, leaf NOT consumed on-chain.
        self.assertEqual(self.chain.balance(target), 0)
        self.assertEqual(self.nonce(), 0)
        self.assertFalse(self.leaf_used(0, 0))
        # Replacement: changed action, FRESH leaf, SAME nonce.
        good = auth.execute_payload([auth.Call(target, ETH, bump)])
        h2, p2, s2 = self.authorize(auth.KIND_EXECUTE, good)
        self.assertEqual((h2.nonce, s2[:4]), (0, (1).to_bytes(4, "big")))
        self.submit(h2, p2, s2)
        self.assertEqual(self.chain.balance(target), ETH)
        # The failed original can never succeed now.
        self.assert_fails("WrongNonce", h, p, s)

    def test_competing_authorizations_same_nonce(self):
        a = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1))
        b = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.other, 1), nonce=0)
        self.submit(*b)
        self.assert_fails("WrongNonce", *a)
        self.assertEqual(self.nonce(), 1)

    def test_cancel_consumes_nonce(self):
        pending = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, ETH))
        cancel = self.authorize(auth.KIND_CANCEL, b"", nonce=0)
        self.submit(*cancel)
        self.assertEqual(self.nonce(), 1)
        self.assert_fails("WrongNonce", *pending)
        self.assertEqual(self.chain.balance(self.account), 10 * ETH)
        h, p, s = self.authorize(auth.KIND_CANCEL, b"\x00")
        self.assert_fails("CancelPayloadNotEmpty", h, p, s)

    def test_rotation(self):
        key2 = Signer(new_key(2))
        old_pending = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1))  # nonce 0, epoch 0
        cancel_first = self.authorize(auth.KIND_CANCEL, b"", nonce=0)
        self.submit(*cancel_first)  # nonce -> 1
        rot = self.authorize(auth.KIND_ROTATE, auth.rotate_payload(key2.key.public_key(), 1))
        self.submit(*rot)
        self.assertEqual((self.epoch(), self.nonce()), (1, 2))  # nonce is NOT reset
        self.assertEqual(self.view("publicKey()", [], [], ["bytes"])[0], key2.key.public_key())
        # Old key / old epoch no longer accepted.
        self.assert_fails("WrongEpoch", *self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1),
                                                        epoch=0))
        self.assert_fails("BadSignature", *self.authorize(auth.KIND_EXECUTE,
                                                          self.transfer_payload(self.recipient, 1)))
        self.assert_fails("WrongEpoch", *old_pending)
        # New key works.
        self.submit(*self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.recipient, 1), signer=key2))
        self.assertEqual(self.nonce(), 3)
        # Reinstalling a past key is refused.
        self.assert_fails("KeyAlreadyUsed", *self.authorize(
            auth.KIND_ROTATE, auth.rotate_payload(self.signer.key.public_key(), 2), signer=key2))
        # Changing the parameter set is refused.
        self.assert_fails("ParameterSetChange", *self.authorize(
            auth.KIND_ROTATE, auth.rotate_payload(new_key(3, 5, 2).public_key(), 2), signer=key2))
        # Wrong next epoch is refused.
        self.assert_fails("BadNextEpoch", *self.authorize(
            auth.KIND_ROTATE, auth.rotate_payload(new_key(4).public_key(), 5), signer=key2))

    def test_bad_constructor_keys(self):
        pk = self.signer.key.public_key()
        for bad in (pk[:-1], pk + b"\x00", b"\x00\x00\x00\x0a" + pk[4:], pk[:4] + b"\x00\x00\x00\x09" + pk[8:]):
            with self.assertRaises(Exception):
                self.deploy_account(bad)


# =========================================================================================
class Execution(AccountTestBase):
    def test_token_return_policy(self):
        token = self.deploy_mock("MockToken")
        false_token = self.deploy_mock("FalseToken")
        no_ret = self.deploy_mock("NoReturnToken")
        self.chain.transact(token, calldata("mint(address,uint256)", ["address", "uint256"], [self.account, 100]))
        self.chain.transact(no_ret, calldata("mint(address,uint256)", ["address", "uint256"], [self.account, 100]))
        transfer = lambda to, amt: calldata("transfer(address,uint256)", ["address", "uint256"], [to, amt])  # noqa
        approve = lambda sp, amt: calldata("approve(address,uint256)", ["address", "uint256"], [sp, amt])  # noqa

        # standard token, checked: ok (transfer + approve + revoke in one atomic batch)
        self.submit(*self.authorize(auth.KIND_EXECUTE, auth.execute_payload([
            auth.Call(token, 0, transfer(self.recipient, 40), True),
            auth.Call(token, 0, approve(self.other, 25), True),
            auth.Call(token, 0, approve(self.other, 0), True),
        ])))
        bal = self.chain.call(token, calldata("balanceOf(address)", ["address"], [self.recipient]))
        self.assertEqual(decode_output(["uint256"], bal)[0], 40)
        allowance = self.chain.call(token, calldata("allowance(address,address)", ["address", "address"],
                                                    [self.account, self.other]))
        self.assertEqual(decode_output(["uint256"], allowance)[0], 0)
        # token returning false: rejected when checked
        self.assert_fails("BadReturnValue", *self.authorize(auth.KIND_EXECUTE, auth.execute_payload([
            auth.Call(false_token, 0, transfer(self.recipient, 1), True)])))
        # ...but an unchecked (opaque) call is just a successful CALL; nothing is claimed about its outcome
        self.submit(*self.authorize(auth.KIND_EXECUTE, auth.execute_payload([
            auth.Call(false_token, 0, transfer(self.recipient, 1), False)]), nonce=1))
        # no-return token, checked: ok
        self.submit(*self.authorize(auth.KIND_EXECUTE, auth.execute_payload([
            auth.Call(no_ret, 0, transfer(self.recipient, 7), True)])))
        bal = self.chain.call(no_ret, calldata("balanceOf(address)", ["address"], [self.recipient]))
        self.assertEqual(decode_output(["uint256"], bal)[0], 7)

    def test_self_call_rejected(self):
        self.assert_fails("SelfCallNotAllowed", *self.authorize(auth.KIND_EXECUTE, auth.execute_payload([
            auth.Call(self.account, 0, keccak(text="nonce()")[:4])])))

    def test_empty_and_oversized_batches_rejected(self):
        self.assert_fails("EmptyBatch", *self.authorize(auth.KIND_EXECUTE, auth.execute_payload([])))
        many = [auth.Call(self.recipient, 1)] * 33
        self.assert_fails("TooManyCalls", *self.authorize(auth.KIND_EXECUTE, auth.execute_payload(many)))

    def test_revert_data_bomb_is_truncated(self):
        target = self.deploy_mock("Target")
        got = self.assert_fails("CallFailed", *self.authorize(auth.KIND_EXECUTE, auth.execute_payload([
            auth.Call(target, 0, keccak(text="bomb()")[:4])])))
        index, reason = decode_output(["uint256", "bytes"], got[4:])
        self.assertEqual((index, len(reason)), (0, 256))

    def test_reentrancy_blocked(self):
        reenterer = self.deploy_mock("Reenterer")
        # The inner authorization is valid on its own (nonce 1 after the outer one consumes nonce 0).
        inner = self.authorize(auth.KIND_EXECUTE, self.transfer_payload(self.other, ETH), nonce=1)
        attack = calldata("attack(bytes)", ["bytes"], [self.submit_data(*inner)])
        got = self.assert_fails("CallFailed", *self.authorize(auth.KIND_EXECUTE, auth.execute_payload([
            auth.Call(reenterer, 0, attack)]), nonce=0))
        index, reason = decode_output(["uint256", "bytes"], got[4:])
        self.assertEqual(reason[:4], ERRORS["Reentrancy"])

    def test_nft_receive_and_send(self):
        nft = self.deploy_mock("MockNFT")
        self.chain.transact(nft, calldata("mint(address,uint256)", ["address", "uint256"], [self.deployer, 1]))
        r = self.chain.transact(nft, calldata("safeTransferFrom(address,address,uint256)",
                                              ["address", "address", "uint256"], [self.deployer, self.account, 1]),
                                sender=self.deployer)
        self.assertEqual(r.status, 1)
        owner = lambda: to_checksum_address(decode_output(  # noqa
            ["address"], self.chain.call(nft, calldata("ownerOf(uint256)", ["uint256"], [1])))[0])
        self.assertEqual(owner(), to_checksum_address(self.account))
        self.assertEqual(self.nonce(), 0)  # receiving grants nothing and changes nothing
        self.submit(*self.authorize(auth.KIND_EXECUTE, auth.execute_payload([auth.Call(
            nft, 0, calldata("safeTransferFrom(address,address,uint256)", ["address", "address", "uint256"],
                             [self.account, self.recipient, 1]))])))
        self.assertEqual(owner(), to_checksum_address(self.recipient))


# =========================================================================================
class GasReport(unittest.TestCase):
    """Total transaction gas (what the submitter pays for) with the production parameter set H10/W4."""

    def test_gas_report(self):
        c = compiled()
        chain = Chain()
        deployer, relayer, recipient = chain.accounts[:3]
        verifier_r = chain.transact(None, bytes.fromhex(c["LMSVerifier"]["bin"]), sender=deployer)
        verifier = verifier_r.contract_address
        key = lms.lms_keygen(lms.LMS_SHA256_M32_H10, lms.LMOTS_SHA256_N32_W4, os.urandom(16), os.urandom(32))
        signer = Signer(key)
        account_r = chain.transact(None, bytes.fromhex(c["QRACAccount"]["bin"]) + encode(
            ["address", "bytes"], [verifier, key.public_key()]), sender=deployer)
        account = account_r.contract_address
        chain.transact(account, b"", sender=deployer, value=10 * ETH)
        token = chain.deploy(c["MockToken"]["bin"])
        chain.transact(token, calldata("mint(address,uint256)", ["address", "uint256"], [account, 10**6]))
        chain_id = chain.t.backend.chain.chain_id
        n = [0]

        def run(kind, payload, label, rows):
            header = auth.Header(0 if kind != "post" else 1, n[0], kind if kind != "post" else 1)
            q = signer.take_leaf()
            sig = key.sign(q, auth.message(chain_id, account, header, q, payload))
            data = calldata(SUBMIT_SIG, SUBMIT_TYPES, [header.as_tuple(), payload, sig])
            r = chain.transact(account, data, sender=relayer)
            self.assertEqual(r.status, 1, label)
            n[0] += 1
            rows.append((label, r.gas_used, len(data)))

        rows = [("deploy LMSVerifier", verifier_r.gas_used, len(c["LMSVerifier"]["bin"]) // 2),
                ("deploy QRACAccount", account_r.gas_used, len(c["QRACAccount"]["bin"]) // 2)]
        transfer = lambda to, amt: calldata("transfer(address,uint256)", ["address", "uint256"], [to, amt])  # noqa
        run(auth.KIND_EXECUTE, auth.execute_payload([auth.Call(recipient, ETH)]), "send ETH (1 call)", rows)
        run(auth.KIND_EXECUTE, auth.execute_payload([auth.Call(token, 0, transfer(recipient, 1), True)]),
            "ERC-20 transfer (1 call)", rows)
        run(auth.KIND_EXECUTE, auth.execute_payload([auth.Call(token, 0, transfer(recipient, 1), True)] * 3
                                                    + [auth.Call(recipient, 1)] * 2), "batch (5 calls)", rows)
        run(auth.KIND_CANCEL, b"", "cancel nonce", rows)
        key2 = lms.lms_keygen(lms.LMS_SHA256_M32_H10, lms.LMOTS_SHA256_N32_W4, os.urandom(16), os.urandom(32))
        run(auth.KIND_ROTATE, auth.rotate_payload(key2.public_key(), 1), "rotate key", rows)
        print("\n  [bench] QRACAccount, LMS H10/W4, total tx gas (incl. 21k base + calldata)")
        print("  [bench] action                     gas used    calldata/code bytes")
        for label, gas, size in rows:
            print(f"  [bench] {label:<26} {gas:>9,}    {size:>6,}")


if __name__ == "__main__":
    unittest.main()
