# D09 — Local AI provider and data boundary

- **Status:** Accepted for P10-T01; model quality remains a G10 acceptance check
- **Date:** 2026-11-26
- **Decision owner:** Phase 10 implementation
- **Scope:** AI01 only; ERP and M04 operate with the AI profile stopped

## Decision

Run the AGPL Python adapter in the optional `ai` Compose profile and use a separate local Ollama server. The approved default is `qwen3:0.6b` (Q4_K_M). It is small enough for a demo machine compared with larger variants; answer quality is not presumed. P10-T03/G10 must compare sourced answers with business APIs and revise this ADR if the model fails. The adapter has no DB, S3, Flowable, or Admin credential. Business tools are executed by the ERP backend under the current actor's authorization (P10-T02), not by granting a privileged service token to the model.

| Item | Pin / term |
| --- | --- |
| Ollama runtime | `ollama/ollama:0.40.18@sha256:1cabd20e1762a7a8444bf4a7110b346d923cd77ab6c97c984434140638c913ec`; MIT |
| Model | `qwen3:0.6b` Q4_K_M; Ollama registry `ollama-content-digest: 7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435`; Apache-2.0 |
| AI adapter | Python 3.12 slim image pinned in `services/ai/Dockerfile`; stdlib only; authored code AGPL-3.0-only |
| Source | [Ollama repository](https://github.com/ollama/ollama), [Ollama model tag](https://ollama.com/library/qwen3:0.6b), [Qwen model card](https://huggingface.co/Qwen/Qwen3-0.6B) |
| Resource budget | Ollama model download ~523 MB; Compose runtime memory cap 2 GiB and adapter cap 256 MiB. Actual peak RAM and answer latency require live model smoke before G10. No per-call external API fee. |

## Data handling

- Provider and model remain on the same host in the private Docker network. No external inference endpoint, no external data region, no outbound provider key. The Python adapter accepts only a bounded question and up to ten allowlisted facts (`kind`, `value`, `sourceId`, `asOf`, `verification`); it rejects extra keys, over-size bodies and common credential/contact patterns. This is a defense-in-depth filter, not a guarantee against every possible PII string. The ERP tool layer must never supply raw documents, attachments, full DB rows, credentials, member/contact fields or private file content.
- The adapter has no conversation store and suppresses HTTP request logging. It does not persist prompts or answers. P10-T02 records only redacted tool metadata in `platform.audit_log`; no prompt or token. Host administrators control Docker logs and the local model cache. Retention for tool audit follows the platform audit policy, not a separate AI transcript store.
- An internal service token from an ignored environment file protects the adapter's generation endpoint. This token is never sent to the model. Only `http://ollama:11434` is an accepted model destination, with no redirect following. The AI service and Ollama have no public port.

## Failure, quota and fallback

- Default `AI_PROVIDER=none`; AI is optional. With `ollama` enabled, a model not pulled, timeout, malformed/oversized response or Ollama outage returns bounded `503 AI_UNAVAILABLE` and a direct `/trace` fallback. `/health` remains a liveness check, `/ready` reflects model availability. ERP, M03 and M04 have no dependency on either AI service.
- Provider timeout is 30 seconds (hard configuration range 1–60), output cap 256 tokens (hard maximum 512), 2048 context tokens, 4096-byte request body and ten facts. Per-actor call rate and audit belong to P10-T02. The local cost is model storage, CPU/RAM and energy; an operator can leave the optional profile stopped.
- The model is not an authority for stock or provenance. Only tool results with source IDs can support an answer. No tool for confirm, approve, policy changes, transfer sending, deletion or SQL is registered.

## Verification boundary

P10-T01 verifies Docker config, Python service failure/auth/data guards, and ERP/trace independence while AI is stopped. It does not claim the model has answered the A/B/C scenario. P10-T03/G10 must run a real model and check answer quality, source fidelity, privacy and latency; release pins must be rechecked at G13.
