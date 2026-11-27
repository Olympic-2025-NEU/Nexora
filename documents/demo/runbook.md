# Demo runbook — 15 phút (Phase 13)

**Audience:** presenter + teammate following from fresh seed.  
**Stack:** Compose instance A (minimum); B/C if RAM allows.  
**Do not** call OT readings or Compose/CI a production twin or GitOps Done.

## Prep (trước giờ demo, ~10–20 phút)

1. Clean install theo [README](../../README.md) / [deploy/README.md](../../deploy/README.md) hoặc reuse project `nexora` đã smoke.
2. Seed synthetic fixtures (`seed.sh` / `seed-abc.mjs` theo [demo-fixtures.md](../phase-plan/demo-fixtures.md)).
3. Flowable BPMN: `bash deploy/scripts/deploy-flowable.sh a <project>`.
4. Optional: `npm run test:e2e:abc` (topology+contract) và `npm run test:e2e:abc:a-api`.
5. Backup path: [backup-restore.md](../../deploy/backup-restore.md); known gaps: [known-limitations.md](../phase-plan/evidence/known-limitations.md).

## Timeline 15 phút

| Phút | Mục tiêu đề thi | Thao tác / lệnh / URL |
| ---: | --- | --- |
| 0–1 | Mở đầu + phạm vi | Nexora = ERP + truy xuất phân tán; **AGPL**; MVP Ch6 — không finance/CRM/POS đầy đủ |
| 1–3 | Lõi headless qua API | `GET {PUBLIC_BASE_URL}/gateway/ping` → 200; `GET /api/v1/health/live` (Bearer nếu 401); OpenAPI `contracts/openapi/nexora-v1.yaml` |
| 3–5 | H-P-D-I (DX-Lab) | Mở DX-Lab (profile `dxlab`): Home / Process / Data / Intelligence — một màn hình mỗi chữ |
| 5–8 | A→B→C DB riêng | Chỉ rõ 3 instance env/ports; nếu chỉ A live: topology assert + giải thích federation; nếu đủ RAM: `DEMO_ONLY=true npm run test:e2e:abc:live` hoặc UI trading A→B→C theo fixtures |
| 8–10 | Flowable thật | Issue goods → Approver khác creator → confirm; REST definition `goods-issue-approval` |
| 10–11 | AI Draft (HITL) | Lot lookup / Draft receipt; **người** sửa/confirm; adversarial suite tồn tại — AI không tự confirm stock |
| 11–12 | QR / passport | Public passport URL allowlist; không PII/balance private |
| 12–14 | Bốn nguyên lý | Lifecycle archive (P12), IT/OT **simulated**, lineage/quality_issue, zero-trust gateway + DR assert — **GitOps = gap** |
| 14–15 | Nguồn mở | LICENSE AGPL, GitHub public, CHANGELOG, SPDX `npm run check:spdx`, source offer trong README |

## Q&A dự kiến (tradeoffs)

| Câu hỏi | Trả lời ngắn trung thực |
| --- | --- |
| Vì sao Modular Monolith? | Một deploy/instance; contexts tách biên; federation giữa org không share DB |
| GitOps? | Compose + CI demo; **không** claim controller k3s/Argo (KL-01) |
| OT production? | **Không** — `simulated:true` only |
| G09/G10? | Technical packages; formal gates **unsigned** |
| AGPL network? | Source tại GitHub branch/tag = commit đang chạy |
| Thiếu dữ liệu / discrepancy? | Actual ≠ sent; partner-asserted ≠ verified |

## Cấm trên sân khấu

- Gọi OT simulated là production digital twin.
- Gọi Compose/CI là GitOps Done.
- Fake BTC confirmation / submission receipt / “máy sạch người khác đã chạy” khi chưa có bằng chứng.
- Chỉnh SQL tay để “đẹp số” trong demo.

## Backup nếu live fail

1. Chiếu output đã đo trong `documents/phase-plan/evidence/p13-t0*.md` + G12.
2. Chạy `npm run test:e2e:abc` (offline topology/contract).
3. Gateway ping + OpenAPI + LICENSE slide.
