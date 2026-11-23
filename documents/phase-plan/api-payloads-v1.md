# HTTP contract v1 — trường dữ liệu theo route

Đây là DTO blueprint v1 đã đối chiếu với `contracts/openapi/nexora-v1.yaml` (70 paths/87 operations). OpenAPI được sinh từ `scripts/generate-openapi.mjs` và kiểm drift/Redocly/fixtures bằng `npm run test:contracts`; route handlers sản phẩm chưa được triển khai. Tên bảng/kiểu DB ở `database-schema-v1.md`; trạng thái và quyền ở `security.md`, `workflow-spec-v1.md`. Mọi ID trong JSON là UUID string, timestamp ISO-8601 UTC, lượng là decimal string. Không cho client gửi `actorSub`, `confirmedBy`, `balanceAfter`, `issuerInstanceId` của chính mình hoặc `status='confirmed'` trong create/update.

## Envelope và lỗi chung

Success write: `{data:{id,status,version,...},requestId}`; list: `{data:[...],page:{nextCursor,limit},requestId}`. Validation 400/422 `{code,message,requestId,details:[{field,reason}]}`; 401/403/404/409/429/503 cùng shape nhưng `details` tùy chọn. `Idempotency-Key` bắt buộc cho issue submit, approval decision, mọi confirm, admin federation retry, AI Draft, evidence metadata create và quality issue actions; federation inbound dedupe bằng `(issuer,messageId,payloadHash)`. POST create khác nhận key tùy chọn, UI nên gửi để chống retry. `If-Match: "<version>"` cho update/submit/decision/confirm/cancel. Response `ETag` phiên bản mới. List `limit=20` mặc định/max100, cursor opaque; order ổn định `(created_at DESC,id DESC)`. Không nhận sort/raw SQL tự do. **Ngoại lệ protocol:** federation inbound trả ACK body chính xác theo `event-payloads-v1.md` để sender xác thực; health/live cũng trả body gọn. Các object trong bảng dưới đây là nội dung `data`, trừ ngoại lệ đó.

## Core và M01

| Method/path | Request fields bắt buộc / tùy chọn | Response `data`/quyền và kiểm thử |
| --- | --- | --- |
| `GET /api/v1/me` | Không body | `{sub,displayName,role,status,warehouseIds}` từ token+membership; user authenticated |
| `GET /api/v1/health/live`, `/ready` | Không body | `{status,service,version}`; ready nội bộ có dependency summary an toàn, không secret |
| `POST /api/v1/core/records` | P03: `{kind:'evidence_metadata',payload}` theo `core-record-payloads-v1.md`, `Idempotency-Key` bắt buộc, `If-Match` tùy chọn khi thay payload; server cấp source key, visibility và policy version. Không nhận source/actor/role từ body. | 201 create, 200 retry/update `{id,kind,version,checksum,builtAt,visibility,payload}`; owner membership/organization active và attachment clean/private có quyền thật; sai key/hash 409 nếu không có If-Match đúng. Trace/OT/archive đợi service identity và producer P08/P12. |
| `GET /api/v1/core/records/{id}` | Không body | Record sau policy; 404 cho resource không thuộc scope |
| `POST /api/v1/files` | multipart `{file,ownerType?,ownerId?,visibility?}`; `Idempotency-Key` bắt buộc; MIME/size allowlist. P03-T04 chỉ nhận file chưa link owner với `visibility=private`, owner fields chờ policy tài nguyên ở T07. | 202 `{id,scanState:'pending'}`; tệp nằm quarantine, không URL public; retry cùng key/payload trả ID cũ, key khác payload trả 409 |
| `GET /api/v1/files/{id}` | `?download=1` nếu muốn bytes | metadata `{id,mimeType,sizeBytes,scanState,visibility,checksum}`; `download=1` trả stream chỉ khi clean, bucket private và actor có quyền; pending/infected/error trả 423 |
| `GET /api/v1/organization` | Không body | `{id,instanceId,code,name,timezone,status,version,contactEmail?,contactPhone?,address?}`; user authenticated |
| `PATCH /api/v1/organization` | `{name?,contactEmail?,contactPhone?,address?,timezone?}`, `If-Match` | `{id,version,...}`; Administrator; `instanceId/code` bất biến |
| `GET /api/v1/members` | `?cursor&limit&status&role` | `{id,keycloakSub,displayName,role,status}`; Administrator |
| `POST /api/v1/members` | `{username,displayName,email?,role,warehouseIds?,temporaryPassword?}` | 201 member (+ `provisionalPassword?` once when KC user created, `keycloakCreated`); Admin; ERP gọi Keycloak Admin tạo/tái sử dụng user theo username, gán realm role, ghi membership `active`; **không** nhận `keycloakSub` từ client; không lưu password app DB |
| `PATCH /api/v1/members/{id}` | `{role?,status?,displayName?,email?,warehouseIds?}`, `If-Match` | Member mới; Admin; không disable Admin active cuối cùng; sync realm role + enable/disable Keycloak best-effort; P06 ghi `warehouseIds` vào `membership_warehouse` trong transaction |
| `GET /api/v1/partners` | `?cursor&limit&status` | Danh bạ với connection status, không secret; user authenticated |
| `POST /api/v1/partners` | `{issuerInstanceId,code,displayName,contactEmail?}` | 201 partner; Admin; issuer unique |
| `PATCH /api/v1/partners/{id}` | `{displayName?,status?,contactEmail?}`, `If-Match` | Partner mới; Admin; suspend chặn outbound mới |
| `PUT /api/v1/partners/{id}/connection` | `{endpointUrl,outboundTokenUrl,outboundClientId,outboundSecretRef,outboundAudience,inboundClientId,allowedInboundScope}` | `{partnerId,endpointHost,status,rotatedAt}`; Admin; **không** trả `outboundSecretRef`; SSRF/HTTPS validation cho cả URL; inboundClientId phải tồn tại ở local Keycloak |

## M02 catalog/inventory

### M02 baseline (P06 / G06) — historical

Products with `{sku,name,baseUnit}`, identifiers, batches by `productId`, balances by product+batch. **Superseded for identity by P065** (keep only until G06.5 closed).

### M02 target (P065 / ADR 0017) — implement in phase 06.5

| Method/path | Request fields | Response/rule |
| --- | --- | --- |
| `POST /api/v1/products` | `{name,categoryId,attributes?,isActive?}` — **no sku** | 201 product; Staff/Admin; may auto-create empty primary later or require first variant in same UX |
| `PATCH /api/v1/products/{id}` | `{name?,categoryId?,attributes?,isActive?}`, soft-delete action, `If-Match` | Maintains `search_text`; 409 if soft-delete blocked by stock |
| `GET /api/v1/products`, `GET …/{id}` | `?q&categoryId&includeDescendants&isActive&cursor&limit` | Match `search_text` **or** variant sku/barcode (normalized); index fields include variantCount, primary retail |
| `POST /api/v1/products/{id}/variants` | `{sku?,barcode?,isPrimary?,isActive?}` | ≥1 of sku/barcode; 409 `SKU_BARCODE_CONFLICT`; first → primary if none |
| `PATCH /api/v1/variants/{id}` | `{sku?,barcode?,isPrimary?,isActive?}`, soft-delete, `If-Match` | Mutable codes; uniqueness includes soft-deleted |
| `PUT/PATCH /api/v1/variants/{id}/uoms` | `[{uomId,isStockKeeping,factorToStockUom}]` | Exactly one stock-keeping; factor>0; default CÁI on create variant |
| `GET/POST/PATCH /api/v1/categories` | tree `{code,name,parentId?,sortOrder?,isActive?}` | 409 `CATEGORY_HAS_CHILDREN`; no cycles |
| `GET/POST/PATCH /api/v1/uoms` | `{name,kind?}` | Server normalize → `CÁI`; 409 `UOM_NORMALIZE_CONFLICT`; system default immutable |
| `GET/POST/PATCH /api/v1/price-lists` | `{code?,name,isDefault?,validFrom,validTo?,currency,isActive?}` | null code + isDefault; 409 `PRICE_LIST_DEFAULT_EXISTS`; coded ⇒ not default |
| `GET/POST/PATCH /api/v1/price-lists/{id}/items` | `{productVariantId,uomId,priceType,amount,isActive?}` | uom ∈ variant_uoms else 422; unique tuple |
| `POST /api/v1/products/{id}/images` | `{attachmentId,sortOrder?,isPrimary?}` | attachment must exist/scanned per P03; no BLOB body |
| `POST /api/v1/batches` | `{productVariantId,localCode,manufacturedOn?,expiresOn?}` | server sets productId from variant; quality `inspect`; local origin only on user route |
| `POST /api/v1/batches/{id}/quality-actions` | `{action,reason}`, `If-Match` | unchanged semantics |
| `GET /api/v1/batches`, `GET …/{id}` | `?productVariantId&productId&…` | include variant + product refs |
| `POST /api/v1/warehouses` | `{code,name}` | unchanged |
| `GET /api/v1/warehouses` | `?status&cursor&limit` | unchanged |
| `GET /api/v1/inventory/balances` | `?warehouseId&productVariantId&productId&batchId&…` | `{…,productVariantId,quantity,stockUomId,updatedAt}`; qty in stock UOM; no write route |
| `GET /api/v1/inventory/movements` | `?warehouseId&batchId&productVariantId&…` | include variant; stable pagination |

Policy extensions: `catalog:category:read|manage`, `catalog:uom:read|manage`, `catalog:price_list:read|manage` (+ existing `catalog:product:*`).

## M03 chứng từ — DTO dùng chung và route cụ thể

`DocumentLineInput={warehouseId,productVariantId,batchId,quantity?:decimalString,actualQuantity?:decimalString,countedQuantity?:decimalString,uomId}` (P065+; server resolves productId, converts packing uom → stock UOM before Inventory port). Create trả `{id,documentType,documentNumber,status:'draft',version,lines:[{id,...}]}`. Update Draft nhận `{lines?,note?}` + `If-Match`; không PATCH `status`. Use case kiểm field theo type, variant↔batch, uom∈variant_uoms, warehouse, quality và quyền. `documentNumber` do server cấp từ prefix type+date+UUID rút gọn (unique constraint, retry collision), không lấy từ client. Mọi confirm trả `data:{id,status:'confirmed',version,confirmedAt,movementIds}` và `requestId` ở envelope ngoài; transfer/sale có `movementIds:[]`.

| Route | Create Draft body | Action và kết quả đặc thù |
| --- | --- | --- |
| `POST/GET /api/v1/receipts`, `GET/PATCH /api/v1/receipts/{id}`, `POST .../{id}/confirm|cancel` | `{lines:[{warehouseId,productVariantId,batchId,quantity,uomId}],note?,correctionOfDocumentId?,correctionReason?}` | Chỉ nhập nội bộ; confirm `+quantity` mỗi line, movement `receipt`, audit/outbox trong một transaction; không dùng cho cùng lô đã nhận qua partner receiving; correction link chỉ khi lý do và loại chứng từ hợp lệ |
| `POST/GET /api/v1/issues`, `GET/PATCH /api/v1/issues/{id}`, `POST .../{id}/submit|confirm|cancel` | `{purpose:'partner_transfer'|'sale'|'other',lines:[{warehouseId,productVariantId,batchId,quantity,uomId}],note?,correctionOfDocumentId?,correctionReason?}` | Purpose cố định từ create; submit Flowable `goods-issue-approval`; confirm sau approved, `−quantity`, balance đủ; creator không tự approve; transfer/sale chỉ link issue đúng purpose |
| `POST/GET /api/v1/transfers`, `GET /api/v1/transfers/{id}`, `POST .../{id}/confirm|cancel` | `{linkedIssueId,destinationPartnerId,note?}` | Server copy lines từ issue; exact 1:1, một issue chỉ một transfer; confirm tạo outbox `transfer.announced.v1`, **không** movement |
| `POST/GET /api/v1/receivings`, `GET/PATCH /api/v1/receivings/{id}`, `POST .../{id}/confirm|cancel` | `{inboundMessageId,actualLines:[{sourceLineId,localBatchId,warehouseId,actualQuantity,unit}],discrepancyReason?}` | `inboundMessageId` trỏ verified inbox; server lấy issuer/transfer/sent quantity và `sourceLineId` từ message, không tin client tự khai. Lưu `document_line.source_line_ref`, `quantity=sent`, `actual_quantity=actual` cho **mọi** source line, kể cả actual 0. Confirm cộng actual (0 không movement); <=sent từng line/tổng; reason nếu khác; ACK kỹ thuật không gọi route này. P07 test trước P09 dùng trusted seeded source fixture qua service nội bộ, không mở manual public route |
| `POST/GET /api/v1/stocktakes`, `GET/PATCH /api/v1/stocktakes/{id}`, `POST .../{id}/confirm|cancel` | `{lines:[{warehouseId,productVariantId,batchId,countedQuantity,uomId}],note,correctionOfDocumentId?,correctionReason?}` | Confirm lock balance, delta=count−current; delta0 không movement; reason/audit |
| `POST/GET /api/v1/sales-records`, `GET /api/v1/sales-records/{id}`, `POST .../{id}/confirm|cancel` | `{linkedIssueId,buyerRef?,soldAt?}` | Server copy issue lines; confirm trace event, **không** movement/giá/thanh toán |

`buyerRef` của sale là mã tham chiếu ngoài dạng opaque, trim và giới hạn 64 ký tự; không nhập tên, số điện thoại hoặc thông tin thanh toán. `soldAt` không gửi thì lấy thời gian server tại create; thời gian tương lai bị từ chối. T06 chỉ phát internal trace event, không gửi buyerRef cho partner.
| `GET /api/v1/documents` | `?type&status&batchId&partnerId&from&to&cursor&limit` | Union read model từ `trading.document`, includes movement/approval/delivery refs theo quyền |

Approval API: `GET /api/v1/approvals/tasks?cursor&limit` trả `{approvalRequestId,approvalVersion,documentId,taskId,creatorSub,submittedAt,state}` theo Approver role/scope; `POST /api/v1/approvals/{approvalRequestId}/decision` body `{decision:'approved'|'rejected',reason?}`, `If-Match` của **approvalVersion** + `Idempotency-Key`, reject bắt reason. Các action document dùng `If-Match` của `document.version`. Server kiểm `approverSub!=creatorSub`/version/scope rồi ghi decision intent + outbox trong PG transaction, trả `202 {approvalRequestId,state:'decision_pending'}`; worker gọi Flowable, poller đối soát. UI không gọi Flowable REST trực tiếp.

Confirm/cancel cần `If-Match`; confirm cần `Idempotency-Key`. 409 cho stale version, already confirmed với key khác, insufficient stock, duplicate linked issue. 422 cho batch restricted/expired, unit mismatch, actual>sent, missing discrepancy reason. Submit/decision trả trạng thái pending qua outbox khi Flowable down; chỉ task list/engine dependent read có thể 503, không tự approve. Receiving từ message có `sourceIssuerInstanceId/sourceTransferId` chỉ được server verify qua inbox; không tin body tự khai. P07 fixture nguồn tin cậy là internal test path, không manual public receiving.

## M04 trace, public và federation

| Method/path | Request | Response/rule |
| --- | --- | --- |
| `GET /api/v1/lots/{id}/history` | `?cursor&limit` | `{lot,events:[{eventId,type,issuer,occurredAt,sourceDocumentId,verificationState,gap}],nextCursor}` |
| `GET /api/v1/lots/{id}/trace/backward` | `?documentId&depth&cursor&limit` | `TraceGraph` với `root`, `nodes` có issuer-qualified origin/source/occurredAt/recordedAt, `edges`, `gaps`, `localProjection`, `asOf`, `truncated`, `nextCursor`; chỉ link nguồn tường minh |
| `GET /api/v1/lots/{id}/trace/forward` | `?depth&cursor&limit` | Cùng graph shape, edge theo chiều nguồn→downstream và `sourceRelation` giữ quan hệ gốc; `impact` per confirmed document line `{eventId,sourceDocumentId,sourceLineId,kind,quantity,uomId,uomCode?,verificationState,partner?,sentQuantity?,actualQuantity?}`; transfer chưa có downstream summary có gap `unknown`; quantity của issue/transfer/sale là các bước, không cộng thành tổng |
| `GET/POST /api/v1/lots/{id}/passport-policy` | Admin GET lịch sử policy; POST `{organization,product,batch,timeline,evidence}` mỗi giá trị `private|partner|public` | POST tạo draft version kế tiếp; chưa công bố. Mặc định private. |
| `POST /api/v1/lots/{id}/passport-policy/approve|revoke|rebuild` | Approve `{version}`; revoke `{reason}`; rebuild không body | Chỉ Administrator: approve ghi người/thời điểm và dựng projection từ nguồn confirmed; revoke vô hiệu projection; rebuild sau stale/quality chỉ active khi policy approved, lô available và nhóm field bắt buộc public. Outbox/event mới→stale; đổi quality→revoked. Audit từng hành động. |
| `POST /api/v1/lots/{id}/qr` | `{policyVersion}`, `Idempotency-Key` | 201 `{qrUrl,tokenId}`; token raw trả một lần hoặc QR image; không lộ private UUID trong URL |
| `POST /api/v1/lots/{id}/qr/{tokenId}/revoke` | `{reason}` | 204, audit; cache public invalidate |
| `GET /api/v1/public/passport/{token}` | Không auth/body | `{productName,publicLotCode,originIssuer,timeline,verificationState,gaps,asOf}` theo allowlist; 404 cho token revoked/unknown |
| `POST /api/v1/federation/events` | Envelope JSON `event-payloads-v1.md`, M2M bearer | 202 raw ACK `{messageId,ackId,acceptedAt,status:'validated'|'pending_dependency'}`; same hash replay cùng ACK, different hash hoặc same event/new message ID 409; **không** đổi stock |
| `GET /api/v1/federation/deliveries` | `?status&partnerId&cursor&limit` | Admin `{messageId,status,attemptCount,nextAttemptAt,lastErrorCode}` không token |
| `POST /api/v1/federation/deliveries/{id}/retry` | `{reason}`, Admin + idempotency | 202 `{id,status:'retry_due'}`; audit; không chỉnh payload |

Passport không trả member email, giá, stock private, credential, file chưa clean, raw partner payload hay unrestricted buyer. Source summary C được phép dùng chỉ khi A/B sharing policy cho phép, `partner_asserted` không đổi thành `verified` chỉ do forward.

## AI01

| Method/path | Request | Response/rule |
| --- | --- | --- |
| `POST /api/v1/ai/chat` | `{message,conversationId?,lotRef?}` | `{answer,sources:[{type,id,verificationState,asOf}],toolCallIds,needsClarification}`; user identity từ session; quota/timeout |
| `POST /api/v1/ai/drafts` | `{documentType:'goods_receipt'|'goods_issue',instruction,purpose?:'partner_transfer'|'sale'|'other',proposedFields?}`, idempotency | `{draftDocumentId,status:'draft',proposedFields,sources,warnings}`; nếu goods_issue thiếu purpose thì gán `other` rõ trong Draft/response, user phải kiểm lại trước submit; AI không có confirm/approve tool |
| `GET /api/v1/ai/tool-calls/{id}` | Không body | Lấy từ `platform.audit_log.id` action `ai.tool.*`, redacted tool name/actor/source IDs/outcome; Admin/actor theo policy, không cần bảng AI audit riêng |

AI service chỉ gọi allowlist `getLot`, `getStock`, `getTrace`, `createReceiptDraft`, `createIssueDraft` qua backend với delegated actor; không SQL, không service token Admin cho user thường. `services/ai/` không tự lưu nghiệp vụ.

## Audit và Reporting (read-model)

| Method/path | Request | Response/rule |
| --- | --- | --- |
| `GET /api/v1/audit-logs` | `?cursor&limit&action&targetType&targetId&requestId&from&to&outcome` — filter allowlist; `targetId` là text <=128 vì message ID có thể không phải UUID | Administrator: `{data:[{id,createdAt,actorSub?,clientId?,action,targetType,targetId,outcome,requestId,correlationId?}],requestId,page:{limit,nextCursor?}}`; không trả summary chứa secret/PII |
| `GET /api/v1/reports/inventory-summary` | `?warehouseId&productId&cursor&limit` | Staff+/Admin theo warehouse scope: `{warehouseId,productId,batchId,quantity,unit}` aggregate/list; sort allowlist |
| `GET /api/v1/reports/document-counts` | `?from&to&type&status` | Actor authenticated với scope: `{documentType,status,count}[]`; không lộ chứng từ ngoài quyền |
| `GET /api/v1/reports/open-quality-signals` | `?severity&cursor&limit` | Admin (và Staff nếu policy mở): `{id,ruleId,sourceType,sourceId,severity,state,lastDetectedAt}` từ quality_issue mở; P12 đầy đủ |

Mọi report chỉ `GET`; cấm raw SQL từ query string. Query service dùng Prisma hoặc `$queryRaw` parameterized theo `prisma-migration-spec.md`.

## Vận hành dữ liệu P12

`GET /api/v1/quality/issues?state&severity&ruleId&cursor&limit` chỉ Admin trả `{id,ruleId,sourceType,sourceId,state,severity,firstDetectedAt,lastDetectedAt,version}`; detail thêm `sourceEventIds`/redacted `detail`, không public. `POST /api/v1/quality/issues/{id}/acknowledge|resolve` nhận `{reason}` + `If-Match` + `Idempotency-Key`, trả state/version; resolve cần đối chiếu nguồn đã sửa hoặc Admin ghi quyết định/rủi ro tồn đọng, audit cả hai. Worker tự mở lại issue khi recurrence, không để người dùng sửa `ruleId/sourceId/detail` bằng PATCH.

## Contract tests bắt buộc

P00 khóa ma trận 87 operation (role/scope/auth/success), kiểm OpenAPI, 30 cặp fixture request body dùng chung, schema public passport/ACK và các vector federation wrong issuer/recipient/replay. Đây là **kiểm tra contract tĩnh**. P01+ phải thêm test gọi API thật theo từng route cho 401/403, 409 version/idempotency, response payload, public privacy, M2M audience/scope và confirm rollback/concurrency; chỉ tick các AC runtime sau khi các test đó chạy. Khi đổi contract, cập nhật blueprint, generator, fixture và snapshot trong cùng PR; CI kiểm generated-file drift.
