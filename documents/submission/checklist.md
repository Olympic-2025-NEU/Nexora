# Submission checklist (P13-T08)

Owner: contest lead (fill BTC / receipt fields — **do not invent**).  
Repo: https://github.com/Olympic-2025-NEU/Nexora · Branch SoT: `phase-13`  
**Push Git ≠ đã nộp bài** nếu thể lệ yêu cầu form/email riêng.

## A. BTC confirmation (empty until verified)

| Field | Value | Source URL / doc | Confirmed by | Date |
| --- | --- | --- | --- | --- |
| Official deadline | _TBD — do not assume 06/12/2025 from older PDF_ | | | |
| Submission channel (form / email / portal) | _TBD_ | | | |
| Required artifacts (video, docs, team form) | _TBD_ | | | |
| Team representative | _TBD_ | | | |
| Notes on 2025 vs 2026 schedule conflict | Đề thi từng ghi 06/12/2025; thể lệ mùa 2026 đề cập lịch chấm 7–9/12/2026 — **chờ BTC** | [contest-scorecard.md](../phase-plan/contest-scorecard.md) | | |

## B. Pre-submit gates (evidence links)

| Item | Status | Evidence |
| --- | --- | --- |
| Public repo + issues | Ready | https://github.com/Olympic-2025-NEU/Nexora · Issues |
| AGPL LICENSE + SPDX + NOTICE + inventory | Ready | [p13-t04.md](../phase-plan/evidence/p13-t04.md) |
| CHANGELOG | Ready | [CHANGELOG.md](../../CHANGELOG.md) |
| Clean-install docs | Ready; AC-13 second-person pending | [p13-t03.md](../phase-plan/evidence/p13-t03.md) |
| Source `.tar.gz` prep | Ready script; re-run at tag | [p13-t06.md](../phase-plan/evidence/p13-t06.md) |
| Release tag / GitHub Release | **Blocked** until owner confirms tag name | Suggested: `v0.13.0-contest` / `contest-2026-p13` |
| Demo runbook | Ready | [demo/runbook.md](../demo/runbook.md) |
| Known limitations honest | Ready | [known-limitations.md](../phase-plan/evidence/known-limitations.md) |
| Submission receipt | **Empty** | _paste portal/email receipt here after submit_ |

## C. Contest scorecard → evidence

| Row | Evidence |
| --- | --- |
| PoF-1 | Public GitHub URL above |
| PoF-2 | LICENSE, `npm run check:spdx`, NOTICE, license inventory |
| PoF-3 | Tag+archive after owner confirm ([p13-t06.md](../phase-plan/evidence/p13-t06.md)); timestamp must precede receipt |
| PoF-4 | README + deploy clean install ([p13-t03.md](../phase-plan/evidence/p13-t03.md)) |
| PoF-5 | lockfile + `check:licenses` |
| PoF-6 | README, Issues, CHANGELOG |
| Sản phẩm-7 | ADR/D11, federation actual-vs-sent, demo Q&A |
| Sản phẩm-8 | G00–G12 + [p13-t02.md](../phase-plan/evidence/p13-t02.md) / G13 |
| Sản phẩm-9 | G11 DX-Lab |
| Sản phẩm-10 | P12 ops + release traceability |
| Sản phẩm-11 | [demo/runbook.md](../demo/runbook.md) |

## D. After submit

- [ ] Receipt / confirmation ID stored in this file (section B).
- [ ] Tag/release URL and archive sha256 recorded.
- [ ] Do not backdate or claim BTC confirmation without a named source.
