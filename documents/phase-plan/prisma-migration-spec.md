# Prisma migration spec (D03)

Baseline persistence Nexora: **Prisma Client + Prisma Migrate** trên PostgreSQL. Tài liệu này là quy ước thi công; chưa khẳng định `schema.prisma` đã có trong repo.

## 1. Layout đích

```text
nexora/
  prisma/
    schema.prisma          # datasource + generator + models (multi-schema)
    migrations/            # Prisma Migrate history (nguồn duy nhất)
    seed.ts                # optional idempotent seed
  platform/persistence/
    prisma.ts              # singleton PrismaClient
    transaction.ts         # port Transaction.run dùng prisma.$transaction
  contexts/*/infrastructure/
    *Repository.ts         # chỉ đây được inject PrismaClient | TransactionClient
```

Loại bỏ dần `db/migrations/*.sql` thủ công: P01 thay file rỗng `db/migrations/0001_platform.sql` bằng luồng Prisma; không chạy hai migration runners song song.

## 2. `schema.prisma`

- `provider = "postgresql"`.
- Multi-schema: `platform`, `system`, `catalog`, `inventory`, `trading`, `traceability`, `federation` (khớp `database-schema-v1.md`).
- UUID do app sinh; map `Uuid` / `@db.Uuid`.
- Số lượng: `Decimal @db.Decimal(20, 3)`.
- Timestamp: `DateTime @db.Timestamptz(6)`; date nghiệp vụ `@db.Date`.
- `version Int @default(1)` trên aggregate mutable.
- Quan hệ / unique / index theo blueprint schema-v1.
- CHECK phức tạp (regex hash, XOR actor_sub/client_id, …): thêm SQL trong migration (`ALTER TABLE ... ADD CONSTRAINT`) khi Prisma DSL chưa đủ.

## 3. Scripts

| Script | Việc |
| --- | --- |
| `prisma generate` | Sinh Client |
| `prisma migrate dev --name <slug>` | Dev tạo migration |
| `prisma migrate deploy` | CI/compose áp migration |
| `prisma db seed` | Seed idempotent (nếu cấu hình) |

Pin phiên bản `@prisma/client` / `prisma` trong lockfile; không `latest` cho release.

## 4. Transaction bắt buộc

```text
prisma.$transaction(async (tx) => {
  // document confirm
  // inventory.adjust via port(tx)
  // audit.insert(tx)
  // outbox.enqueue(tx)
})
```

- Repository/use case infrastructure nhận `tx`, không gọi singleton bên trong TX.
- Không HTTP/federation/send file bên trong TX.
- Optimistic lock: `updateMany({ where: { id, version: expected }, data: { version: { increment: 1 }, ... } })`; count 0 → 409.

## 5. An toàn SQL

- Mặc định: Prisma Client API.
- `$queryRaw` / `$executeRaw`: chỉ tagged template hoặc values bind; **cấm** nối chuỗi từ query/sort user.
- Sort/filter reporting: allowlist cột trong code.

## 6. Thứ tự nội dung theo phase

| Phase | Nội dung migration |
| --- | --- |
| P01/P03 | `platform` audit, attachment, core_record |
| P04 | idempotency, outbox, approval_request |
| P05 | `system` organization, membership, partner, connection |
| P06 | `catalog`, `inventory`, membership_warehouse |
| P07 | `trading` document/lines/details |
| P08 | `traceability` |
| P09 | `federation` |
| P12 | quality_issue (nếu trong phạm vi) |

Mỗi PR đổi schema: cập nhật `database-schema-v1.md` + migration + test forward từ DB trống.

## 7. Spike P00 (trước khi phụ thuộc P03)

1. Confirm giả lập: insert document + movement + audit + outbox rồi throw → rollback hết.
2. Hai TX cạnh tranh cùng version → một thành công, một 409.
3. `migrate deploy` trên DB trống lặp lại được.
