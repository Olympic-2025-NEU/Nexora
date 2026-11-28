# SPDX-License-Identifier: AGPL-3.0-only
"""Optional internal inference service; it has no database or business write access."""

import hmac
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.policy import PolicyViolation, validate_input
from config.settings import load_settings
from provider.ollama import OllamaProvider, ProviderUnavailable


def create_server(settings, provider=None, host="0.0.0.0"):
    model = provider if provider is not None else OllamaProvider(settings)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            return  # Never log prompt, token, path parameters or model output.

        def respond(self, status, body):
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                return self.respond(200, {"status": "up"})
            if self.path != "/ready":
                return self.respond(404, {"error": "NOT_FOUND"})
            try:
                ready = settings.provider == "ollama" and model.ready()
            except ProviderUnavailable:
                ready = False
            return self.respond(200 if ready else 503,
                                {"status": "ready" if ready else "unavailable"})

        def do_POST(self):
            if self.path != "/v1/generate":
                return self.respond(404, {"error": "NOT_FOUND"})
            token = self.headers.get("X-AI-Internal-Token", "")
            if not settings.internal_token or not hmac.compare_digest(token, settings.internal_token):
                return self.respond(403, {"error": "FORBIDDEN"})
            if settings.provider == "none":
                return self.respond(503, {"error": "AI_UNAVAILABLE", "fallback": "/trace"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= 4096:
                    raise PolicyViolation("INPUT_SIZE_INVALID")
                question, facts = validate_input(json.loads(self.rfile.read(length)))
            except (ValueError, json.JSONDecodeError, PolicyViolation):
                return self.respond(422, {"error": "INPUT_REJECTED"})
            try:
                answer = model.generate(question, facts)
            except ProviderUnavailable:
                return self.respond(503, {"error": "AI_UNAVAILABLE", "fallback": "/trace"})
            return self.respond(200, {"answer": answer})

    return ThreadingHTTPServer((host, settings.port), Handler)


if __name__ == "__main__":
    create_server(load_settings()).serve_forever()
