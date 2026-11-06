"""
Run every QRAC test (Python reference + on-chain contracts on a local in-memory EVM).

From the repository root:
    .venv\\Scripts\\python tools/run_tests.py
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover(os.path.join(HERE, "tests"), top_level_dir=HERE)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
