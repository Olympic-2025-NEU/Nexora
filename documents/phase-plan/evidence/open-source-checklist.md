# P00-T04 — Open-source readiness

| Item | P00 state | Evidence / next owner |
| --- | --- | --- |
| Full AGPL-3.0-only text and package metadata | Ready | `LICENSE`, `package.json`; project decision in `SOURCE_OF_TRUTH.md`. |
| Contributors' right to license Nexora scaffold | Team confirmed 2026-11-17 | User confirmed agreement from contributors in this work session; G00 reviewers verify contributor list. |
| Exact SPDX on authored source/config | Checked | `npm run check:spdx`, [source inventory](./source-inventory.json); generated/legacy SQL excluded explicitly. |
| Starter assets/font provenance | Addressed for current tree | Removed unused starter SVG/favicon and Google font import; `NOTICE` records remaining starter origin. |
| Full npm dependency provenance | Checked from lockfile | `npm run check:licenses`, [503-entry inventory](./npm-license-inventory.json). Metadata does not itself prove legal compatibility. |
| Third-party attribution | Prepared | Repo-root `NOTICE`; recheck actual bundled packages/assets for each release. |
| Tracked-file secret scan | Checked | `npm run check:secrets` in CI plus `.gitignore` for `.env*`; scanner covers known token/key formats and is not a full history scan. |
| Public repo and issue tracker | Present | https://github.com/Olympic-2025-NEU/Nexora and https://github.com/Olympic-2025-NEU/Nexora/issues. |
| Changelog | Present | `CHANGELOG.md`; add release entries before tags. |
| Dependency security advisories | Open risk, owned | See [license-inventory.md](./license-inventory.md): Prisma major upgrade and moderate tooling advisories require P01/P13 triage. |
| Reproducible release, build runbook and PoF | P13 | AC-13, phase-13-release.md; not a Phase 00 runtime claim. |

## Release policy prepared in P00

For each candidate release, the release owner must: (1) build from a clean public clone and locked dependencies; (2) run CI, migrations, tests and A→B→C demo; (3) regenerate the npm/image inventory and inspect the **actual** artifacts for third-party notices; (4) check for committed/history secrets and resolve security advisories; (5) publish version tag, source archive, changelog, image digests and build/deploy instructions before submission; (6) expose the corresponding source to users of the network service as required by AGPL. Phase 13 owns execution and proof. No release is claimed by this P00 checklist.
