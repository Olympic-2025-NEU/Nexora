# P00-T04 — Open-source release readiness checklist

| Item | Status | Owner | Notes |
| --- | --- | --- | --- |
| `LICENSE` AGPL-3.0-only full text | Present | — | Repo root |
| SPDX on authored sources | Done | Dev | `npm run check:spdx` |
| `NOTICE` for third-party | N/A pending assets | Dev | Create if bundling attributed assets |
| `CHANGELOG.md` | Present | Dev | Keep updated each release |
| Public repository URL | https://github.com/Olympic-2025-NEU/Nexora | Dev | |
| Issue tracker URL | https://github.com/Olympic-2025-NEU/Nexora/issues | Dev | |
| Web viewer / docs site | TBD optional | Dev | |
| SBOM / license inventory | Partial | Dev | See `license-inventory.md`; full SBOM P13 |
| Secret scan | GitHub + `.gitignore` `.env*` | Dev | Never commit `.env` |
| Rebuild-from-source runbook | Pending | Dev | AC-13 / P13 |

**G00 package:** inventory + SPDX check sufficient for review; release/PoF still P13.
