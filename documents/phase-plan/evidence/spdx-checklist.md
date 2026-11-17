# P00-T04 — SPDX evidence

**Project license:** `AGPL-3.0-only`; full text in `LICENSE`.

`npm run check:spdx` checks the **exact** identifier in the first six lines of every tracked or untracked non-ignored `.ts`, `.tsx`, `.js`, `.mjs`, `.css` and `.prisma` source/config file. It compares paths to [source-inventory.json](./source-inventory.json), so adding a source file requires an inventory update in the same PR. Regenerate with `node scripts/check-spdx.mjs --write-inventory`.

Excluded: `next-env.d.ts` (Next-generated); `prisma/migrations/**` (Prisma-generated SQL). `db/migrations/0001_platform.sql` is a zero-byte legacy placeholder and will be removed/replaced under D03/P01. The scanner does not relicense third-party source; new vendored code/assets require separate provenance and notices before merging.

- [x] Nexora contributors' AGPL agreement confirmed by the team in the 2026-11-17 work session.
- [x] Exact SPDX and complete path inventory checked on current authored source/config.
- [x] Unused Next/Vercel SVG/favicon and Google font import removed; starter origin retained in `NOTICE`.
- [x] CI fails when SPDX is absent, wrong or the source inventory drifts.
- [ ] Reviewers independently verify contributor list and distribution notices at G00/P13.
