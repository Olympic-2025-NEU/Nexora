# Optional local AI adapter

The Python service and Ollama run only with Compose profile `ai`; ERP, M03 and M04 do not depend on them. Default `AI_PROVIDER=none` keeps inference disabled. The adapter has no database, file-storage, Flowable or Keycloak credential and does not serve a public port.

For a local demo, put `AI_PROVIDER=ollama` and a random `AI_INTERNAL_TOKEN` of at least 32 characters in each ignored `deploy/instances/{a,b,c}.env` where AI is enabled. Never copy the token into Git, a model prompt or a browser request. `AI_MODEL=qwen3:0.6b`, `AI_MODEL_BASE_URL=http://ollama:11434`. Bring up the optional profile for only the intended instance, then pull the approved model in that instance's Ollama container:

```powershell
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile ai up -d --build ai ollama
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile ai exec ollama ollama pull qwen3:0.6b
```

`/health` checks the adapter process. `/ready` returns 503 until the model exists and Ollama responds. The internal generation endpoint requires `X-AI-Internal-Token`; P10-T03 will connect the ERP orchestration to it. Only an allowlisted, bounded question and factual source fields can reach Ollama. Provider down, timeout or missing model returns 503 with `/trace` fallback; the ERP workflow continues independently.

The image is pinned in [D09](../../documents/adr/0009-ai-provider.md). Model tag/manifest, license and resource budget are recorded there. The model is not bundled into the repository or auto-downloaded when the ordinary app stack starts. Tests use Python's standard library: from `services/ai`, run `python -m unittest discover -s tests -v`.
