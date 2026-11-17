# P00-T04 — SPDX checklist

**License project:** `AGPL-3.0-only` — full text in repo root `LICENSE`.  
**Rule:** Authored `.ts`/`.tsx` under `app/`, `platform/`, `contexts/`, `composition/`, `components/`, `scripts/` need `SPDX-License-Identifier: AGPL-3.0-only`. Skip generated `next-env.d.ts`.

**Status:** Done on `chore/p00-g00-close` (2026-11-17). Enforce with `npm run check:spdx` (CI).

| Area | SPDX |
| --- | --- |
| `app/**/*.ts(x)` | present |
| `platform/**/*.ts` | present |
| `contexts/**/*.ts` | present |
| `composition/**/*.ts` | present |
| `components/**/*.ts` | present |
| `scripts/**/*.ts` + check/validate scripts | present |

## Done when

- [x] Authored sources have SPDX  
- [x] `scripts/check-spdx.mjs` fails CI if missing  
- [ ] `NOTICE` if third-party bundled assets require it (N/A for now)  
- [x] No secrets committed (`.env*` gitignored except `.env.example`)  
