"""BIP-39 against the official vectors, and QRAC derivation properties."""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from qrac import derive  # noqa: E402


class Bip39(unittest.TestCase):
    def test_official_vectors(self):
        words = derive.load_wordlist()
        vectors = json.load(open(os.path.join(HERE, "..", "vectors", "bip39.json"), encoding="utf-8"))["vectors"]
        self.assertEqual(len(vectors), 8)
        for v in vectors:
            self.assertEqual(derive.entropy_to_mnemonic(bytes.fromhex(v["entropy"]), words), v["mnemonic"])
            self.assertEqual(derive.mnemonic_to_seed(v["mnemonic"], v["passphrase"]).hex(), v["seed"])


class Derivation(unittest.TestCase):
    def test_trees_are_independent(self):
        seed = derive.mnemonic_to_seed(derive.entropy_to_mnemonic(bytes(32), derive.load_wordlist()))
        seen = set()
        for chain in (1, 11155111):
            for idx in (0, 1):
                for epoch in (0, 1, 2):
                    s, i = derive.derive_tree(seed, chain, idx, epoch)
                    self.assertEqual((len(s), len(i)), (32, 16))
                    self.assertNotIn(s, seen)
                    self.assertNotIn(i, seen)
                    seen.update((s, i))


if __name__ == "__main__":
    unittest.main()
