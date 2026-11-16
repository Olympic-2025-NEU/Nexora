# D14 — Một chủ sở hữu biến động tồn cho mỗi nghiệp vụ

- Ngày: 2026-11-16. Trạng thái: **chấp nhận baseline nghiệp vụ**, test M03 thật tại P07/G09, reviewer thứ hai G00.
- Quyết định: `GoodsReceipt` cộng lượng nội bộ, `GoodsIssue` trừ lượng sau Flowable approval, `ReceivingConfirmation` cộng **actual** (0 thì không movement), `Stocktake` cộng/trừ variance (0 thì không movement). `PartnerTransfer` và `SaleRecord` chỉ link issue đã confirmed cùng lô/lượng/mục đích; chúng **không** gọi Inventory port lần hai. Một outbound issue purpose transfer gắn tối đa một transfer; issue purpose sale gắn tối đa một sale.
- Câu hỏi: A gửi 12, B nhận 10, C bán 2 thì mỗi đơn vị đổi tồn ở đâu? ACK kỹ thuật không đổi tồn. A receipt20→issue12 còn8; transfer vẫn8. B ACK vẫn0, receiving actual10→10, issue6→4. C receiving6→6, issue sale2→4, sale record vẫn4. Chênh 2 là discrepancy, không tự ghi receipt của 2 chưa nhận.

## Lý do và phép thử chấp nhận

Tách movement ownership ngăn transfer/sale double debit và ACK auto credit. `trading.document` + line/subtype FK/unique ở `database-schema-v1.md` giữ liên kết; `inventory.stock_movement` unique source line/kind, `stock_balance>=0`. Confirm document + movement/balance + audit + outbox cùng app PG transaction, request idempotent. Không sửa confirmed movement; correction là chứng từ mới có source/reason, không có generic reversal xuyên instance trong MVP.

D03 spike đã chứng minh **primitive issue transaction** và rollback/concurrency trên scratch schema; chưa chạy 6 use case thật. P07 acceptance cho từng owner: Draft/cancel/reject không movement; transfer/sale zero movement; receipt +20, issue −12, receiving +10/12, stocktake ±variance; hai confirm song song/retry cùng key chỉ một effect. P09 acceptance A/B/C 8/4/4 và ACK lost/retry không đổi balance. `demo-fixtures.md` là nguồn fixture.
