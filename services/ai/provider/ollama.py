# SPDX-License-Identifier: AGPL-3.0-only
"""Bounded Ollama adapter. HTTP redirects and arbitrary destinations are never followed."""

import http.client
import json
import threading
import time


class ProviderUnavailable(Exception):
    pass


FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 60.0


class CircuitBreaker:
    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._failures = 0
        self._opened_at = None
        self._probe_in_flight = False

    def call(self, operation):
        with self._lock:
            if self._opened_at is not None:
                if self._clock() - self._opened_at < COOLDOWN_SECONDS or self._probe_in_flight:
                    raise ProviderUnavailable("MODEL_UNAVAILABLE")
                self._probe_in_flight = True
        succeeded = False
        try:
            result = operation()
            succeeded = True
            return result
        except ProviderUnavailable:
            with self._lock:
                self._failures += 1
                if self._failures >= FAILURE_THRESHOLD:
                    self._opened_at = self._clock()
            raise
        finally:
            with self._lock:
                if succeeded:
                    self._failures = 0
                    self._opened_at = None
                self._probe_in_flight = False


class OllamaProvider:
    def __init__(self, settings, connection_factory=http.client.HTTPConnection,
                 clock=time.monotonic):
        self.settings = settings
        self.connection_factory = connection_factory
        self.breaker = CircuitBreaker(clock=clock)

    def _request(self, path, payload=None):
        connection = None
        try:
            connection = self.connection_factory("ollama", 11434, timeout=self.settings.timeout_seconds)
            body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
            connection.request("GET" if body is None else "POST", path, body=body,
                               headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            if response.status != 200:
                raise ProviderUnavailable("MODEL_UNAVAILABLE")
            raw = response.read(65537)
            if len(raw) > 65536:
                raise ProviderUnavailable("MODEL_RESPONSE_TOO_LARGE")
            return json.loads(raw)
        except (OSError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            raise ProviderUnavailable("MODEL_UNAVAILABLE") from error
        finally:
            if connection is not None:
                connection.close()

    def ready(self):
        return self.breaker.call(self._ready)

    def _ready(self):
        result = self._request("/api/tags")
        return any(model.get("name") == self.settings.model
                   for model in result.get("models", []))

    def generate(self, question, facts):
        return self.breaker.call(lambda: self._generate(question, facts))

    def _generate(self, question, facts):
        prompt = json.dumps({"question": question, "facts": facts}, ensure_ascii=False,
                            separators=(",", ":"))
        result = self._request("/api/chat", {
            "model": self.settings.model,
            "stream": False,
            "think": False,
            "messages": [
                {"role": "system", "content": "Answer only from supplied facts. State gaps. Never invent a source or quantity."},
                {"role": "user", "content": prompt},
            ],
            "options": {"num_ctx": 2048, "num_predict": self.settings.max_output_tokens,
                        "temperature": 0},
        })
        answer = result.get("message", {}).get("content")
        if not isinstance(answer, str) or not answer or len(answer) > 4096:
            raise ProviderUnavailable("MODEL_RESPONSE_INVALID")
        return answer
