# SPDX-License-Identifier: AGPL-3.0-only
"""Independent Python check of the federation JCS fixture subset.

The v1 envelope uses ASCII property names, strings, booleans, null, arrays,
objects and safe integers. Decimal quantities are strings. This check rejects
numeric floats and duplicate keys; the Node contract check owns full RFC 8785
canonicalization through the canonicalize package.
"""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "contracts" / "events" / "fixtures"
MANIFEST = json.loads((FIXTURES / "manifest-v1.json").read_text(encoding="utf-8"))


def reject_float(value):
    raise ValueError(f"Federation JSON must not contain a float: {value}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        if not key.isascii():
            raise ValueError("Fixture key outside the ASCII-key JCS subset")
        result[key] = value
    return result


def load_fixture(name):
    value = json.loads(
        (FIXTURES / name).read_text(encoding="utf-8"),
        parse_float=reject_float,
        parse_constant=reject_float,
        object_pairs_hook=unique_object,
    )

    def check_numbers(item):
        if isinstance(item, dict):
            for child in item.values():
                check_numbers(child)
        elif isinstance(item, list):
            for child in item:
                check_numbers(child)
        elif isinstance(item, int) and not isinstance(item, bool):
            if abs(item) > 2**53 - 1:
                raise ValueError("Fixture integer exceeds I-JSON safe range")

    check_numbers(value)
    return value


def digest(value):
    canonical = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


for entry in MANIFEST["valid"]:
    actual = digest(load_fixture(entry["file"]))
    if actual != entry["sha256"]:
        raise SystemExit(f"Python JCS fixture hash mismatch: {entry['file']}")

for entry in MANIFEST["replay"]:
    candidate = load_fixture(entry["file"])
    reference = load_fixture(entry["reference"])
    same_hash = digest(candidate) == digest(reference)
    if candidate["messageId"] != reference["messageId"] or same_hash != entry["sameHash"]:
        raise SystemExit(f"Python replay vector mismatch: {entry['file']}")

print(f"python-jcs: PASS ({len(MANIFEST['valid'])} fixed hashes, {len(MANIFEST['replay'])} replay vectors)")
