# D03 — PostgreSQL adapter và migration (`pg` spike) — SUPERSEDED

- **Status:** **Superseded** (2026-11-17) bởi [`0003-database-prisma.md`](./0003-database-prisma.md)
- **Lý do:** Đội chốt **Prisma Client + Prisma Migrate** làm SoT P01+. Spike `pg`+PoolClient dưới đây chỉ còn giá trị **semantics** (rollback / concurrency / checksum).

## Quyết định cũ (không còn baseline)

Dùng `pg` + SQL migration versioned, một `PoolClient` xuyên repository trong cùng command. Chi tiết phương án/spike gốc giữ nguyên bên dưới để audit lịch sử.

## Spike `pg` (historical PASS)

Mã: [P00-D03 spike](../phase-plan/evidence/spikes/d03/README.md). Kết quả 2026-11-16: rollback mid-TX empty; concurrent issues một thắng.

**Không** dùng để mở P01 với runner SQL song song Prisma.
