# D09 — Ranh giới AI, lựa chọn provider sau

- Ngày: 2026-11-16. Trạng thái: **quyết định ranh giới, provider/model hoãn đến P10**; không chặn P01–P04.
- Quyết định hiện tại: `services/ai/` Python chỉ gọi allowlist API M02/M03/M04 dưới delegated user scope; Draft only, không có tool confirm/approve/SQL. Rule expiry/discrepancy/trace gap deterministic trước LLM. AI là optional profile; ERP và core vẫn hoạt động khi AI down. Không gửi secret/PII tới provider ngoài theo mặc định.
- Chưa chốt: model cụ thể, self-host hay external, giấy phép model/SDK, GPU/RAM, retention/quota, tiếng Việt quality. Chọn bằng spike P10 có version, license/data policy, timeout/fallback, prompt-injection và AC-10/11 tests; không thêm key thật vào Git.
- Nguồn contract hiện hành: `ui-ai-spec-v1.md` và `api-payloads-v1.md`. Reviewer thứ hai và model decision ghi ở G10; không gọi D09 đã đóng cho tích hợp AI.
