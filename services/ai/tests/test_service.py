# SPDX-License-Identifier: AGPL-3.0-only
"""Provider failure and data-boundary tests without downloading a model."""

import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app.policy import PolicyViolation, validate_input
from app.server import create_server
from config.settings import Settings, load_settings
from provider.ollama import OllamaProvider, ProviderUnavailable


FACT = {"kind": "quantity", "value": "4 EA", "sourceId": "document-123",
        "asOf": "2026-11-26T00:00:00Z", "verification": "local_verified"}


class FakeProvider:
    def __init__(self, unavailable=False):
        self.unavailable = unavailable
        self.calls = []

    def ready(self):
        return not self.unavailable

    def generate(self, question, facts):
        self.calls.append((question, facts))
        if self.unavailable:
            raise ProviderUnavailable("MODEL_UNAVAILABLE")
        return "4 EA from document-123"


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.settings = Settings("ollama", "qwen3:0.6b", "http://ollama:11434",
                                 "A" * 32, port=0)
        self.provider = FakeProvider()
        self.server = create_server(self.settings, self.provider, "127.0.0.1")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, body=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["X-AI-Internal-Token"] = token
        request = Request(self.base + path, data=None if body is None else json.dumps(body).encode(),
                          headers=headers)
        try:
            with urlopen(request, timeout=2) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_health_is_independent_of_provider_and_failure_is_bounded(self):
        self.provider.unavailable = True
        self.assertEqual(self.request("/health")[0], 200)
        self.assertEqual(self.request("/ready")[0], 503)
        status, body = self.request("/v1/generate", {"question": "Stock?", "facts": [FACT]},
                                    self.settings.internal_token)
        self.assertEqual((status, body["error"], body["fallback"]),
                         (503, "AI_UNAVAILABLE", "/trace"))

    def test_internal_auth_and_minimized_facts(self):
        payload = {"question": "How much stock?", "facts": [FACT]}
        self.assertEqual(self.request("/v1/generate", payload)[0], 403)
        status, body = self.request("/v1/generate", payload, self.settings.internal_token)
        self.assertEqual((status, body["answer"]), (200, "4 EA from document-123"))
        self.assertEqual(self.provider.calls, [(payload["question"], [FACT])])
        for unsafe in ("user@example.com", "Bearer hidden-secret", "sk-123456789012345"):
            self.assertEqual(self.request("/v1/generate", {"question": unsafe, "facts": [FACT]},
                                          self.settings.internal_token)[0], 422)
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(self.request("/v1/generate", {"question": "Hi", "facts": [FACT],
                                                       "databaseDump": "private"},
                                      self.settings.internal_token)[0], 422)


class ConfigurationTest(unittest.TestCase):
    def test_external_provider_or_unapproved_target_is_rejected(self):
        with self.assertRaises(ValueError):
            load_settings({"AI_PROVIDER": "external", "AI_INTERNAL_TOKEN": "A" * 32})
        with self.assertRaises(ValueError):
            load_settings({"AI_PROVIDER": "ollama", "AI_INTERNAL_TOKEN": "A" * 32,
                           "AI_MODEL_BASE_URL": "http://example.com:11434"})
        with self.assertRaises(PolicyViolation):
            validate_input({"question": "Hi", "facts": [{**FACT, "privateFile": "x"}]})

    def test_transport_failure_does_not_expose_internal_exception(self):
        def broken_connection(*_args, **_kwargs):
            raise OSError("SECRET upstream address")

        provider = OllamaProvider(Settings("ollama", "qwen3:0.6b", "http://ollama:11434",
                                           "A" * 32), broken_connection)
        with self.assertRaisesRegex(ProviderUnavailable, "MODEL_UNAVAILABLE") as error:
            provider.generate("Hi", [FACT])
        self.assertNotIn("SECRET", str(error.exception))


if __name__ == "__main__":
    unittest.main()
