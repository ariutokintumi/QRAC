"""
Conformance tests for the Python reference LMS implementation.

Run:  py -m unittest discover -s tools/tests -v
"""

import json
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from qrac import lms  # noqa: E402

VECTORS = json.load(open(os.path.join(HERE, "..", "vectors", "rfc8554.json")))["vectors"]


def b(h: str) -> bytes:
    return bytes.fromhex(h)


def flip(data: bytes, pos: int) -> bytes:
    return data[:pos] + bytes([data[pos] ^ 0x01]) + data[pos + 1:]


class Rfc8554Vectors(unittest.TestCase):
    def test_tc1_hss_signature_verifies(self):
        self.assertTrue(lms.hss_verify(b(VECTORS["tc1_public_key"]), b(VECTORS["tc1_message"]),
                                       b(VECTORS["tc1_signature"])))

    def test_tc2_hss_signature_verifies(self):
        self.assertTrue(lms.hss_verify(b(VECTORS["tc2_public_key"]), b(VECTORS["tc2_message"]),
                                       b(VECTORS["tc2_signature"])))

    def test_tc2_wrong_message_rejected(self):
        msg = b(VECTORS["tc2_message"])
        self.assertFalse(lms.hss_verify(b(VECTORS["tc2_public_key"]), flip(msg, 0),
                                        b(VECTORS["tc2_signature"])))

    def test_tc2_top_tree_regenerated_from_seed(self):
        """Rebuild the H10/W4 tree from the published SEED and I; root and signature must match."""
        priv = VECTORS["tc2_private_key"]["top"]
        t0 = time.perf_counter()
        key = lms.lms_keygen(lms.LMS_SHA256_M32_H10, lms.LMOTS_SHA256_N32_W4, b(priv["I"]), b(priv["SEED"]))
        elapsed = time.perf_counter() - t0
        print(f"\n  [bench] Python keygen LMS H10/W4 (1024 leaves): {elapsed:.2f}s")
        hss_pub = b(VECTORS["tc2_public_key"])
        self.assertEqual(key.public_key(), hss_pub[4:])

        sig = b(VECTORS["tc2_signature"])
        top_len = lms.lms_signature_length(lms.LMS_SHA256_M32_H10, lms.LMOTS_SHA256_N32_W4)
        top_sig = sig[4:4 + top_len]
        second_pub = sig[4 + top_len:4 + top_len + 56]
        q = lms.lms_signature_leaf(top_sig)
        self.assertEqual(q, 3)
        ours = key.sign(q, second_pub)
        self.assertTrue(lms.lms_verify(key.public_key(), second_pub, ours))
        self.assertEqual(ours, top_sig, "deterministic C (Appendix A) should reproduce the RFC signature")


class RoundTripAndMutation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = lms.lms_keygen(5, lms.LMOTS_SHA256_N32_W4, bytes(range(16)), bytes(range(32)))
        cls.pub = cls.key.public_key()
        cls.msg = b"QRAC test message"
        cls.sig = cls.key.sign(7, cls.msg)

    def test_valid(self):
        self.assertTrue(lms.lms_verify(self.pub, self.msg, self.sig))

    def test_every_leaf_signs(self):
        for q in range(self.key.capacity):
            self.assertTrue(lms.lms_verify(self.pub, b"m%d" % q, self.key.sign(q, b"m%d" % q)))

    def test_mutated_signature_rejected_everywhere(self):
        # Flip one bit in every byte of the signature: q, OTS type, C, y[i], LMS type, path.
        for pos in range(len(self.sig)):
            self.assertFalse(lms.lms_verify(self.pub, self.msg, flip(self.sig, pos)), f"byte {pos}")

    def test_mutated_public_key_rejected(self):
        for pos in range(len(self.pub)):
            self.assertFalse(lms.lms_verify(flip(self.pub, pos), self.msg, self.sig), f"byte {pos}")

    def test_mutated_message_rejected(self):
        self.assertFalse(lms.lms_verify(self.pub, self.msg + b"x", self.sig))
        self.assertFalse(lms.lms_verify(self.pub, flip(self.msg, 3), self.sig))

    def test_wrong_lengths_rejected(self):
        self.assertFalse(lms.lms_verify(self.pub, self.msg, self.sig[:-1]))
        self.assertFalse(lms.lms_verify(self.pub, self.msg, self.sig + b"\x00"))
        self.assertFalse(lms.lms_verify(self.pub[:-1], self.msg, self.sig))
        self.assertFalse(lms.lms_verify(self.pub, self.msg, b""))

    def test_leaf_index_out_of_range_rejected(self):
        bad = (self.key.capacity).to_bytes(4, "big") + self.sig[4:]
        self.assertFalse(lms.lms_verify(self.pub, self.msg, bad))


if __name__ == "__main__":
    unittest.main()
