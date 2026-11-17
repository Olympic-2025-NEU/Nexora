# P00-T04 — License and provenance inventory

**Checked:** 2026-11-17. **Project license:** AGPL-3.0-only; full text in repo-root `LICENSE`. The team confirmed during this work session that contributors to the Nexora scaffold agreed to release their authored code under this license. This is a team assertion, not an independent chain-of-title audit; the G00 reviewers should verify it against the contributor list before distribution.

## Complete npm lockfile

`npm run check:licenses` checks every package entry in `package-lock.json` for a version, license expression, HTTPS npm registry source and integrity hash, then compares the **LF-normalized** lockfile SHA-256 and all entries with [npm-license-inventory.json](./npm-license-inventory.json). The normalization gives Windows CRLF and Linux LF checkouts of the same Git blob one digest. Regenerate with `node scripts/check-licenses.mjs --write-inventory` whenever the lockfile changes. The current inventory has **505 package entries** (including optional platform binaries), not just the direct dependencies in `package.json`.

| Expression in lockfile | Entries | Distribution note |
| --- | ---: | --- |
| MIT | 400 | Preserve upstream package notices when bundled. |
| Apache-2.0 | 43 | Preserve upstream notices when applicable. |
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

**Reconcile P01-T01 (2026-11-17):** application Compose entrypoint is [`deploy/compose.yml`](../../../deploy/compose.yml) with pinned digests (see [`deploy/README.md`](../../../deploy/README.md) and [D13](../../adr/D13-versions-licenses-resources.md)). Legacy `deploy/docker-compose.yml` was removed.

| Image in `deploy/compose.yml` | Digest / note | License (upstream) |
| --- | --- | --- |
| `postgres:17.6` | `sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929` (D03 pin; prefer over older D13 `postgres:17` major pin) | PostgreSQL License |
| `apache/apisix:3.20.0-debian` | `sha256:013de62a9dfba7d8e6006b3e85b524c28c9f1c3549fca3b91d5b258b0b9e759a` | Apache-2.0 |
| `quay.io/keycloak/keycloak:26.8.2` | `sha256:c68e286cacd87b942ac1939a0a1481461109d6acd3a57dc496969a319a76bbf0` | Apache-2.0 |
| `chrislusf/seaweedfs:4.53` | `sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0` | Apache-2.0 |
| `flowable/flowable-rest:8.0.0` | `sha256:708dfa32f27b93180bb6e7a30684d881d995fe257f5b8413e14b20a55c25672d` | Apache-2.0 |
| `redis:7.4-alpine` | `sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe` | BSD-3-Clause ([redis](https://github.com/redis/redis/blob/7.4/COPYING)) |
| `clamav/clamav:1.4` | `sha256:4cc4350d3fded380caf1799e76c0d1c93f3fa40af99c0cb2862ec0c9b117718a`; Compose sets `platform: linux/amd64` (no arm64 manifest) | GPL-2.0-only ([clamav](https://github.com/Cisco-Talos/clamav/blob/main/COPYING.txt)) — inspect image obligations before redistribution |

App/AI images (`nexora/erp:local`, etc.) are Compose profile placeholders until P01-T02. P13 still owns final distributed-artifact notice review.

## Security advisory triage

`npm audit` on this lockfile reported 13 advisories (9 moderate, 4 high) on 2026-11-17. The four high entries form one Prisma 6.19.0 configuration dependency chain (`prisma` → `@prisma/config` → `deepmerge-ts`/`effect`). npm's proposed fix is Prisma 7.10.1, a major migration that would change D03 and its spike; **do not apply it blindly**. Owner: Dev, reassess before P01 runtime/release with a tested Prisma upgrade or an explicit mitigation/acceptance decision. Moderate findings in Ajv/YAML/lint transitive tooling also need review before release. CI records inventory drift; P13 must inspect the production image dependency set and notices.
