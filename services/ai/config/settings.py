# SPDX-License-Identifier: AGPL-3.0-only
"""Conservative, local-only AI runtime configuration."""

from dataclasses import dataclass
from os import environ
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    provider: str
    model: str
    model_base_url: str
    internal_token: str
    timeout_seconds: float = 30.0
    max_output_tokens: int = 256
    port: int = 8080


def load_settings(env=None) -> Settings:
    source = environ if env is None else env
    provider = source.get("AI_PROVIDER", "none")
    if provider not in ("none", "ollama"):
        raise ValueError("AI_PROVIDER must be none or ollama")
    model = source.get("AI_MODEL", "qwen3:0.6b")
    if model != "qwen3:0.6b":
        raise ValueError("AI_MODEL must match the approved D09 model")
    model_base_url = source.get("AI_MODEL_BASE_URL", "http://ollama:11434")
    url = urlsplit(model_base_url)
    if (url.scheme, url.hostname, url.port, url.path, url.query, url.fragment, url.username) != (
        "http", "ollama", 11434, "", "", "", None
    ) or url.password is not None:
        raise ValueError("AI_MODEL_BASE_URL must be the internal Ollama service")
    token = source.get("AI_INTERNAL_TOKEN", "")
    if provider == "ollama" and (len(token) < 32 or token.startswith("CHANGE_ME_")):
        raise ValueError("AI_INTERNAL_TOKEN must be an external secret of at least 32 characters")
    timeout = float(source.get("AI_REQUEST_TIMEOUT_SECONDS", "30"))
    if not 1 <= timeout <= 60:
        raise ValueError("AI_REQUEST_TIMEOUT_SECONDS must be between 1 and 60")
    output = int(source.get("AI_MAX_OUTPUT_TOKENS", "256"))
    if not 1 <= output <= 512:
        raise ValueError("AI_MAX_OUTPUT_TOKENS must be between 1 and 512")
    port = int(source.get("AI_PORT", "8080"))
    if not 1 <= port <= 65535:
        raise ValueError("AI_PORT invalid")
    return Settings(provider, model, model_base_url, token, timeout, output, port)
