# SPDX-License-Identifier: AGPL-3.0-only
"""Bounded Ollama adapter. HTTP redirects and arbitrary destinations are never followed."""

import http.client
import json


class ProviderUnavailable(Exception):
    pass


class OllamaProvider:
    def __init__(self, settings, connection_factory=http.client.HTTPConnection):
        self.settings = settings
        self.connection_factory = connection_factory

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
        result = self._request("/api/tags")
        return any(model.get("name") == self.settings.model
                   for model in result.get("models", []))

    def generate(self, question, facts):
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
