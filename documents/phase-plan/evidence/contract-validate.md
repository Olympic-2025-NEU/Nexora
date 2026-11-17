# P00-T05 — Contract validate evidence

**Date:** 2026-11-17  
**Branch:** `chore/p00-g00-close`  
**Command:** `npm run test:contracts`

```text
envelope fixture: PASS
openapi structure: PASS (59 paths, version 3.0.3)
validate-contracts: OK
```

## Covered

- Ajv 2020-12: `contracts/events/envelope-v1.schema.json` ← `fixtures/a-to-b-transfer-announced.json`
- OpenAPI YAML parse + required `openapi` / `info.title` / `paths` (≥5)

## Notes

- OpenAPI remains `v1-provisional` with stub schemas (`x-nexora-comment`); structural lint only.
- D07 / D08 / D14 remain as decided in `decision-log.md` / numbered ADRs (no schema rewrite in this task).
- Wired into `npm test` and CI.
