# PostgreSQL schema v1 — blueprint tạo migration

Đây là **schema đích v1 đã khóa ở mức thiết kế** để AI viết **Prisma schema + Migrate** (D03; xem `prisma-migration-spec.md`); các bảng nghiệp vụ chưa tồn tại trong DB hiện tại. Baseline D03/D07/D14 ở `implementation-baseline.md` áp dụng. Nếu implementation/spike sau này phát hiện khác biệt, sửa ADR, blueprint, contract và migration trong cùng PR trước khi dùng runtime. Dùng một app DB cho một instance; DB Keycloak và Flowable riêng. Không viết `tenant_id` đa org.

## Ký hiệu và quy tắc chung

- Mọi bảng có `id uuid PRIMARY KEY` do application sinh và `created_at timestamptz NOT NULL DEFAULT now()`, trừ bảng nêu khóa ghép hoặc bảng subtype `document_id` làm PK. Bảng mutable thêm `updated_at timestamptz NOT NULL DEFAULT now()` và `version integer NOT NULL DEFAULT 1 CHECK(version>0)` nếu liệt kê. Timestamp `confirmed_at` nullable cho tới confirm.
- Hậu tố `!` = `NOT NULL`, `?` = nullable cho **mọi** kiểu (`text!`, `uuid?`, `numeric(20,3)!`); cột nullable mặc định `NULL`. `uuid→x.y` = FK tới bảng/cột đó, `ON DELETE RESTRICT` mặc định; `jsonb! = '{}'` nghĩa `NOT NULL DEFAULT '{}'::jsonb`. `char(64)` là SHA-256 lowercase hex với `CHECK(value ~ '^[0-9a-f]{64}$')`. Không dùng `ON DELETE CASCADE` với chứng từ, movement, audit, inbox, outbox hay trace. Mã/cookie/token không lưu plaintext khi chỉ cần hash/reference.
- Domain enum lưu `text` + `CHECK` trong migration (giúp version thêm giá trị có migration); mọi enum và giá trị hợp lệ ghi dưới đây. Text code dùng `CHECK(length(trim(value)) BETWEEN 1 AND N)` với N nêu theo bảng. `numeric(20,3)` không âm/khác 0 theo constraint bảng. JSONB validate shape ở application + JSON Schema, không biến JSONB thành chỗ bỏ qua FK.
- ID người dùng là Keycloak `sub text` (không FK để giữ audit sau disable/delete). `instance_id text` do cấu hình instance và organization kiểm soát, không nhận từ request. `request_id`/`correlation_id` text <=128.
- Mỗi migration Prisma tạo bảng/index/constraint trong transaction PG nếu DDL hỗ trợ; file `db/migrations/0001_platform.sql` hiện 0 byte phải được thay bằng `prisma/migrations/` (một nguồn). Không dùng mount `docker-entrypoint-initdb.d` làm cơ chế migration sau lần boot đầu.

## P03/P04 — `platform`

### `platform.audit_log` (P03)

`id`, `created_at`; `actor_sub text?`, `client_id text?`, `action text! (<=100)`, `target_type text! (<=80)`, `target_id text! (<=128)`, `outcome text! CHECK IN ('success','deny','failure')`, `request_id text!`, `correlation_id text?`, `before_summary jsonb! = '{}'`, `after_summary jsonb! = '{}'`. Check `actor_sub IS NOT NULL OR client_id IS NOT NULL`. Index `(target_type,target_id,created_at DESC)`, `(request_id)`, `(created_at DESC)`. Runtime role chỉ `INSERT/SELECT`; không cấp `UPDATE/DELETE`. Secret/token/PII không đi vào summary.

### `platform.attachment` (P03; owner core API)

`id`, `created_at`, `updated_at`, `version`; `owner_type text! CHECK IN ('document','batch','trace_event','core_record')`, `owner_id uuid?` (nullable khi quarantine chưa link), `bucket text! CHECK IN ('quarantine','private','public')`, `object_key text!`, `sha256_hex char(64)!`, `mime_type text!`, `size_bytes bigint! CHECK(size_bytes>0)`, `scan_state text! CHECK IN ('pending','clean','infected','error')`, `visibility text! CHECK IN ('private','partner','public') DEFAULT 'private'`, `created_by_sub text!`, `scanned_at timestamptz?`, `scan_engine_version text?`. Unique `(bucket,object_key)`; index `(owner_type,owner_id)`, `(scan_state,created_at)`. Trạng thái `public` chỉ khi scan clean + sharing policy cho phép, kiểm ở app/core API; không FK đa hình giả.

P03-T04 bổ sung `upload_key_hash char(64)? UNIQUE` và `upload_payload_hash char(64)?` bằng migration bù; cả hai cùng null hoặc cùng hash lowercase. Đây là hash của actor/route/key và payload để upload retry idempotent, không lưu khóa thô. `scan_state='pending'` là tên trạng thái v1 tương ứng "pending_scan" trong checklist T04.

### `platform.core_record` (P03; owner core API)

`id`, `created_at`, `updated_at`, `version`; `kind text! CHECK IN ('evidence_metadata','trace_projection','ot_reading','archive_manifest')`, `source_type text! (<=80)`, `source_id text! (<=256)`, `payload jsonb!`, `visibility text! CHECK IN ('private','partner','public') DEFAULT 'private'`, `policy_version text!`, `checksum_hex char(64)!`, `built_at timestamptz!`. Unique `(kind,source_type,source_id)` để mỗi source có **một current record**; update có `WHERE version=expected`, tăng version/updated_at/checksum atomically. Index `(kind,built_at DESC)`, GIN `(payload)` **chỉ** nếu EXPLAIN/benchmark cần. `ot_reading` và `archive_manifest` là append-only bằng service policy/trigger; `trace_projection` và `evidence_metadata` được update có version/audit. `POST core/records` không nhận arbitrary kind hoặc SQL; mỗi kind có JSON Schema/version và source key ở `core-record-payloads-v1.md`. `trace_projection`, `ot_reading`, `archive_manifest` chỉ service identity có quyền ghi; user chỉ tạo `evidence_metadata` với owner/resource scope.

### `platform.idempotency_record` (P04)

`id`, `created_at`; `actor_or_client text!`, `method text!`, `route_key text!`, `idempotency_key text!`, `payload_sha256 char(64)!`, `state text! CHECK IN ('processing','completed','failed')`, `response_status smallint?`, `response_body jsonb?`, `resource_id uuid?`, `expires_at timestamptz!`. Unique `(actor_or_client,method,route_key,idempotency_key)`; index `(expires_at)`. Giữ row/lock trong transaction command; completed response trả lại khi retry, cùng key khác hash 409. Chốt retention ở P04, không xóa đang processing.

### `platform.outbox_message` (P04)

`id`, `created_at`; `aggregate_type text!`, `aggregate_id uuid!`, `aggregate_version integer!`, `event_type text!`, `schema_version text!`, `payload jsonb!`, `destination text!`, `correlation_id text!`, `status text! CHECK IN ('pending','leased','retry_due','delivered','dead_letter') DEFAULT 'pending'`, `attempt_count integer! DEFAULT 0 CHECK(attempt_count>=0)`, `next_attempt_at timestamptz! DEFAULT now()`, `lease_owner text?`, `lease_until timestamptz?`, `last_error_code text?`, `delivered_at timestamptz?`. Unique `(aggregate_type,aggregate_id,aggregate_version,event_type,destination)`; partial index `(next_attempt_at,created_at) WHERE status IN ('pending','retry_due')`; index `(correlation_id)`. Worker dùng `FOR UPDATE SKIP LOCKED`, lease hết hạn được reclaim.

### `platform.approval_request` (P04; FK document thêm P07)

`id`, `created_at`, `updated_at`, `version`; `document_id uuid!` (P07 thêm FK `trading.document.id`), `process_key text! DEFAULT 'goods-issue-approval'`, `process_definition_version integer?`, `flowable_process_id text?`, `flowable_task_id text?`, `state text! CHECK IN ('requested','starting','pending','decision_pending','approved','rejected','cancelled','failed')`, `creator_sub text!`, `decision_intent text? CHECK IN ('approved','rejected')`, `decision_requested_by_sub text?`, `decision_requested_at timestamptz?`, `approver_sub text?`, `decision_reason text?`, `decided_at timestamptz?`, `correlation_key text!`, `submitted_document_version integer! CHECK(submitted_document_version>0)`, `line_snapshot_sha256 char(64)!`. CHECK ba field `decision_intent/decision_requested_by_sub/decision_requested_at` cùng NULL hoặc cùng non-NULL; `state='decision_pending'` bắt cả ba non-NULL. Unique `(document_id)`, `(correlation_key)`, partial unique `(flowable_process_id) WHERE flowable_process_id IS NOT NULL`; index `(state,created_at)`. Hash tính từ `{lineNo,warehouseId,productId,batchId,quantity,unit}` theo thứ tự `lineNo`, JCS UTF-8; status/version document có thể tăng sau submit, nên confirm so **hash lines đã duyệt** và current `If-Match` riêng, không so current version với submitted version. Flowable down giữ `requested/starting/decision_pending`; không tự approved.

## P05 — `system`

### `system.organization`

`id`, `created_at`, `updated_at`, `version`; `singleton_slot smallint! DEFAULT 1 CHECK(singleton_slot=1) UNIQUE`, `instance_id text! UNIQUE`, `code text! UNIQUE (<=40)`, `name text! (<=200)`, `contact_email text?`, `contact_phone text? (<=40)`, `address text? (<=500)`, `timezone text! DEFAULT 'Asia/Ho_Chi_Minh'`, `status text! CHECK IN ('active','suspended') DEFAULT 'active'`. Không có row thứ hai cùng DB; `instance_id` bất biến sau bootstrap.

### `system.membership`

`id`, `created_at`, `updated_at`, `version`; `keycloak_sub text! UNIQUE`, `display_name text! (<=160)`, `email text?`, `role text! CHECK IN ('administrator','staff','approver','viewer')`, `status text! CHECK IN ('invited','active','disabled')`, `last_synced_at timestamptz?`. Không password. Warehouse scope ở bảng join P06 để có FK thật. Nếu cần nhiều vai cho một user, phải có ADR + migration `membership_role`; v1 một vai chính. Index `(role,status)`.

### `system.partner`

`id`, `created_at`, `updated_at`, `version`; `issuer_instance_id text! UNIQUE`, `code text! UNIQUE (<=40)`, `display_name text! (<=200)`, `status text! CHECK IN ('active','suspended')`, `contact_email text?`, `created_by_sub text!`. URL/secret thuộc connection, không ở bảng này.

### `system.partner_connection`

`id`, `created_at`, `updated_at`, `version`; `partner_id uuid!→system.partner.id UNIQUE`, `endpoint_url text!` (URL API remote cho outbound), `outbound_token_url text!` (token endpoint của realm remote), `outbound_client_id text!` (remote cấp cho local), `outbound_secret_ref text!`, `outbound_audience text!`, `inbound_client_id text!` (local Keycloak cấp cho remote), `allowed_inbound_scope text! DEFAULT 'federation:write'`, `status text! CHECK IN ('active','rotating','disabled')`, `last_verified_at timestamptz?`, `rotated_at timestamptz?`. Unique `(inbound_client_id)` trong local realm; outbound client ID có thể lặp giữa các remote realm nên unique phải theo `(partner_id,outbound_client_id)` nếu thêm. Receiver map verified token `client_id=inbound_client_id`→partner; sender dùng `outbound_token_url/client_id/secret_ref` lấy token từ remote. Secret inbound nằm trong Keycloak/secret store, không ở app DB. HTTPS/host allowlist/SSRF validation áp dụng cho **cả hai URL** ở app + test, không CHECK regex DB thay kiểm DNS.

## P06 — `catalog` và `inventory` (baseline G06 — **superseded for product identity by P065**)

P06 shipped `product.sku` + `base_unit`∈{EA,KG,L} + `product_identifier`. **Target SoT after P065 / ADR 0017** is § P065 below. Keep P06 rows historically as what G06 closed; do not implement new features on P06 product.sku.

### `catalog.product` (P06 historical)

`id`, `created_at`, `updated_at`, `version`; `sku text! UNIQUE (<=64)`, `name text! (<=200)`, `description text?`, `base_unit text! CHECK IN ('EA','KG','L')`, `status text! CHECK IN ('active','archived') DEFAULT 'active'`, `created_by_sub text!`. SKU và unit bất biến từ create ở v1; index `(status,name)`.

### `catalog.product_identifier` (P06 historical — dropped in P065)

`id`, `created_at`; `product_id uuid!→catalog.product.id`, `kind text! CHECK IN ('ean13','internal_barcode')`, `value text! (<=128)`, `is_primary boolean! DEFAULT false`. Unique `(kind,value)`; partial unique `(product_id,kind) WHERE is_primary`.

### `catalog.batch` (P06; P065 adds `product_variant_id`)

`id`, `created_at`, `updated_at`, `version`; `product_id uuid!→catalog.product.id`, `local_code text! (<=80)`, `origin_issuer_instance_id text!`, `origin_lot_id text!`, `manufactured_on date?`, `expires_on date?`, `quality_status text! CHECK IN ('available','restricted','inspect') DEFAULT 'inspect'`, `source_partner_id uuid?→system.partner.id`, `created_by_sub text?`, `created_by_client_id text?`; CHECK `((created_by_sub IS NOT NULL) <> (created_by_client_id IS NOT NULL))`. Unique `(product_id,local_code)`, `(origin_issuer_instance_id,origin_lot_id)`; unique `(id,product_id)`. CHECK `(manufactured_on IS NULL OR expires_on IS NULL OR manufactured_on<=expires_on)`.

## P065 — Catalog upgrade (ADR 0017 / D17) — **target SoT before P07**

Pack: [`evidence/p065-schema-design.md`](./evidence/p065-schema-design.md). Soft-delete = `deleted_at`; commercial flags = `is_active`.

### `catalog.category`

`id`, timestamps, `version`; `code text! UNIQUE (<=64)`, `name text! (<=200)`, `name_normalized text!`, `parent_id uuid?→category.id` CHECK ≠ self, `sort_order int! DEFAULT 0`, `is_active boolean! DEFAULT true`, `deleted_at timestamptz?`, `created_by_sub text!`. Depth ≤8 / no cycles (app + trigger). Filter products: recursive CTE over descendants.

### `catalog.uom`

`id`, timestamps, `version`; `code text! UNIQUE (<=32)`, `name text! (<=64)`, `name_key text! UNIQUE (<=32)`, `kind text! CHECK IN ('count','mass','volume')`, `is_system_default boolean! DEFAULT false`, `is_active boolean! DEFAULT true`, `deleted_at timestamptz?`. Partial unique exactly one `is_system_default`. Seed `CÁI`/`CAI`; also `KG`,`L` for backfill.

### `catalog.product` (target)

`id`, timestamps, `version`; `name text! (<=200)`, `search_text text! DEFAULT ''`, `attributes jsonb! DEFAULT '{}'`, `category_id uuid!→category.id`, `is_active boolean! DEFAULT true`, `deleted_at timestamptz?`, `created_by_sub text!`. **Forbidden:** `sku`, `barcode`, `base_unit`.

### `catalog.product_variant`

`id`, timestamps, `version`; `product_id uuid!→product.id`, `sku text? (<=64)`, `barcode text? (<=128)`, `is_primary boolean! DEFAULT false`, `is_active boolean! DEFAULT true`, `deleted_at timestamptz?`, `created_by_sub text!`. CHECK `(sku IS NOT NULL OR barcode IS NOT NULL)`. Partial unique non-null `sku`; non-null `barcode`; one primary per product where `is_primary AND deleted_at IS NULL AND is_active`.

### `catalog.variant_code`

`code text PK`, `variant_id uuid!→product_variant.id`, `source text! CHECK IN ('sku','barcode','both')`. Maintains cross-field uniqueness (sku of A ≠ barcode of B); same variant may use `sku=barcode` with `source=both`. Soft-delete keeps rows.

### `catalog.product_variant_uom`

`id` (or composite); `product_variant_id`, `uom_id`; UNIQUE `(product_variant_id,uom_id)`; `is_stock_keeping boolean!`; `factor_to_stock_uom numeric(20,3)! CHECK >0`; partial unique one stock-keeping per variant; stock row requires factor=1.

### `catalog.product_image`

`id`, `product_id`, `attachment_id→platform.attachment.id`, `sort_order`, `is_primary`, `deleted_at`, timestamps. No BLOB; `variant_id` deferred NULL.

### `catalog.price_list`

`id`, timestamps, `version`; `code text? UNIQUE where NOT NULL`, `name text!`, `is_default boolean! DEFAULT false`, `valid_from timestamptz!`, `valid_to timestamptz?`, `is_active boolean! DEFAULT true`, `currency char(3)!`, `deleted_at`, `created_by_sub`. CHECK `(code IS NULL) OR (NOT is_default)`; `valid_to IS NULL OR valid_to > valid_from`. Partial unique one active default among `code IS NULL`.

### `catalog.price_list_item`

`id`, `price_list_id`, `product_variant_id`, `uom_id`, `price_type text! CHECK IN ('purchase','retail','wholesale')`, `amount numeric(20,3)! CHECK >=0`, `is_active boolean! DEFAULT true`. UNIQUE `(price_list_id, product_variant_id, uom_id, price_type)`. uom ∈ that variant’s `product_variant_uom`.

### `catalog.batch` (P065)

Add `product_variant_id uuid!→product_variant.id`; keep `product_id` denormalized (= variant.product_id). UNIQUE `(product_variant_id, local_code)`; UNIQUE `(id, product_variant_id)` for stock FK; keep origin pair unique.

### `inventory.warehouse`

`id`, `created_at`, `updated_at`, `version`; `code text! UNIQUE (<=40)`, `name text! (<=160)`, `status text! CHECK IN ('active','archived')`, `created_by_sub text!`. Không archive khi còn balance >0.

### `system.membership_warehouse` (P06 FK muộn)

**Composite PK `(membership_id,warehouse_id)`, không có `id`**. `membership_id uuid!→system.membership.id`, `warehouse_id uuid!→inventory.warehouse.id`, `created_at timestamptz! DEFAULT now()`. Join grant theo warehouse, không lưu array ID không FK. Administrator có quyền toàn instance theo policy, Staff/Approver lấy scope từ join; thu hồi row có hiệu lực lần check kế tiếp. Index `(warehouse_id,membership_id)`.

### `inventory.stock_balance`

**Không có `id`; PK `(warehouse_id,batch_id)`**. `warehouse_id uuid!→inventory.warehouse.id`, `batch_id uuid!`, `product_id uuid!` (denorm), **`product_variant_id uuid!` (P065)**, `quantity numeric(20,3)! DEFAULT 0 CHECK(quantity>=0)`, `version integer! DEFAULT 1 CHECK(version>0)`, `updated_at timestamptz! DEFAULT now()`; FK `(batch_id,product_variant_id)→catalog.batch(id,product_variant_id)` sau P065 (P06: `(batch_id,product_id)`). Index `(product_variant_id,batch_id)`, `(warehouse_id,product_variant_id)`. Chỉ Inventory port ghi; qty luôn ĐVT gốc variant. `INSERT ... ON CONFLICT`/row lock `(warehouse_id,batch_id)`.

### `inventory.stock_movement`

`id`, `created_at`; `warehouse_id`, `batch_id`, `product_id` (denorm), **`product_variant_id` (P065)**, `source_line_id uuid!` (FK `trading.document_line.id` thêm P07), `kind text! CHECK IN ('receipt','issue','receiving','stocktake')`, `delta numeric(20,3)! CHECK(delta<>0)`, `balance_after numeric(20,3)! CHECK(balance_after>=0)`, `actor_sub text!`, `correlation_id text!`, `reversal_of uuid?→inventory.stock_movement.id`; FK `(batch_id,product_variant_id)→batch` sau P065. Unique `(source_line_id,kind)`; index `(batch_id,created_at DESC)`, `(warehouse_id,batch_id,created_at DESC)`. Append-only runtime.

## P07 — `trading` (một header/line chung, subtype rõ)

`goods_receipt`, `goods_issue`, `partner_transfer`, `receiving_confirmation`, `stocktake`, `sale_record` là **giá trị `document_type`**, không phải sáu bảng header trùng lặp. Cấu trúc này chốt lựa chọn bỏ ngỏ ở P07-T02. Business action vẫn là sáu use case/route riêng. Bảng subtype giữ dữ liệu chỉ có ở transfer/receiving/sale.

### `trading.document`

`id`, `created_at`, `updated_at`, `version`; `document_type text! CHECK IN ('goods_receipt','goods_issue','partner_transfer','receiving_confirmation','stocktake','sale_record')`, `issue_purpose text? CHECK IN ('partner_transfer','sale','other')`, `document_number text! (<=64)`, `status text! CHECK IN ('draft','pending_approval','approved','confirmed','cancelled','rejected') DEFAULT 'draft'`, `created_by_sub text!`, `confirmed_by_sub text?`, `confirmed_at timestamptz?`, `cancelled_at timestamptz?`, `note text?`, `correction_of_document_id uuid?→trading.document.id`, `correction_reason text?`, `correlation_id text!`. CHECK `(document_type='goods_issue') = (issue_purpose IS NOT NULL)` và `(correction_of_document_id IS NULL) = (correction_reason IS NULL)` và `(correction_reason IS NULL OR length(trim(correction_reason))>0)`; unique `(document_type,document_number)`; index `(status,created_at DESC)`, `(document_type,created_at DESC)`, `(correction_of_document_id)`. CHECK `(status='confirmed') = (confirmed_at IS NOT NULL AND confirmed_by_sub IS NOT NULL)`; các transition phức tạp ở domain + optimistic version. Correction là chứng từ **mới** với reason, không tự tạo reversal; use case kiểm loại correction hợp lệ và không tham chiếu chính mình. `document_number` server tạo từ prefix type+date+12 ký tự UUID (không cần sequence table); khi trùng, caller T03 retry toàn bộ transaction (tối đa ba lần), không retry trong repository.

### `trading.document_line`

`id`, `created_at`; `document_id uuid!→trading.document.id`, `line_no integer! CHECK(line_no>0)`, `warehouse_id uuid!→inventory.warehouse.id`, `batch_id uuid!`, **`product_variant_id uuid!→catalog.product_variant.id` (sau P065; không còn giả định SKU trên product)**, `product_id uuid!` (denorm = variant.product_id), `quantity numeric(20,3)? CHECK(quantity>=0)`, `actual_quantity numeric(20,3)? CHECK(actual_quantity>=0)`, `counted_quantity numeric(20,3)? CHECK(counted_quantity>=0)`, `uom_id uuid!→catalog.uom.id` (qty nhập có thể packing; **server convert → stock UOM trước Inventory port**), `source_issue_line_id uuid?→trading.document_line.id` (transfer/sale copy từ issue local), `source_line_ref uuid?` (receiving giữ `sourceLineId` của transfer remote; **không** FK xuyên instance). FK `(batch_id,product_variant_id)→catalog.batch(id,product_variant_id)`; unique `(document_id,line_no)`, `(id,document_id)`, partial unique `(document_id,source_issue_line_id) WHERE source_issue_line_id IS NOT NULL` và `(document_id,source_line_ref) WHERE source_line_ref IS NOT NULL`; index `(batch_id,document_id)`. `quantity` là lượng gửi với receiving, `actual_quantity` là lượng nhận thực, `counted_quantity` chỉ stocktake. DB deferred constraint trigger P07 chặn confirmed document không có line, thiếu field theo type, uom ∉ variant_uoms, transfer/sale line không khớp issue; receiving bắt từng `source_line_ref`, `0<=actual_quantity<=quantity`. Trigger chạy ở commit để không chặn Draft; confirm use case validate sớm.

### `trading.issue_source_allocation` (P08 closure)

`id uuid PK`, `issue_line_id uuid!→trading.document_line.id ON DELETE CASCADE`, `source_line_id uuid!→trading.document_line.id ON DELETE RESTRICT`, `quantity numeric(20,3)! CHECK(quantity>0)`. Unique `(issue_line_id,source_line_id)`, index `(source_line_id)`. Nguồn phải là dòng của GoodsReceipt hoặc ReceivingConfirmation đã confirmed, cùng warehouse/batch/product/variant và stock UOM với dòng GoodsIssue. Số lượng của tất cả nguồn trên **mỗi** dòng xuất phải đúng bằng lượng đã normalize sang stock UOM; tổng các dòng xuất đã confirmed dùng một dòng nguồn không vượt số thực nhập (`quantity` của receipt hoặc `actual_quantity` của receiving). Application khóa các dòng nguồn theo UUID trước khi kiểm để hai issue confirm đồng thời không overallocate; deferred DB constraint kiểm lại khi commit. Phân bổ chỉ được tạo/xóa khi issue còn Draft; sau đó bất biến. Issue cũ hoặc tạo không khai báo phân bổ vẫn được confirm để giữ tương thích, nhưng trace hiển thị `local_allocation_unknown`, tuyệt đối không suy ra FIFO từ số dư.

### `trading.transfer_detail`

`document_id uuid PK→trading.document.id`, `linked_issue_id uuid!→trading.document.id` (index, không UNIQUE thuần), `destination_partner_id uuid!→system.partner.id`, `delivery_state text! CHECK IN ('pending','technical_ack','awaiting_receipt','received','partial','disputed') DEFAULT 'pending'`, `technical_ack_at timestamptz?`, `business_receipt_at timestamptz?`. Deferred constraint trigger trên detail/status bảo đảm tối đa một transfer chưa huỷ mỗi issue; create khoá row issue trước khi kiểm tra/insert. Cancel draft giữ lịch sử nhưng giải phóng issue, confirmed chiếm issue vĩnh viễn. Trigger/use case bảo đảm `document_type='partner_transfer'`, linked issue type `goods_issue` với `issue_purpose='partner_transfer'`, cả hai confirmed trước gửi, line/lot/quantity khớp 1:1.

### `trading.receiving_detail`

`document_id uuid PK→trading.document.id`, `source_issuer_instance_id text!`, `source_transfer_id text!`, `inbound_message_id uuid?` (P09 thêm FK→`federation.inbox_message.id`), `sent_quantity numeric(20,3)! CHECK(sent_quantity>0)`, `actual_quantity numeric(20,3)? CHECK(actual_quantity>=0)`, `discrepancy_reason text?`; unique `(source_issuer_instance_id,source_transfer_id)`. Khi confirmed: `sent_quantity=SUM(document_line.quantity)` và `actual_quantity=SUM(document_line.actual_quantity)`; từng line map đúng `source_line_ref` của transfer đã xác thực và `catalog.batch` local map cùng origin lot/product/unit, không bỏ sót hay thêm line nguồn. `actual<=sent` ở v1 (over-receipt phải dispute, không cộng tồn tự động), reason bắt buộc nếu khác sent. 0 actual tạo confirmed discrepancy nhưng **không** tạo movement `delta=0`. Tổng và mapping được kiểm ở use case + deferred constraint trigger khi confirm; liên kết inbox/lot nguồn được kiểm ở application vì P07 chưa có bảng federation.

### `trading.sale_detail`

`document_id uuid PK→trading.document.id`, `linked_issue_id uuid!→trading.document.id UNIQUE`, `buyer_ref text?`, `sold_at timestamptz!`; trigger/use case kiểm type sale/issue với `issue_purpose='sale'` và lot/quantity khớp. Không payment, price, tax hoặc PII buyer trong MVP.

Stocktake dùng `document` + `document_line.counted_quantity`; variance = counted − balance snapshot dưới lock khi confirm, lưu `stock_movement.delta` nếu khác 0. Nếu variance=0 vẫn confirm/audit/trace nhưng không tạo zero movement. Receipt nhập nội bộ, issue và receiving theo D14. Confirmed document và lines **không UPDATE/DELETE** ở runtime (trigger + grants); sửa sai qua chứng từ bù mới có `correction_of_document_id`/reason và quy trình duyệt bình thường khi là issue. `stock_movement.reversal_of` chỉ dùng nếu ADR thiết kế exact reversal 1:1; MVP không có generic reversal API hoặc tự hoàn tác transfer xuyên instance.

### P07-T02 — hợp đồng lỗi DB cho T03

Thông điệp `trading_confirm:<mã>` phát ra từ trigger; CHECK/FK/unique trả tên constraint theo PostgreSQL. Trigger deferred trên cả năm bảng chạy khi commit, chỉ kiểm tra chứng từ hiện `confirmed`. Trigger BEFORE khóa confirmed ngay; line/detail được thêm sau lần đổi status trong **cùng transaction** trước commit, nhưng không được thêm ở transaction sau. `transfer_detail` đã confirmed chỉ được đổi `delivery_state`, `technical_ack_at`, `business_receipt_at`.

| Mã luật | Điều kiện bị từ chối | Bảng/cột |
| --- | --- | --- |
| `no_lines` | Confirm không có dòng | `document.id`, `document_line.document_id` |
| `missing_line_field` | Dòng thiếu `quantity` (trừ stocktake), `counted_quantity` (stocktake), `actual_quantity`/`source_line_ref` (receiving), hoặc `source_issue_line_id` (transfer/sale) | `document_line` |
| `product_mismatch` | Snapshot `product_id` khác product của variant/batch | `document_line.product_id`, `catalog.product_variant`, `catalog.batch` |
| `uom_not_allowed` | UOM không nằm trong variant_uoms | `document_line.uom_id`, `catalog.product_variant_uom` |
| `missing_detail` | Thiếu subtype tương ứng hoặc thiếu total actual khi receiving | `transfer_detail`, `sale_detail`, `receiving_detail.actual_quantity` |
| `issue_not_confirmed` | Transfer/sale trỏ issue chưa confirmed | `transfer_detail.linked_issue_id`, `sale_detail.linked_issue_id`, `document.status` |
| `line_mismatch` | Transfer/sale không sao chép đủ, đúng từng dòng issue (line_no, kho, lot, variant, product, UOM, quantity) | `document_line.source_issue_line_id` và các cột line |
| `actual_out_of_range` | Receiving actual vượt sent theo dòng hoặc tổng | `document_line.quantity`, `document_line.actual_quantity`, `receiving_detail.sent_quantity`, `receiving_detail.actual_quantity` |
| `receiving_total_mismatch` | Tổng quantity hoặc actual dòng không bằng detail | `document_line.quantity`, `document_line.actual_quantity`, `receiving_detail.sent_quantity`, `receiving_detail.actual_quantity` |
| `discrepancy_reason_required` | Tổng actual khác sent và reason rỗng | `receiving_detail.discrepancy_reason` |
| `detail_type` | Subtype không khớp document_type | `transfer_detail`, `receiving_detail`, `sale_detail`, `document.document_type` |
| `issue_purpose` | Linked issue sai type hoặc purpose | `transfer_detail.linked_issue_id`, `sale_detail.linked_issue_id`, `document.issue_purpose` |
| `immutable_document` | UPDATE/DELETE header đã confirmed | `document` |
| `immutable_line` | UPDATE/DELETE line confirmed hoặc INSERT line vào confirmed ở transaction sau | `document_line` |
| `immutable_detail` | INSERT/DELETE detail confirmed hoặc UPDATE ngoài ba cột delivery được phép | `transfer_detail`, `receiving_detail`, `sale_detail` |

CHECK đặt tên `ck_trading_*`, unique `uq_trading_*` và FK `fk_trading_*` (một số FK inline dùng tên mặc định PostgreSQL). `uq_trading_one_active_correction` loại `status='cancelled'` khỏi unique; `uq_trading_document_number` là unique `(document_type,document_number)`. `document_line.product_id` là snapshot denorm từ variant tại lúc ghi line; `document_number` bất biến sau confirmed. Không snapshot giá, tên partner hoặc tên UOM.

Migration thực là `prisma/migrations/20261123010000_trading_documents/migration.sql` (thay tên khái niệm `0006_trading.sql`). Prisma schema là hình chiếu generate client; CHECK, partial unique và triggers **chỉ** sống trong SQL migration. Migration tiếp theo không được sinh lại bảng trading từ Prisma schema rồi làm mất ràng buộc này.

**D14 đóng ở tầng contract P07-T01** ([evidence](./evidence/p07-t01.md)); runtime cần T02/T03/T07/T08 và cross-instance P09. Status chứng từ, state bridge phê duyệt và stock effect là ba trục riêng: `approved` là đã qua duyệt, chưa ghi tồn; chỉ `confirmed` mới có thể ghi movement. `draft/cancelled/rejected` không ghi tồn. Một GoodsIssue có `issue_purpose` duy nhất bất biến từ lúc tạo; transfer chỉ được link issue purpose `partner_transfer`, sale chỉ link purpose `sale`. Mỗi link giữ UNIQUE 1–1 riêng như trên; purpose ngăn dùng chung issue cho cả transfer và sale. Transfer/sale copy chính xác từng source issue line (lot/qty/UOM/variant), không chỉ tổng số. GoodsReceipt (+) **chỉ** nhập nội bộ; hàng chuyển từ đối tác chỉ nhập qua ReceivingConfirmation (+ actual) một lần, không thêm GoodsReceipt cho cùng lô hàng đó.

| `document_type` | Confirm movement `kind` | `delta` | Nguồn ghi tồn |
| --- | --- | --- | --- |
| `goods_receipt` | `receipt` | `+quantity` | Nhập nội bộ, không phải partner transfer |
| `goods_issue` | `issue` | `−quantity` | Chỉ sau local approval approved + hash dòng + current warehouse scope |
| `partner_transfer` | none | none | Tham chiếu issue confirmed, không trừ lần hai |
| `receiving_confirmation` | `receiving` | `+actual_quantity` (zero: no movement) | Một lần cho nguồn transfer; từng source line không bỏ sót |
| `stocktake` | `stocktake` | `counted_quantity − balance_at_confirm` (zero: no movement) | Balance đọc dưới lock tại confirm, không nhập expected |
| `sale_record` | none | none | Tham chiếu issue confirmed, không trừ lần hai |

Correction phải cùng type, trỏ chứng từ confirmed liền trước, có reason khác rỗng, mỗi predecessor tối đa một correction chưa cancel tại một thời điểm (T02 index có điều kiện, T03 guard cùng transaction). Correction của correction hợp lệ; movement theo dòng correction, không tự hoàn tác gốc hoặc cascade transfer/sale. GoodsIssue correction vẫn qua approval. Confirm tại T03/T08 dùng command pipeline P04 (`Idempotency-Key`, current `If-Match`), ghi document + movement/balance + audit + outbox atomic; cancel pending đồng thời tombstone approval request ở T07. V1 không có auto-expiry, pending tới decision/cancel.

## P08 — `traceability`

### `traceability.trace_event`

`id`, `created_at`; `issuer_instance_id text!`, `external_event_id text!`, `event_type text!`, `batch_id uuid?→catalog.batch.id`, `document_id uuid?→trading.document.id`, `source_message_id uuid?` (P09 thêm FK inbox), `origin_issuer_instance_id text!`, `origin_lot_id text!`, `occurred_at timestamptz!`, `verification_state text! CHECK IN ('local_verified','partner_asserted','missing')`, `payload_version text!`, `summary jsonb!`, `evidence_refs uuid[]! DEFAULT '{}'` (attachment IDs, T07 kiểm tra scan/visibility trước khi công bố; không giả FK đa hình), `checksum_hex char(64)!`. Unique `(issuer_instance_id,external_event_id)`; index `(batch_id,occurred_at)`, `(origin_issuer_instance_id,origin_lot_id,occurred_at)`. Không UPDATE/DELETE event; correction event mới tham chiếu cũ trong summary/schema.

### `traceability.trace_link`

`id`, `created_at`; `from_event_id uuid!→traceability.trace_event.id`, `to_event_id uuid?→traceability.trace_event.id`, `missing_ref jsonb?`, `relation text! CHECK IN ('derived_from','transferred_to','received_from','sold_as','corrects')`, `verification_state text! CHECK IN ('local_verified','partner_asserted','missing')`, `allocation_detail jsonb?` chỉ trên local `derived_from` edge; CHECK `((to_event_id IS NOT NULL) <> (missing_ref IS NOT NULL))`; partial unique `(from_event_id,to_event_id,relation) WHERE to_event_id IS NOT NULL` và `(from_event_id,relation,missing_ref) WHERE to_event_id IS NULL`; index `(to_event_id)`. `allocation_detail` là mảng `{issueLineId,sourceLineId,quantity}` theo stock UOM, dựng từ `trading.issue_source_allocation` đã confirmed. `missing_ref` là JSON canonical `{issuerInstanceId,eventId}` theo schema, không object tùy ý. App chống cycle/depth; unique index dedupe gap marker.

### `traceability.passport_projection`

`id`, `created_at`, `updated_at`, `version`; `batch_id uuid!→catalog.batch.id UNIQUE`, `public_payload jsonb!`, `source_event_ids uuid[]!`, `policy_version text!`, `built_at timestamptz!`, `state text! CHECK IN ('active','revoked','stale')`, `checksum_hex char(64)!`. Chỉ chứa allowlist public; index `(state,built_at)`.

### `traceability.passport_policy` (P08-T05)

`id uuid!`, `created_at timestamptz!`, `batch_id uuid!→catalog.batch.id`, `policy_version integer!>0`, `state text! CHECK IN ('draft','approved','revoked')`; năm cột visibility `organization_visibility`, `product_visibility`, `batch_visibility`, `timeline_visibility`, `evidence_visibility` đều `private|partner|public`, mặc định private. `created_by_sub text!`, `approved_by_sub/approved_at` và `revoked_by_sub/revoked_at` nullable theo state. Unique `(batch_id,policy_version)`, một draft và một approved tối đa trên mỗi lô. Chỉ Administrator trong organization được duyệt/revoke; giữ các phiên bản cũ và audit, không ghi đè policy đã duyệt. Projection chỉ active khi lô `available`, policy approved và organization/product/batch đều public; timeline chỉ xuất nếu public, evidence T07 yêu cầu attachment clean và quyền public riêng. New trace outbox/event làm projection stale, quality change revoke; rebuild thủ công từ nguồn đã confirm. API public T06 phải đọc `state=active` và đặt `no-store`, không cache payload cũ.

### `traceability.qr_token`

`id`, `created_at`; `batch_id uuid!→catalog.batch.id`, `token_hash char(64)! UNIQUE`, `policy_version text?`, `issuance_key_hash char(64)? UNIQUE`, `state text! CHECK IN ('active','revoked')`, `expires_at timestamptz?`, `revoked_at timestamptz?`, `created_by_sub text!`; index `(batch_id,state)`. T06 phát hành 32 byte random, encode base64url 43 ký tự; DB chỉ giữ SHA-256 token và SHA-256 của actor+batch+`Idempotency-Key`. URL `/passport/{token}` không chứa batch UUID. Token có hạn 30 ngày; gọi lại cùng key trả 409 vì raw token chỉ trả một lần. Policy version đổi hoặc projection bị revoke thì trigger thu hồi token active; public GET còn kiểm tra active policy, projection, checksum, quality, expiry tại thời điểm đọc. Retain token hash để audit/denylist; không lưu raw URL.

### `traceability.trace_evidence` và `trace_evidence_access` (P08-T07)

`trace_evidence`: `id uuid PK`, `created_at`, `event_id uuid!→trace_event.id`, `document_id uuid!→trading.document.id`, `attachment_id uuid!→platform.attachment.id`, `checksum_hex char(64)!`, `visibility private|partner|public`, `state active|revoked`, `created_by_sub`, `revoked_at`; unique `(event_id,attachment_id)`, index `(document_id,state)`. Trigger INSERT chỉ nhận event local verified thuộc chứng từ confirmed, đúng document, attachment sạch trong bucket private với SHA-256 khớp. Link không được sửa nguồn/visibility/checksum; chỉ chuyển active→revoked. INSERT/revoke hoặc thay đổi scan/bucket/checksum của file làm Passport projection stale. Bảng link tách khỏi `trace_event.evidence_refs` append-only, giữ nguyên provenance gốc.

`trace_evidence_access`: `id uuid PK`, `created_at`, `token_hash char(64)! UNIQUE`, `qr_token_id uuid!→qr_token.id`, `evidence_id uuid!→trace_evidence.id`, `expires_at timestamptz!` tối đa 120 giây theo constraint; runtime phát hành 60 giây và giới hạn 10 link mỗi Passport. DB chỉ giữ hash capability 256 bit; worker xóa access đã hết hạn hơn một phút mỗi 10 phút. View `public_evidence_download` chỉ cho Core Data đọc object metadata khi access còn hạn, QR/policy/projection/quality active, evidence public/active, document confirmed và file clean/checksum đúng. Core Data không được SELECT raw trace events.

## P09 — `federation`

### `federation.inbox_message`

`id`, `created_at`; `issuer_instance_id text!`, `message_id text!`, `event_id text!`, `event_type text!`, `schema_version text!`, `payload_sha256 char(64)!`, `payload jsonb!`, `partner_id uuid!→system.partner.id`, `state text! CHECK IN ('validated','pending_dependency','applied_to_trace','rejected')`, `received_at timestamptz! DEFAULT now()`, `applied_at timestamptz?`, `error_code text?`. Unique `(issuer_instance_id,message_id)` **và** `(issuer_instance_id,event_id,event_type)` để cùng business event không apply lần hai dưới message ID mới; index `(state,received_at)`, `(event_id)`. Auth token→partner trước insert; replay cùng ID/hash trả ACK cũ, khác hash hoặc event ID cũ với message ID mới trả 409.

### `federation.delivery_attempt`

`id`, `created_at`; `outbox_id uuid!→platform.outbox_message.id`, `attempt_no integer! CHECK(attempt_no>0)`, `endpoint_host text!`, `http_status smallint?`, `result text! CHECK IN ('ack','retry','permanent_failure')`, `error_code text?`, `duration_ms integer? CHECK(duration_ms>=0)`, `ack_message_id text?`, `ack_id text?`, `ack_status text? CHECK IN ('validated','pending_dependency')`; unique `(outbox_id,attempt_no)`, index `(outbox_id,created_at DESC)`. Worker chỉ ghi `result='ack'` khi HTTP 202, ACK message ID đúng, recipient/endpoint đúng và schema ACK hợp lệ; không lưu bearer token/request secret.

Migration T03: `prisma/migrations/20261124040000_federation_delivery_attempt/migration.sql`. `attempt_no` tăng liên tục theo từng outbox message kể cả khi quản trị viên retry dead-letter đặt lại `outbox_message.attempt_count`; worker khóa outbox row, đọc max attempt rồi ghi bản mới. `app_runtime` chỉ có SELECT/INSERT bảng attempt, `core_data` không đọc được. `result='ack'` buộc các ACK field và `http_status=202`; lỗi không được chứa ACK field.

### `federation.identity_mapping`

`id`, `created_at`; `origin_issuer_instance_id text!`, `origin_lot_id text!`, `sender_instance_id text!`, `sender_batch_id text!`, `local_batch_id uuid!→catalog.batch.id`, `source_message_id uuid!→federation.inbox_message.id`, `verification_state text! CHECK IN ('partner_asserted','verified')`; unique `(sender_instance_id,sender_batch_id,origin_issuer_instance_id,origin_lot_id)`; index `(local_batch_id)`. Không map theo tên/SKU. Một local batch có thể có nhiều upstream evidence nếu policy cho phép; unique không cấm.

### `federation.partner_ack`

`id`, `created_at`; `inbox_id uuid!→federation.inbox_message.id UNIQUE`, `ack_id text! UNIQUE`, `ack_status text! CHECK IN ('validated','pending_dependency')`, `response_body jsonb!`, `sent_at timestamptz?`. ACK bền vững để replay same hash trả nội dung tương đương; business receipt là event riêng sau Staff confirm.

### `federation.business_receipt` và `business_receipt_line` (P09-T06)

`business_receipt`: `id uuid PK`, `transfer_id uuid!→trading.transfer_detail.document_id UNIQUE`, `inbox_id uuid!→federation.inbox_message.id UNIQUE`, `issuer_instance_id text!`, `source_receiving_id uuid!` (ID chứng từ remote), `sent_quantity numeric(20,3)! >0`, `actual_quantity numeric(20,3)!` trong `[0,sent]`, `discrepancy_quantity numeric(20,3)! = sent-actual`, `discrepancy_reason text?` bắt buộc nếu có lệch, `received_at timestamptz!`. Chỉ ghi sau khi kiểm M2M và so khớp từng line với transfer/outbox immutable local; không đổi issue hoặc stock sender. Một transfer nhận tối đa một business receipt v1; correction là event/contract mới ở phase sau.

`business_receipt_line`: khóa `(receipt_id,source_line_id)`, FK `receipt_id→business_receipt.id`, `source_line_id→trading.document_line.id`, `receiver_batch_id uuid!` là batch remote (không FK local), `sent_quantity`, `actual_quantity numeric(20,3)!` với `0<=actual<=sent`, `unit text! IN (EA,KG,L)`. Đủ mọi transfer source line, gồm line actual bằng 0. Hai bảng append-only đối với app runtime (`SELECT,INSERT`), dùng inbox replay và unique transfer để chống áp business event hai lần.

## P12 — data quality vận hành

### `traceability.quality_issue`

`id`, `created_at`, `updated_at`, `version`; `rule_id text! CHECK IN ('missing_source','out_of_order','conflicting_quantity','unscanned_evidence','unknown_issuer','stale_partner_summary')`, `source_type text! CHECK IN ('lot','event','attachment','partner')`, `source_id text! (<=256)`, `state text! CHECK IN ('open','acknowledged','resolved') DEFAULT 'open'`, `severity text! CHECK IN ('info','warning','critical')`, `source_event_ids uuid[]! DEFAULT '{}'`, `detail jsonb!`, `policy_version text!`, `first_detected_at timestamptz!`, `last_detected_at timestamptz!`, `resolved_at timestamptz?`, `resolved_by_sub text?`. Unique `(rule_id,source_type,source_id)`; index `(state,severity,last_detected_at DESC)`, `(source_type,source_id)`. Projection/quality worker upsert cùng rule+source, tăng version/last_detected_at; resolver chỉ set resolved khi nguồn đã sửa hoặc Admin xác nhận với reason/audit, recurrence mở lại cùng row/version. `detail` chỉ `{schemaVersion,reason,expected?,actual?,remoteRefs?}` đã redacted; không đưa raw partner payload/PII. `source_id` đa loại nên application kiểm source thực, không tạo FK giả; `source_event_ids` là local event IDs, external refs nằm trong `detail.remoteRefs` issuer-qualified. Không xuất bảng này qua Passport public.

## Migration order, FK muộn và truy vấn kiểm chứng

1. P01 thay file rỗng `db/migrations/0001_platform.sql` bằng migration Prisma đầu (platform core: audit/attachment/core_record) trong **cùng PR**; migration tiếp theo: idempotency/outbox/approval_request. Không duy trì runner SQL thủ công song song.
2. System (P02 Prisma migrations); catalog + inventory (P06 Prisma: `…_catalog_product_batch`, `…_inventory_warehouse_stock`, gồm `system.membership_warehouse` sau khi warehouse có). Legend cũ `0003`/`0004`/`0005` chỉ mang tính lịch sử thiết kế. Lúc P06 `stock_movement.source_line_id` chưa FK vì `trading.document_line` chưa có. Không tạo movement ngoài test harness trước P07 (trừ `openStockBalance` documented).
3. `0006_trading.sql`: document/line/subtype; add FK `stock_movement.source_line_id→document_line.id`, `approval_request.document_id→document.id`. FK/trigger subtype và required line field phải có test migration.
4. `0007_traceability.sql`; `0008_federation.sql` add FK `receiving_detail.inbound_message_id`, `trace_event.source_message_id` sau khi inbox tồn tại; `0009_quality_operations.sql` ở P12 tạo `traceability.quality_issue`.
5. Mọi migration chạy từ DB trống và DB đã ở version trước; không sửa file migration đã áp dụng. Rollback bằng migration bù hoặc restore backup đã diễn tập. Query `SELECT count(*)` từng bảng, unique/FK/check violation tests, `EXPLAIN` cho balance/trace/outbox hot paths.

**Invariant quan trọng:** document confirm + stock movement/balance + audit + outbox cùng một `prisma.$transaction` (`Prisma.TransactionClient`). `core_record`/file link sang app sau commit qua outbox/reconciliation, không gọi core API trong transaction M03. Không dùng trigger DB âm thầm ghi balance; chỉ Inventory port thực hiện và test đối chiếu `sum(delta)=balance` theo warehouse+batch. Migration: xem `prisma-migration-spec.md` (D03).
