"""
Differential tests: on-chain LMSVerifier (Solidity, local py-evm) vs the Python reference.

Run:  ..\\.venv\\Scripts\\python -m unittest discover -s tests -v      (from tools/)
"""

import json
import os
import random
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from qrac import lms  # noqa: E402
from qrac.evm import Chain, calldata, compile_contracts, decode_output  # noqa: E402

VECTORS = json.load(open(os.path.join(HERE, "..", "vectors", "rfc8554.json")))["vectors"]
VERIFY_SIG = "verify(bytes,bytes,bytes)"
VERIFY_TYPES = ["bytes", "bytes", "bytes"]


def flip(data: bytes, pos: int) -> bytes:
    return data[:pos] + bytes([data[pos] ^ 0x01]) + data[pos + 1:]


class VerifierOnChain(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compiled = compile_contracts("LMSVerifier.sol", "test/GasProbe.sol")
        cls.chain = Chain()
        cls.verifier = cls.chain.deploy(cls.compiled["LMSVerifier"]["bin"])
        cls.probe = cls.chain.deploy(cls.compiled["GasProbe"]["bin"])
        # The QRAC default parameter set: LMS_SHA256_M32_H10 / LMOTS_SHA256_N32_W4.
        cls.key = lms.lms_keygen(lms.LMS_SHA256_M32_H10, lms.LMOTS_SHA256_N32_W4,
                                 bytes.fromhex("0102030405060708090a0b0c0d0e0f10"), bytes(range(32)))
        cls.pub = cls.key.public_key()

    def onchain(self, pub: bytes, msg: bytes, sig: bytes) -> bool:
        out = self.chain.call(self.verifier, calldata(VERIFY_SIG, VERIFY_TYPES, [pub, msg, sig]))
        return decode_output(["bool"], out)[0]

    def gas(self, pub: bytes, msg: bytes, sig: bytes) -> tuple[int, bool]:
        inner = calldata(VERIFY_SIG, VERIFY_TYPES, [pub, msg, sig])
        out = self.chain.call(self.probe, calldata("measure(address,bytes)", ["address", "bytes"],
                                                   [self.verifier, inner]))
        gas_used, success, ret = decode_output(["uint256", "bool", "bytes"], out)
        self.assertTrue(success)
        return gas_used, decode_output(["bool"], ret)[0]

    # --- RFC 8554 vectors (each LMS level of the HSS signatures) ---------------------------

    def _rfc_levels(self, tc: str):
        pub0 = bytes.fromhex(VECTORS[f"{tc}_public_key"])[4:]
        sig = bytes.fromhex(VECTORS[f"{tc}_signature"])
        msg = bytes.fromhex(VECTORS[f"{tc}_message"])
        t0 = int.from_bytes(pub0[0:4], "big"), int.from_bytes(pub0[4:8], "big")
        l0 = lms.lms_signature_length(*t0)
        sig0 = sig[4:4 + l0]
        pub1 = sig[4 + l0:4 + l0 + 56]
        sig1 = sig[4 + l0 + 56:]
        return [(pub0, pub1, sig0), (pub1, msg, sig1)]

    def test_rfc8554_tc1_levels(self):
        for pub, msg, sig in self._rfc_levels("tc1"):
            self.assertTrue(self.onchain(pub, msg, sig))
            self.assertFalse(self.onchain(pub, flip(msg, 0), sig))

    def test_rfc8554_tc2_levels(self):
        for pub, msg, sig in self._rfc_levels("tc2"):
            self.assertTrue(self.onchain(pub, msg, sig))
            self.assertFalse(self.onchain(pub, flip(msg, 0), sig))

    # --- Differential: random messages and leaves --------------------------------------------

    def test_random_messages_agree_with_reference(self):
        rnd = random.Random(8554)
        for _ in range(12):
            q = rnd.randrange(self.key.capacity)
            msg = rnd.randbytes(rnd.choice([0, 1, 31, 32, 33, 200, 1000]))
            sig = self.key.sign(q, msg)
            self.assertTrue(lms.lms_verify(self.pub, msg, sig))
            self.assertTrue(self.onchain(self.pub, msg, sig), f"q={q} len={len(msg)}")

    def test_boundary_leaves(self):
        for q in (0, 1, self.key.capacity - 2, self.key.capacity - 1):
            sig = self.key.sign(q, b"boundary")
            self.assertTrue(self.onchain(self.pub, b"boundary", sig))

    # --- Rejections ---------------------------------------------------------------------------

    def test_mutations_rejected(self):
        msg = b"QRAC mutation test"
        sig = self.key.sign(42, msg)
        p = lms.LMOTS_TYPES[lms.LMOTS_SHA256_N32_W4].p
        ots_end = 8 + 32 * (p + 1)
        # q, ots type, C, first/last y, lms type, first/last path node, plus random positions.
        positions = [0, 3, 4, 7, 8, 39, 40, 71, ots_end - 1, ots_end, ots_end + 3, ots_end + 4, len(sig) - 1]
        positions += random.Random(1).sample(range(len(sig)), 24)
        for pos in positions:
            self.assertFalse(self.onchain(self.pub, msg, flip(sig, pos)), f"signature byte {pos}")
        for pos in (0, 4, 8, 23, 24, 55):
            self.assertFalse(self.onchain(flip(self.pub, pos), msg, sig), f"public key byte {pos}")
        self.assertFalse(self.onchain(self.pub, msg + b"\x00", sig))
        self.assertFalse(self.onchain(self.pub, msg[:-1], sig))

    def test_malformed_inputs_return_false(self):
        msg = b"malformed"
        sig = self.key.sign(5, msg)
        cases = {
            "empty sig": (self.pub, msg, b""),
            "short sig": (self.pub, msg, sig[:-1]),
            "long sig": (self.pub, msg, sig + b"\x00"),
            "short pub": (self.pub[:-1], msg, sig),
            "empty pub": (b"", msg, sig),
            "q out of range": (self.pub, msg, (1024).to_bytes(4, "big") + sig[4:]),
            "q max": (self.pub, msg, b"\xff\xff\xff\xff" + sig[4:]),
            "unsupported lms type": (b"\x00\x00\x00\x0a" + self.pub[4:], msg, sig),
            "unsupported ots type": (self.pub[:4] + b"\x00\x00\x00\x05" + self.pub[8:], msg, sig),
            "type zero": (b"\x00" * 8 + self.pub[8:], msg, sig),
        }
        for name, (pub, m, s) in cases.items():
            self.assertFalse(self.onchain(pub, m, s), name)

    def test_signature_for_other_key_rejected(self):
        other = lms.lms_keygen(5, lms.LMOTS_SHA256_N32_W4, b"\x99" * 16, b"\x77" * 32)
        sig = other.sign(0, b"hello")
        self.assertTrue(self.onchain(other.public_key(), b"hello", sig))
        self.assertFalse(self.onchain(self.pub, b"hello", sig))


class GasBenchmark(unittest.TestCase):
    """Prints a gas table. Execution gas of verify() only (no tx intrinsic / calldata cost)."""

    def test_gas_by_parameter_set(self):
        compiled = compile_contracts("LMSVerifier.sol", "test/GasProbe.sol")
        chain = Chain()
        verifier = chain.deploy(compiled["LMSVerifier"]["bin"])
        probe = chain.deploy(compiled["GasProbe"]["bin"])
        rnd = random.Random(2026)
        rows = []
        for ots_type in (lms.LMOTS_SHA256_N32_W4, 2, 4):  # W4 (default), W2, W8
            key = lms.lms_keygen(lms.LMS_SHA256_M32_H10, ots_type, rnd.randbytes(16), rnd.randbytes(32))
            pub = key.public_key()
            samples = []
            for _ in range(10):
                msg = rnd.randbytes(320)  # ~ size of a simple authorization
                sig = key.sign(rnd.randrange(key.capacity), msg)
                inner = calldata(VERIFY_SIG, VERIFY_TYPES, [pub, msg, sig])
                out = chain.call(probe, calldata("measure(address,bytes)", ["address", "bytes"], [verifier, inner]))
                g, ok, ret = decode_output(["uint256", "bool", "bytes"], out)
                self.assertTrue(ok and decode_output(["bool"], ret)[0])
                samples.append(g)
            w = lms.LMOTS_TYPES[ots_type].w
            rows.append((f"H10/W{w}", len(sig), min(samples), sum(samples) // len(samples), max(samples)))
        rt = compiled["LMSVerifier"]["runtime_size"]
        print(f"\n  [bench] LMSVerifier runtime size: {rt} bytes")
        print("  [bench] params    sig bytes   verify gas min / avg / max (10 random msgs, 320-byte message)")
        for name, slen, mn, avg, mx in rows:
            print(f"  [bench] {name:<9} {slen:>9}   {mn:,} / {avg:,} / {mx:,}")


if __name__ == "__main__":
    unittest.main()
