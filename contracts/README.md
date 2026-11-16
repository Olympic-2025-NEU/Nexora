# Nexora contracts — v1-provisional

Machine-readable contracts generated from phase-plan markdown. **Not** runtime-validated until CI + consumer tests exist.

| Artifact | Source markdown |
| --- | --- |
| `openapi/nexora-v1.yaml` | `documents/phase-plan/api-contracts.md`, `api-payloads-v1.md` |
| `events/*.schema.json` | `event-contracts.md`, `event-payloads-v1.md` |
| `events/fixtures/` | Envelope examples + A→B transfer |
| `core-records/*.schema.json` | `core-record-payloads-v1.md` |

## Version

- Label: `v1-provisional`
- Promote after G00 spikes and contract tests pass.

## Validate later (Dev)

```bash
# example — add tooling in P00-T06 / P01
npx --yes @redocly/cli lint contracts/openapi/nexora-v1.yaml
npx --yes ajv-cli validate -s contracts/events/envelope-v1.schema.json -d contracts/events/fixtures/a-to-b-transfer-announced.json
```

Do not invent fields beyond the markdown sources; stub schemas use `x-nexora-comment: fill-from-payloads` where DTO detail is still thin.
