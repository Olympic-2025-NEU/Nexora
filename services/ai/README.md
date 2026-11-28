# Optional local AI adapter

The Python service and Ollama run only with Compose profile `ai`; ERP, M03 and M04 do not depend on them. Default `AI_PROVIDER=none` keeps inference disabled. The adapter has no database, file-storage, Flowable or Keycloak credential and does not serve a public port.

For a local demo, override `AI_PROVIDER=ollama` and `AI_INTERNAL_TOKEN` in the shell for the selected Compose command. Shell values take precedence over `--env-file`, so no ignored `deploy/instances/{a,b,c}.env` needs editing. Generate a fresh token of at least 32 characters; keep the same value in shells that call the internal endpoint. Never copy the token into Git, a model prompt or a browser request. `AI_MODEL=qwen3:0.6b`, `AI_MODEL_BASE_URL=http://ollama:11434`. Bring up the optional profile for only the intended instance, then pull the approved model in that instance's Ollama container:

```powershell
$env:AI_PROVIDER = "ollama"
$env:AI_INTERNAL_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile ai up -d --build erp ai ollama
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile ai exec ollama ollama pull qwen3:0.6b
```

Keep the same shell token for the Compose command that recreates both `erp` and `ai`; changing only one service makes their private calls fail. For an existing locally built ERP image, use `--no-build` instead of `--build`. Confirm available disk space before pulling the model.

`/health` checks the adapter process. `/ready` returns 503 until the model exists and Ollama responds. The internal generation endpoint requires `X-AI-Internal-Token`; P10-T03 connects the ERP orchestration to it. Only an allowlisted, bounded question and factual source fields can reach Ollama. Provider down, timeout or missing model returns 503 with `/trace` fallback; the ERP workflow continues independently.

The image is pinned in [D09](../../documents/adr/0009-ai-provider.md). Model tag/manifest, license and resource budget are recorded there. The model is not bundled into the repository or auto-downloaded when the ordinary app stack starts. Tests use Python's standard library: from `services/ai`, run `python -m unittest discover -s tests -v`.

P10-T02's five input schemas are in `tools/`. Tool execution remains inside the ERP backend (`contexts/ai/application/`), which reuses the authenticated user's Bearer token only for loopback calls to existing business APIs. The model and Python adapter never receive that token. There is deliberately no public tool execution endpoint; P10-T03/T04 connect chat and draft requests to the internal registry.
