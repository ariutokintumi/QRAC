"""
Extract the Appendix F test vectors from the RFC 8554 text into a JSON fixture.

Usage:
    py -I tools/extract_rfc8554_vectors.py path/to/rfc8554.txt tools/vectors/rfc8554.json

Source: https://www.rfc-editor.org/rfc/rfc8554.txt
"""

import json
import re
import sys

HEX = re.compile(r"^[0-9a-f]+$")

SECTIONS = [
    ("tc1_public_key", "Test Case 1 Public Key"),
    ("tc1_message", "Test Case 1 Message"),
    ("tc1_signature", "Test Case 1 Signature"),
    ("tc2_private_key", "Test Case 2 Private Key"),
    ("tc2_public_key", "Test Case 2 Public Key"),
    ("tc2_message", "Test Case 2 Message"),
    ("tc2_signature", "Test Case 2 Signature"),
]


def hex_of_line(line: str) -> str:
    """Hex values on a test-vector line, ignoring labels, comments and ASCII dumps."""
    line = line.split("#", 1)[0].split("|", 1)[0]
    return "".join(t for t in line.split() if HEX.match(t) and len(t) % 2 == 0)


def main(src: str, dst: str) -> None:
    lines = open(src, encoding="ascii").read().splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("Appendix F.  Test Cases"))
    body = lines[start:]
    heads = []
    for key, title in SECTIONS:
        idx = next(i for i, l in enumerate(body) if l.strip() == title)
        heads.append((key, idx))
    heads.append(("_end", next(i for i, l in enumerate(body) if l.startswith("Acknowledgements"))))

    out = {}
    for (key, a), (_, b) in zip(heads, heads[1:]):
        chunk = body[a + 1:b]
        # Only indented lines carry data; page headers/footers start at column 0.
        data = [l for l in chunk if l.startswith("   ")]
        if key == "tc2_private_key":
            # Keep the named fields separately: two (SEED, I) pairs.
            fields, cur = [], None
            for l in data:
                s = l.strip()
                if s.startswith("SEED") or s.startswith("I "):
                    cur = [s.split()[0], hex_of_line(l)]
                    fields.append(cur)
                elif cur is not None and hex_of_line(l):
                    cur[1] += hex_of_line(l)
            out[key] = {
                "top": {"SEED": fields[0][1], "I": fields[1][1]},
                "second": {"SEED": fields[2][1], "I": fields[3][1]},
            }
        else:
            out[key] = "".join(hex_of_line(l) for l in data)

    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"source": "RFC 8554 Appendix F", "vectors": out}, f, indent=2)
        f.write("\n")
    print("wrote", dst, {k: (len(v) // 2 if isinstance(v, str) else v) for k, v in out.items()})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
