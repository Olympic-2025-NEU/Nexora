# MVC ↔ DDD trên Next.js (anti-overcode)

Nexora dùng **DDD Modular Monolith** trên Next.js. Tên MVC chỉ để map trách nhiệm — **không** tạo cây thư mục MVC song song.

## Map lớp

| MVC | Nexora | Được làm | Cấm |
| --- | --- | --- | --- |
| Thin Controller | `app/api/v1/**/route.ts` | Parse body/query (Zod), authz đầu vào, gọi use case, map `DomainError` → HTTP | SQL/Prisma, invariant tồn kho, gọi context khác |
| Service | `contexts/*/application/*` + `domain/*` | Use case điều phối; domain giữ bất biến và state transition | Import Next headers, gọi Prisma trực tiếp |
| Model | `prisma/schema.prisma` + `contexts/*/infrastructure/*Repository.ts` | Schema/relation PG; map row ↔ domain aggregate | Prisma model = aggregate; fat repository cross-context |
| View | `app/(workspace)`, `app/(public)`, `apps/dx-lab` | UI, form Draft, Confirm CTA | Rule nghiệp vụ, CSRF bypass |

```text
RouteHandler → Application UseCase → Domain
                    ↓
              Repository (Prisma.TransactionClient)
                    ↓
              PostgreSQL
```

Wire port/adapter ở `composition/`. `platform/` cung cấp Actor, RBAC helpers, Audit, Outbox, Workflow, Transaction — không biết tên phiếu M03.

## Thin Controller checklist

1. Đọc Actor từ session/token đã verify (không tin body `orgId`/`role`).
2. Validate input bằng Zod/schema cố định.
3. Gọi đúng một use case (hoặc query service đọc).
4. Trả JSON ổn định; lỗi `{ code, message, requestId, details? }`.
5. Với lệnh ghi: tôn trọng `Idempotency-Key` và pipeline trong `CODING_RULES.md`.

## Service / domain

- Một hành động nghiệp vụ = một use case file (ví dụ `confirm-goods-issue.ts`).
- Domain không phụ thuộc Prisma types generated; dùng kiểu domain riêng.
- State chỉ đổi qua hàm action (`confirm`, `cancel`, …).

## Model / Prisma

- `schema.prisma` là nguồn quan hệ bảng; khớp `database-schema-v1.md`.
- Repository:
  - nhận `PrismaClient` hoặc `Prisma.TransactionClient`;
  - map Prisma row → domain;
  - optimistic lock bằng `version` (`updateMany` where id+version).
- Số lượng: `Decimal` / string — không `number` JS cho tồn.
- Reporting/read-model: query service riêng (có thể `$queryRaw` parameterized theo ADR), không nhét join báo cáo vào repository ghi chứng từ.

## Cấm overcode

- Generic CRUD engine / admin generator cho mọi bảng.
- God `*Service.ts` hàng nghìn dòng đa context.
- Gọi `prisma.*` từ `route.ts` hoặc `domain/`.
- Hai ORM hoặc `pg` Pool song song với Prisma.
- Cross-context SQL trong một repository “tiện”.
