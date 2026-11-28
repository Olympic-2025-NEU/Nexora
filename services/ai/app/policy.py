# SPDX-License-Identifier: AGPL-3.0-only
"""Allowlisted factual context; raw documents, DB rows and credentials are rejected."""

import re


SENSITIVE = re.compile(
    r"(?i)(bearer\s+\S+|sk-[a-z0-9_-]{10,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|"
    r"(?:\+?\d[\s.-]?){10,}|(?:password|secret|token|api[_ -]?key)\s*[:=])"
)
FACT_KEYS = frozenset({"kind", "value", "sourceId", "asOf", "verification"})
FACT_KINDS = frozenset({"quantity", "unit", "batchCode", "issuer", "eventType", "gap"})
VERIFICATIONS = frozenset({"local_verified", "partner_asserted", "missing"})


class PolicyViolation(Exception):
    pass


def validate_input(payload):
    if not isinstance(payload, dict) or set(payload) != {"question", "facts"}:
        raise PolicyViolation("INPUT_INVALID")
    question = payload["question"]
    facts = payload["facts"]
    if not isinstance(question, str) or not 1 <= len(question) <= 300 or SENSITIVE.search(question):
        raise PolicyViolation("QUESTION_UNSAFE")
    if not isinstance(facts, list) or len(facts) > 10:
        raise PolicyViolation("FACTS_INVALID")
    for fact in facts:
        if not isinstance(fact, dict) or set(fact) != FACT_KEYS:
            raise PolicyViolation("FACT_INVALID")
        if (not isinstance(fact["kind"], str) or fact["kind"] not in FACT_KINDS or
                not isinstance(fact["verification"], str) or
                fact["verification"] not in VERIFICATIONS):
            raise PolicyViolation("FACT_INVALID")
        for key in ("value", "sourceId", "asOf"):
            value = fact[key]
            if not isinstance(value, str) or not 1 <= len(value) <= 100 or SENSITIVE.search(value):
                raise PolicyViolation("FACT_UNSAFE")
    return question, facts
