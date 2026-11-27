# D11 — Bốn nguyên lý DX-OS và mức minh chứng

- Ngày: 2026-11-16. Trạng thái: **chấp nhận kế hoạch kỹ thuật có rủi ro diễn giải BTC**; **proof map P12-T01:** [`D11-dxos-proof.md`](./D11-dxos-proof.md) (2026-11-27). Bằng chứng runtime T02+ / G12 và xác nhận BTC còn mở.
- Quyết định: bốn nguyên lý §4 được kiểm bằng luồng chạy thực, dữ liệu nguồn và failure injection; không suy tên sản phẩm trong bảng bảy lớp của đề là bắt buộc nguyên xi. Mức tối thiểu Nexora được định nghĩa ở `scope-v1.md`, `phase-12-operability.md`, `core-record-payloads-v1.md`.
- Câu hỏi: với MVP một-org-per-instance, làm sao chứng minh lifecycle dữ liệu, IT/OT, lineage/quality, zero-trust/GitOps mà không tuyên bố các hệ production chưa có?

| Nguyên lý | Kiến trúc được chọn | Bài test để chấp nhận P12 |
| --- | --- | --- |
| Vòng đời/tốc độ | PostgreSQL OLTP commit; outbox sau commit → archive object private với checksum/checkpoint → query/report riêng; không gọi JSON dump đơn lẻ là lakehouse | Kill export worker mà confirm vẫn hoàn tất; restart/replay không nhân bản, query archive theo source ID và đo lag |
| IT/OT | Scanner/temperature **simulated** có device ID, allowlist, UTC timestamp, batch/receipt refs; core record `ot_reading` và UI lot representation có `asOf/lag` | Valid/stale/unknown/duplicate/offline fixture; reading không tự đổi stock/quality; demo ghi rõ mô phỏng |
| Lineage/chất lượng | Trace event/link, issuer-qualified origin, source IDs/version/checksum, quality issue six rules và public projection allowlist | Backward/forward A→B→C, missing/out-of-order/dispute/rebuild; report lần về source và không nâng `partner_asserted` thành verified |
| Zero Trust/GitOps/tự phục hồi | Keycloak+APISIX route public/user/M2M, file quarantine/ClamAV fail-closed, least privilege; k3s+Argo CD **môi trường test** desired state từ Git; backup/restore và worker retry | 401/403/IDOR/SSRF/scan, drift→controller reconcile, kill/restart và restore đo RPO/RTO; Compose+CI không tính GitOps |

Nguồn đề/AC: `scope-v1.md` đối chiếu PDF đề thi §3–4 và thể lệ. **Rủi ro cần người làm thủ công:** hỏi BTC qua kênh chính thức liệu mô phỏng IT/OT, một-org-per-instance thay multi-tenancy tập trung, mức lakehouse/tự phục hồi được chấp nhận; lưu phản hồi ngày/nguồn và sửa scope/gate nếu khác. Không gửi thư thay đội khi chưa được giao. P00-T03 chưa có prototype bốn nguyên lý; ADR chỉ khóa bài test và ranh giới, G12 chưa đạt.
