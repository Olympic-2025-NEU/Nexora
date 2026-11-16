# D03 — PostgreSQL adapter và migration

- Ngày: 2026-11-16. Trạng thái: **chấp nhận cho baseline kỹ thuật P01–P04**; reviewer thứ hai ghi ở G00.
- Quyết định: dùng `pg` + SQL migration có version/checksum, một `PoolClient` được truyền qua các repository trong cùng command. Không dùng `pool.query` trong transaction. `app_runtime`, `core_data`, `migrator` là role khác nhau trong app DB; Keycloak/Flowable có DB/role riêng. Mọi SQL tham số hóa; query mapping có type ở TypeScript.
- Câu hỏi: làm sao document, movement/balance, audit và outbox commit hoặc rollback cùng nhau và cài lại DB mà không chạy lại migration sai?

## Phương án và tiêu chí

| Phương án | Đánh giá |
| --- | --- |
| `pg` + SQL versioned | Ít lớp trừu tượng, kiểm soát transaction/lock/FK và thứ tự migration; cần tự kiểm type/query bằng tests. **Chọn.** |
| Drizzle | Typed schema/query tốt nhưng thêm compiler/ORM migration và nguy cơ hai cơ chế migration khi repo còn SQL scaffold rỗng; có thể chọn lại bằng ADR nếu spike sau chứng minh lợi ích ròng. |
| Prisma hoặc `pool.query` theo repository | Không chọn cho transaction xuyên context; không bảo đảm dùng cùng client nếu repository tự mở connection/transaction. |

Điều kiện runner P01: thay `db/migrations/0001_platform.sql` 0 byte bằng một `0001_platform_core.sql`, table `schema_migrations(version,sha256,applied_at)`, advisory lock chống hai deploy chạy song song, một migration/transaction nếu DDL hỗ trợ; checksum cũ khác file → fail, không sửa migration đã áp dụng. Secret URL ở env/secret store, không log. Rollback bằng migration bù hoặc restore, không giả định migration down tự động an toàn. [node-postgres transactions](https://node-postgres.com/features/transactions) yêu cầu cùng client; [PostgreSQL 17 transactions](https://www.postgresql.org/docs/17/tutorial-transactions.html) xác nhận rollback atomic.

## Spike thực tế

Mã/lệnh lặp lại: [P00-D03 spike](../phase-plan/evidence/spikes/d03/README.md), `pg@8.23.1` trong lockfile riêng, `postgres:17` image digest `sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac`, Docker Engine 29.6.1, Node 24.18.0. Container/DB chỉ test, không ghi app DB. Kết quả 2026-11-16:

```text
result=PASS; PostgreSQL 17.12
migration=applied/unchanged + rerun unchanged + changed checksum rejected
injected failure after outbox: balance 20.000, documents 0, movements 0, audits 0, outbox 0
commit issue 12: balance 8.000, documents 1, movements 1, audits 1, outbox 1
two concurrent issues of 5: exactly one succeeds; final balance 3.000, documents 2, movements 2, audits 2, outbox 2
```

Spike chứng minh primitive, **chưa** chứng minh migrations/app repositories M03 thật, audit nghiệp vụ/retention, idempotency, backup/restore hay role grants. Các gate P01/P03/P07 phải chạy thêm test trên schema thật. RAM image/process đo ở D13; không suy từ size image. Giấy phép `pg`/PostgreSQL và SBOM được rà ở D13/P00-T04, chưa tuyên bố toàn bộ dependency đã đạt AGPL.
