# P00 G00 — local branch / CI notes

**Working branch:** `chore/p00-g00-close`  
**Base develop:** `63abd139a41d3c05ac9a7b681e470433dc8ed097` (includes PR #48 reconcile phase-00 + Prisma)  
**Started:** 2026-11-17  
**Tree:** `main` ← `develop` ← `chore/p00-g00-close` (PR target: develop)

Gate 0: left `reconcile/phase-00-into-develop` (already merged); synced `develop`; created chore branch before code.

## Local verify (2026-11-17)

Commands (clean clone path):

```text
npm ci
npm run lint
npx prisma generate
npm run build
npm run typecheck
npm test   # check:spdx + test:contracts
```

Result: **PASS**

| Step | Outcome |
| --- | --- |
| lint | OK |
| prisma generate | OK (6.19.0) |
| build | OK (Next 16.4.6) |
| typecheck | OK |
| check-spdx | OK (32 files) |
| test:contracts | envelope PASS; openapi structure PASS (59 paths) |

CI workflow: `.github/workflows/ci.yml` mirrors these steps.

## Push / PR

- Branch pushed: `origin/chore/p00-g00-close` @ `d17fd4f`
- Open PR → `develop`: https://github.com/Olympic-2025-NEU/Nexora/compare/develop...chore/p00-g00-close?expand=1
- Note: local `gh` CLI not installed; create PR via the compare URL (do not push to develop/main).
