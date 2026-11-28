# SPDX-License-Identifier: AGPL-3.0-only

import json
import unittest

from config.settings import Settings
from provider.ollama import OllamaProvider, ProviderUnavailable


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class StubResponse:
    status = 200

    def read(self, _limit):
        return json.dumps({"message": {"content": "4 EA"}}).encode("utf-8")


class StubConnection:
    def __init__(self, fail):
        self.fail = fail

    def request(self, *_args, **_kwargs):
        if self.fail:
            raise TimeoutError("stub timeout")

    def getresponse(self):
        return StubResponse()

    def close(self):
        pass


class StubProvider:
    def __init__(self):
        self.fail = True
        self.attempts = 0

    def __call__(self, *_args, **_kwargs):
        self.attempts += 1
        return StubConnection(self.fail)


class CircuitBreakerTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.stub = StubProvider()
        settings = Settings("ollama", "qwen3:0.6b", "http://ollama:11434", "A" * 32, port=0)
        self.provider = OllamaProvider(settings, self.stub, clock=self.clock)

    def generate(self):
        return self.provider.generate("Stock?", [])

    def fail_three_times(self):
        for _ in range(3):
            with self.assertRaisesRegex(ProviderUnavailable, "MODEL_UNAVAILABLE"):
                self.generate()

    def test_ba_lỗi_liên_tiếp_mở_breaker(self):
        for _ in range(2):
            with self.assertRaisesRegex(ProviderUnavailable, "MODEL_UNAVAILABLE"):
                self.generate()
        self.assertEqual(self.stub.attempts, 2)
        with self.assertRaisesRegex(ProviderUnavailable, "MODEL_UNAVAILABLE"):
            self.generate()
        self.assertEqual(self.stub.attempts, 3)

    def test_gọi_nhanh_khi_breaker_đang_mở(self):
        self.fail_three_times()
        self.stub.fail = False
        for _ in range(3):
            with self.assertRaisesRegex(ProviderUnavailable, "MODEL_UNAVAILABLE"):
                self.generate()
        self.assertEqual(self.stub.attempts, 3)
        self.clock.advance(59)
        with self.assertRaisesRegex(ProviderUnavailable, "MODEL_UNAVAILABLE"):
            self.generate()
        self.assertEqual(self.stub.attempts, 3)

    def test_probe_thành_công_đóng_breaker(self):
        self.fail_three_times()
        self.stub.fail = False
        self.clock.advance(60)
        self.assertEqual(self.generate(), "4 EA")
        self.assertEqual(self.stub.attempts, 4)
        self.assertEqual(self.generate(), "4 EA")
        self.assertEqual(self.stub.attempts, 5)

    def test_probe_thất_bại_mở_lại_breaker(self):
        self.fail_three_times()
        self.clock.advance(60)
        with self.assertRaisesRegex(ProviderUnavailable, "MODEL_UNAVAILABLE"):
            self.generate()
        self.assertEqual(self.stub.attempts, 4)
        with self.assertRaisesRegex(ProviderUnavailable, "MODEL_UNAVAILABLE"):
            self.generate()
        self.assertEqual(self.stub.attempts, 4)
        self.stub.fail = False
        self.clock.advance(60)
        self.assertEqual(self.generate(), "4 EA")
        self.assertEqual(self.stub.attempts, 5)


if __name__ == "__main__":
    unittest.main()
