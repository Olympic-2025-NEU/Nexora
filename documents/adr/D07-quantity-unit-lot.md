# D07 — Lượng, đơn vị và định danh lô

- Ngày: 2026-11-16. Trạng thái: **chấp nhận baseline dữ liệu**; reviewer thứ hai ở G00.
- Quyết định: DB dùng `numeric(20,3)`, JSON dùng decimal string, `EA` chỉ số nguyên không âm, `KG`/`L` tối đa ba chữ số thập phân. `quantity>0` cho nhập/xuất/chuyển/bán, `actual/count` có thể 0; không có stock âm, không quy đổi đơn vị v1. Batch gốc là cặp `(origin_issuer_instance_id,origin_lot_id)` bất biến; batch local/sender có ID khác, không map bằng SKU/tên.
- Câu hỏi: làm sao không lệch số lượng do JavaScript float, làm tròn âm thầm hoặc lô trùng mã giữa doanh nghiệp?

## Lý do và ranh giới

`numeric(20,3)` chứa tối đa 17 chữ số trước dấu thập phân. PostgreSQL **tự làm tròn** scale vượt 3, nên HTTP/domain parser phải reject độ chính xác vượt giới hạn *trước* khi ghi DB; không cho `1.2345` thành `1.235` mà người dùng không biết. Ở JS, giữ string/decimal library, không dùng `Number` để cộng/trừ stock. `EA` cần kiểm `value=trunc(value)` ở domain và constraint/trigger trên line; `KG/L` giữ precision 3. `expires_on < today` theo timezone organization thì chặn issue; ngày hết hạn vẫn dùng tới hết ngày. `stock_balance(warehouse_id,batch_id)` và movement chịu FK product/batch; confirm phải lock theo thứ tự cố định.

Origin lot ID local do server cấp bất biến. `local_code` chỉ unique `(product_id,local_code)` trong instance; `(A,L1)` và `(B,L1)` là hai nguồn. Khi B nhận A, B giữ origin `(A,L1)` nhưng có `senderBatch=(B,B-B1)` riêng; identity mapping chỉ từ verified inbox. D07 ảnh hưởng `database-schema-v1.md`, `api-payloads-v1.md`, `event-payloads-v1.md` và fixture A→B→C.

## Spike và phép thử

PostgreSQL 17.12 trong container D03; lệnh SQL/result:

```text
SELECT '1.2345'::numeric(20,3), '1.2344'::numeric(20,3);
→ 1.235 | 1.234  (lý do phải reject trước DB)
SELECT '100000000000000000.000'::numeric(20,3);
→ ERROR numeric field overflow (absolute value must be < 10^17)
TEMP UNIQUE(issuer,lot_id): (A,L1),(B,L1) → 2 rows;
(A,L1),(A,L1) → duplicate key error.
```

P06/P07 acceptance: parse decimal 0/âm/overflow/4 số lẻ/EA=1.5 bị từ chối đúng code; two concurrent issues không âm stock; actual 10/12 cho B +10; retry không nhân tồn; unit bất biến sau product create. [PostgreSQL numeric](https://www.postgresql.org/docs/17/datatype-numeric.html) là nguồn cho precision/rounding; test trên app schema thật vẫn bắt buộc ở P06/P07.
