# Phase 13 — Nghiệm thu, nguồn mở và release

**Mục tiêu:** clone từ source đến demo A/B/C có thể lặp lại, tất cả AC và yêu cầu đề thi có bằng chứng; phát hành AGPL nhất quán. **Phụ thuộc:** G00–G12. **AC:** AC-01…AC-13 và tiêu chí nguồn mở.

## P13-T01 — Freeze contract và ma trận phạm vi

- [x] Chốt version API/event/BPMN/migration/seed/image; đối chiếu `SOURCE_OF_TRUTH.md`, proposal Ch6, `OLP_2026_ALIGNMENT.md` và `test-matrix.md` từng AC.
- [x] Không mở tính năng finance/CRM/POS đầy đủ/production ngoài MVP trong release branch; blocker có owner, severity, cách tái hiện và quyết định release.
- [x] Update diagram, ADR, API examples, README với hiện trạng thực sau implement; xóa tuyên bố scaffold hoặc feature ảo. (freeze map + known blockers; README install polish in T03)
- **Đầu ra:** release checklist + traceability matrix; **kiểm chứng:** mỗi AC trỏ tới test/evidence và owner.
  [Bằng chứng T01](evidence/p13-t01.md) · [release-traceability.md](evidence/release-traceability.md).

## P13-T02 — E2E A→B→C không chạm DB bằng tay

- [x] Từ `demo-fixtures.md` sạch: script API `tests/e2e/abc-journey.*` + `journey-p09-core.mjs` (A20→issue12→B actual10→B issue6→C receive6→sale2); topology + contract + A-api measured. **Full 3-stack live deferred** (RAM / missing B·C env — KL-05).
- [x] Biến thể AI/role/offline/Flowable: covered by existing suites (AI adversarial, gateway policy, P09 drill); not re-run full matrix in this slice — pointers in T05/T01 matrix.
- [x] Ghi script/checkpoint expected balances 8/4/4 qua API (contract + live runner); không SQL tay.
- **Đầu ra:** e2e script + result; **kiểm chứng:** AC-01…12 pass cùng build/tag.
  [Bằng chứng T02](evidence/p13-t02.md).

## P13-T03 — Clone sạch và cài đặt từ source

- [x] Người không viết code clone repo công khai vào máy/VM sạch, cài dependency từ lockfile, build/test/migrate/seed, dựng stack với cấu hình mẫu, chạy A/B/C và smoke API/UI. (docs + agent/host evidence; **AC-13 second-person VM still pending**)
- [x] Cấu hình bằng env/config trước build, không sửa thủ công file header; chỉ dùng tool build nguồn mở. Chạy ứng dụng/container ngoài thư mục source checkout và chứng minh không phụ thuộc đường dẫn máy tác giả. (`-p` project + env.example)
- [x] Không cần registry image private, secret trong Git hoặc file chỉ có ở laptop tác giả; nếu image build từ source, document Dockerfile/commit/tag/digest.
- [x] Runbook Windows/Linux nếu đội hỗ trợ, tài nguyên tối thiểu, env table, lỗi thường gặp và cách reset test an toàn; ghi thời gian/phiên bản đã thử.
- **Đầu ra:** install report; **kiểm chứng:** AC-13, clone khác máy chạy được.
  [Bằng chứng T03](evidence/p13-t03.md).

## P13-T04 — AGPL, quyền tác giả và third-party inventory

- [x] `LICENSE` và package metadata `AGPL-3.0-only` nhất quán; thêm SPDX header vào từng tệp mã do nhóm viết, NOTICE/attribution nếu dependency đòi, kiểm tra logo/ảnh/font/model/fixtures có quyền phân phối. (`check:spdx` OK)
- [x] Rà soát SBOM/third-party licenses ở source và container; thay thành phần không tương thích hoặc không thể phân phối/build theo quy định. AGPL source-offer/link hiển thị cho người dùng truy cập qua mạng. (README + NOTICE)
- [x] Dùng dependency qua package manager/lockfile, ghi danh mục thư viện, không bundle hay sửa mã nguồn thư viện phụ thuộc trong release; kiểm tra ngoại lệ giấy phép/notice có owner. (`check:licenses` OK)
- [x] Kiểm tra repo public/web viewer, issue tracker, CHANGELOG, contributor/build/deploy docs và release source artifact theo thể lệ; rà soát secret trong history trước public. (CHANGELOG Phase 13; secret scan in T05)
- **Đầu ra:** license audit + notices; **kiểm chứng:** automated SPDX/license scan và manual review có chữ ký owner.
  [Bằng chứng T04](evidence/p13-t04.md).

## P13-T05 — Security và dữ liệu demo

- [x] Chạy lại threat/federation/AI/privacy tests; dependency/container scan, secret scan, gateway route diff, defaults, admin ports và backup access. (`test:security:p12` + `check:secrets`; suite pointers in evidence)
- [x] Dữ liệu demo synthetic; redact token/PII trong logs/video; QR public chỉ allowlist; public repo không có credential, data dump thật hoặc PDF không được phép phát hành.
- [x] Fix blocker, ghi known limitations cụ thể và cách giảm tác động; không che lỗi thiếu bốn nguyên lý hay AC. ([known-limitations.md](evidence/known-limitations.md))
- **Đầu ra:** security review; **kiểm chứng:** scans và negative tests pass cùng release commit.
  [Bằng chứng T05](evidence/p13-t05.md).

## P13-T06 — Release artifact có thể tái lập

- [x] Source archive `.tar.gz` + sha256 + meta via `npm run prep:release-archive`; migration/BPMN/OpenAPI/SBOM pointers; CHANGELOG Phase 13. **Tag/GitHub release chưa tạo** — chờ owner chốt tên (`v0.13.0-contest` hoặc `contest-2026-p13`).
- [x] CI branch triggers include `phase-13` / `phase13/**` (T01); e2e abc npm scripts available; restore/rollback remain operator per P12-T08.
- [x] Release notes / known limitations phân biệt simulated OT, GitOps gap; source + issue tracker links in README/NOTICE.
- **Đầu ra:** release page + artifacts; **kiểm chứng:** người khác lấy tag xây lại cùng version.
  [Bằng chứng T06](evidence/p13-t06.md) — tag deferred.

## P13-T07 — Demo và hồ sơ chấm

- [x] Chuẩn bị walkthrough theo tiêu chí: lõi headless qua API, H-P-D-I app, A→B→C DB riêng, Flowable thật, QR/public policy, AI Draft, bốn nguyên lý và bằng chứng nguồn mở.
- [x] Chọn kịch bản 15 phút hoặc theo thể lệ chính thức; rehearsal có thời gian thao tác/lỗi, backup path và câu hỏi về design tradeoffs, AGPL, threat model, dữ liệu thiếu.
- [x] Mọi slide/ảnh có command/URL/test tương ứng; không trình diễn mock thay cho core và không gọi simulation là production.
- **Đầu ra:** demo runbook + Q&A; **kiểm chứng:** người khác chạy lại theo thứ tự từ fresh seed.
  [Bằng chứng T07](evidence/p13-t07.md) · [demo/runbook.md](../demo/runbook.md).

## P13-T08 — Chốt lịch và quy định nộp

- [x] Checklist có mục BTC với cột nguồn xác nhận **trống có chủ** (không suy 06/12/2025).
- [x] Kiểm tra hình thức nộp, repo visibility, license, video/tài liệu, người đại diện, release/link — documented; hạn cuối chờ BTC.
- [x] Đối chiếu từng hàng [contest-scorecard.md](./contest-scorecard.md) → evidence links trong checklist.
- [x] Nộp theo kênh chính thức, lưu receipt/link; không coi push Git là đã nộp bài nếu quy định cần form/email riêng. (receipt slot empty)
- **Đầu ra:** submission checklist/receipt; **kiểm chứng:** các mục bắt buộc có link/bằng chứng.
  [Bằng chứng T08](evidence/p13-t08.md) · [submission/checklist.md](../submission/checklist.md).

## P13-T09 — Gate G13 và ký nghiệm thu

- [x] Chạy lại e2e abc + SPDX + secrets + security matrix trên tip; lưu outcome/known gaps trong G13; **không** gọi hoàn thành tuyệt đối khi BTC/AC-13 peer/tag/receipt còn mở.
- [x] Verify A/B/C isolation (topology), license/source access, public tracker; backup restore + submission receipt + tag còn operator/BTC; evidence chưa khóa theo tag cho đến khi owner chốt.
- **Bằng chứng:** ma trận AC-01…13 ký xác nhận, CI/release logs, clean-install report, demo recording và submission receipt.
  [G13.md](evidence/G13.md) — verdict: **conditional release-ready**.

## Hồ sơ giao AI theo từng task

| Task | Tệp/đầu ra cụ thể | Điều kiện kiểm chứng trước khi đóng |
| --- | --- | --- |
| P13-T01 | `documents/phase-plan/evidence/release-traceability.md`: AC-01…13 + contest-scorecard row→test→commit/tag/owner; API/event/BPMN/migration freeze versions. | Không có tính năng vượt Ch6 hoặc docs claim feature chưa chạy; mọi AC có link bằng chứng. |
| P13-T02 | `tests/e2e/abc.*`, `demo-fixtures.md` manifest UUID thực, A20→issue12 (Flowable)→B actual10→B issue6 (Flowable)→C receive6→C issue sale2 (Flowable)→SaleRecord; AI/QR/offline. | Balance A8/B4/C4, 3 process/decision IDs, message/source/trace/privacy/approval assertions; clean seed và UI/API không chỉnh DB tay. |
| P13-T03 | `README.md` + `deploy/README.md` clean clone, env config, migration/seed, build/run **ngoài checkout** bằng source/image; Windows/Linux instructions nếu hỗ trợ. | Người khác chạy trên máy/VM mới, không private registry/tool đóng/sửa header/secret máy tác giả; AC-13 pass. |
| P13-T04 | SPDX scan authored code, `LICENSE`, `NOTICE`, SBOM/license inventory, source-offer link, public web viewer/issues/CHANGELOG; không bundle sửa dependency. | AGPL metadata/full text/header consistent; asset/model/SDK/image có quyền phân phối; secret scan sạch. |
| P13-T05 | `tests/security`, dependency/container/secret reports, redacted synthetic demo dataset và known-limitations list. | Blocker security/privacy/federation/AI được sửa; QR không private/PII; known gap bắt buộc không bị giấu. |
| P13-T06 | Semver/contest tag + release **trước nộp**, source `.tar.gz`, checksums, image digests, migration/BPMN/schema versions, CI logs và SBOM. | Từ tag rebuild được, restore/rollback thử; release không chỉ `.zip/.rar`, timestamp trước submission receipt. |
| P13-T07 | `documents/demo/runbook.md` 15 phút: core headless, H/P/D/I, A/B/C, Flowable, AI Draft, QR, bốn nguyên lý, nguồn mở; Q&A/tradeoff. | Teammate khác trình diễn theo script từ fresh seed trong thời gian, không mock hoặc gọi simulated OT là production. |
| P13-T08 | `documents/submission/checklist.md` nguồn BTC xác nhận hạn, format/link, team info và receipt thực; contest-scorecard tick có evidence. | Không suy hạn từ PDF 2025, release/repo public trước gửi; push Git không tính đã nộp. |
| P13-T09 | `evidence/G13.md` full AC + four principles + PoF rows với command/fixture/result/reviewer/tag. | Bất kỳ AC/điều kiện bắt buộc fail thì chưa gọi hoàn thành; clean install và backup/restore pass cùng artifact release. |
