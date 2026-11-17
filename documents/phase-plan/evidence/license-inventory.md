# P00-T04 — License and provenance inventory

**Checked:** 2026-11-17. **Project license:** AGPL-3.0-only; full text in repo-root `LICENSE`. The team confirmed during this work session that contributors to the Nexora scaffold agreed to release their authored code under this license. This is a team assertion, not an independent chain-of-title audit; the G00 reviewers should verify it against the contributor list before distribution.

## Complete npm lockfile

`npm run check:licenses` checks every package entry in `package-lock.json` for a version, license expression, HTTPS npm registry source and integrity hash, then compares the lockfile SHA-256 and all entries with [npm-license-inventory.json](./npm-license-inventory.json). Regenerate with `node scripts/check-licenses.mjs --write-inventory` whenever the lockfile changes. The current inventory has **503 package entries** (including optional platform binaries), not just the direct dependencies in `package.json`.

| Expression in lockfile | Entries | Distribution note |
| --- | ---: | --- |
| MIT | 399 | Preserve upstream package notices when bundled. |
| Apache-2.0 | 42 | Preserve upstream notices when applicable. |
| ISC | 17 | Preserve upstream license text when bundled. |
| MPL-2.0 | 13 | Mostly build tooling; inspect distributed artifacts at release. |
| LGPL-3.0-or-later and combined expressions | 14 | Mostly optional Sharp/libvips binaries; inspect the actual image contents and obligations at release. |
| BSD-2-Clause / BSD-3-Clause | 12 | Preserve upstream license text when bundled. |
| BlueOak-1.0.0 | 2 | Development transitive packages. |
| Python-2.0 | 1 | Development transitive package. |
| CC-BY-4.0 | 1 | `caniuse-lite`; attribution in repo-root `NOTICE`. |
| CC0-1.0 / 0BSD | 2 | Public-domain/permissive expressions; preserve provenance. |

This is a metadata/provenance check, **not** an automatic legal compatibility verdict. Any new license expression fails CI until reviewed and added deliberately. Dependencies are fetched through npm; no dependency source is copied into this repository.

## Source and assets

[source-inventory.json](./source-inventory.json) lists each non-generated source/config file checked for the exact AGPL SPDX header. The empty legacy SQL migration and Prisma-generated migration SQL are excluded as generated/legacy artifacts; the Prisma schema is covered. [baseline.md](./baseline.md) records the original Create Next App/template provenance. Phase 00 removed the five unused starter SVGs, starter favicon, starter landing page and Google font import. `NOTICE` retains starter provenance and caniuse-lite attribution. No third-party image or font binary remains tracked.

## Container images

Current `deploy/docker-compose.yml` has only `postgres:17.6` (PostgreSQL License). The D03 spike recorded digest `sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`; the Compose tag is **not** a digest pin. APISIX, Keycloak, SeaweedFS and Flowable are spike images documented in D01/D02/D04/D06/D13, not in the application Compose yet. P01 must pin actual release image digests, source URLs, licenses and RAM for the selected architecture.

## Security advisory triage

`npm audit` on this lockfile reported 13 advisories (9 moderate, 4 high) on 2026-11-17. The four high entries form one Prisma 6.19.0 configuration dependency chain (`prisma` → `@prisma/config` → `deepmerge-ts`/`effect`). npm's proposed fix is Prisma 7.10.1, a major migration that would change D03 and its spike; **do not apply it blindly**. Owner: Dev, reassess before P01 runtime/release with a tested Prisma upgrade or an explicit mitigation/acceptance decision. Moderate findings in Ajv/YAML/lint transitive tooling also need review before release. CI records inventory drift; P13 must inspect the production image dependency set and notices.
