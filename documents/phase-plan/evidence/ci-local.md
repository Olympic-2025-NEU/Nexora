# P00-T06 — Clean install and CI guard evidence

**Date:** 2026-11-17
**Branch:** `chore/p00-audit-remediation`
**Base:** `develop` at `18be482` (merged previous G00 package)

## Clean install and positive run

Ran the same commands as `.github/workflows/ci.yml` after `npm ci`:

```text
npm ci                         PASS (405 installed; 13 audit advisories recorded separately)
npm run lint                   PASS (zero warnings allowed)
npm run db:generate            PASS (Prisma Client 6.19.0)
npm run build                  PASS (Next 16.4.6; only / and /api/v1/health in app)
npm run typecheck              PASS
npm test                       PASS
  check:spdx                   48 sources
  check:licenses               505 lockfile packages
  check:secrets                222 files; known key/token patterns
  test:contracts               70 paths, 87 operations, 30 request fixture pairs;
                               4 core pairs, 7 domain pairs, 7 federation valid,
                               9 negative, 3 retry/hash vectors, Python cross-check
```

`npm ci` printed the same 13 dependency advisories documented in `license-inventory.md`. The advisory set needs P01/P13 review; a clean install is not a security clearance.

## Negative guards

Each mutation was temporary, restored immediately after its expected failure; none is committed.

| Deliberate defect | Command | Expected result observed |
| --- | --- | --- |
| Unused variable in temporary `.mjs` source | `npm run lint` | Exit 1 with `@typescript-eslint/no-unused-vars` warning; `--max-warnings=0` makes it blocking. |
| Assign string to `number` in temporary `.ts` source | `npm run typecheck` | Exit 1, `TS2322`. |
| Temporary source lacks SPDX header | `npm run check:spdx` | Exit 1, file named in missing-header report. |
| Hand-edit generated OpenAPI description | `npm run check:openapi` | Exit 1, generated YAML reported stale. |

The static contract suite detects malformed fixtures and request schemas, but route behavior requires running API/DB tests in the owning phases.

## GitHub Actions verification

The first branch run ([#5](https://github.com/Olympic-2025-NEU/Nexora/actions/runs/44018070773), commit `93a66c5`) failed only at `check:licenses`: Windows CRLF working-tree bytes had been hashed into the inventory, while GitHub checked out the same lockfile with LF. Commit `8be50b1` normalizes CRLF to LF before hashing and uses deterministic path ordering. The normalized worktree hash, committed Git blob hash and inventory hash were compared locally and matched.

The follow-up [GitHub Actions run](https://github.com/Olympic-2025-NEU/Nexora/actions/runs/44018443706) for commit `8be50b1c6b90231b360d34ed7706dff3d34d0ed4` completed **success** on Ubuntu. Install, lint, Prisma generate, build, typecheck and the full `npm test` gate passed. The workflow runner still reported 13 npm audit advisories, tracked in `license-inventory.md`.
