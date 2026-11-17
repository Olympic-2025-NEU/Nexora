# P00-T04 — Open-source release readiness checklist

| Item | Status | Owner | Notes |
| --- | --- | --- | --- |
| `LICENSE` AGPL-3.0-only full text | Present | — | Repo root |
| SPDX on authored sources | Pending | Dev | See `spdx-checklist.md` |
| `NOTICE` for third-party | Pending / N/A | Dev | Create if bundling attributed assets |
| `CHANGELOG.md` | Present (verify currency) | Dev | Keep updated each release |
| Public repository URL | **TBD** | Dev | Record when published |
| Issue tracker URL | **TBD** | Dev | GitHub/GitLab issues etc. |
| Web viewer / docs site | TBD | Dev | Optional for P00 |
| SBOM / license inventory (deps + images) | Pending | Dev | After D13 spike; no `latest` images |
| Secret scan config | Pending | Dev | e.g. gitleaks / GitHub secret scanning |
| `.env` / secrets not in Git | Partial | Dev | `deploy/.env` missing locally; ensure gitignore; add `.env.example` in P01 |
| Rebuild-from-source runbook | Pending | Dev | AC-13 / P13 |

**Blockers for claiming open-source Done:** public URL + tracker + SPDX sweep + SBOM.
