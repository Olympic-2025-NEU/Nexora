# P00-T04 — License / SBOM inventory (top-level)

**Date:** 2026-11-17  
**Branch:** `chore/p00-g00-close`  
**Scope:** Direct dependencies in `package.json` + pinned Postgres image. Full recursive SBOM deferred to tooling in P13; gateway/storage/Flowable images deferred to P01 (ADR D13).

## Application (npm)

| Package | Version (declared) | License (declared upstream) | Notes |
| --- | --- | --- | --- |
| `next` | 16.4.6 | MIT | App framework |
| `react` / `react-dom` | 19.3.0 | MIT | UI |
| `@prisma/client` | 6.19.0 | Apache-2.0 | Runtime client |
| `prisma` (dev) | 6.19.0 | Apache-2.0 | Migrate / generate |
| `typescript` (dev) | ^5 | Apache-2.0 | Types |
| `eslint` / `eslint-config-next` (dev) | ^9 / 16.4.6 | MIT | Lint |
| `tailwindcss` / `@tailwindcss/turbopack` (dev) | 4.3.3 | MIT | Styles |
| `tsx` (dev) | 4.20.5 | MIT | Spike runner |
| `ajv` / `ajv-formats` (dev) | 8.17.1 / 3.0.1 | MIT | Contract validate |
| `yaml` (dev) | 2.8.1 | ISC | OpenAPI parse |

Project license: **AGPL-3.0-only** (`LICENSE` at repo root). Authored source must carry `SPDX-License-Identifier: AGPL-3.0-only` (`npm run check:spdx`).

## Container images (current release compose)

| Image | Pin | License | Digest (spike note) |
| --- | --- | --- | --- |
| `postgres:17.6` | tag 17.6 | PostgreSQL License | `sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929` (D03 spike) |

## Deferred (not in app compose yet)

APISIX, Keycloak, SeaweedFS, Flowable — digest/license/RAM in phase-00 ADR evidence (`D01`/`D02`/`D04`/`D06`/`D13`); must be re-pinned in P01 release compose. No `latest` tags in release.

## Gaps

- [ ] Automated CycloneDX/SPDX SBOM from lockfile in CI (P13)
- [ ] Third-party NOTICE if bundling fonts/assets later
- [ ] npm audit  moderate findings reviewed (baseline noted; not blocking G00 package)
