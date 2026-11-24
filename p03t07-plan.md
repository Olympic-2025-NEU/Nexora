# P03-T07 — Kế hoạch giải thích trước khi triển khai Core Data/File API

**Trạng thái:** bản kế hoạch để chủ repo duyệt; chưa triển khai hoặc kiểm chứng T07. **Nhánh khảo sát:** `phase03/p03-t07-core-data-api`. Nguồn: `documents/phase-plan/phase-03-data-files.md` §P03-T07 và hàng P03-T07, D15 (`documents/adr/D15-headless-core-boundary.md`, `0015-headless-tier2-boundary.md`), `core-record-payloads-v1.md`, contract hiện có.

## 1. Hiểu yêu cầu và ranh giới

1. **Dữ liệu có cấu trúc và tệp:** hoàn thiện `services/core-data/` đang chạy riêng, không UI. Người dùng/ứng dụng gọi qua APISIX. Core chỉ nhận các loại bản ghi có schema, phiên bản và quyền rõ ràng; tệp đi qua cách ly, quét rồi mới cho tải. Không đưa credential PG/S3 cho browser hoặc DX-Lab, không dựng API SQL tùy ý.
2. **Một đường kiểm quyền, một đường audit:** cùng token được xác minh lại thành actor trong core, cùng quy tắc quyền theo thao tác và tài nguyên; ghi audit thành công cùng transaction của metadata/record, log từ chối an toàn riêng. Tệp có thể liên kết chứng từ/lô mà vẫn `private`; không suy ra quyền công bố từ việc có link. ERP chỉ gửi projection sau commit, có lưu việc cần gửi để retry.
3. **Thử nghiệm khi không có UI:** dừng container Next ERP và DX-Lab, giữ core/gateway/Keycloak/Flowable/storage/ClamAV/scan worker. POST/GET bản ghi, upload→scan→download tệp qua gateway vẫn hoạt động; kiểm cả request không token và sai quyền. Health không thay cho bài thử dữ liệu thật.

D15 chốt **ba runtime riêng**: core headless, Next ERP sở hữu transaction chứng từ/tồn/audit/outbox trong app DB, DX-Lab frontend riêng. Cùng một PostgreSQL instance có DB/role tách quyền; core chỉ ghi `platform.core_record`, `platform.attachment` và audit được phép, không ghi bảng stock/document. Gateway, Keycloak và Flowable sống độc lập khi cả hai UI tắt. Spike D15 chỉ chứng minh ranh giới, không phải bằng chứng T07 sản phẩm.

**Tái dùng T01–T06:** Prisma schema/migration và quyền `core_data`/`app_runtime` (T01); repository nhận Prisma client/transaction client, `platform/persistence/transaction.ts` cho app (T02); `recordCoreAudit`/audit append-only (T03); upload multipart, S3 quarantine/private, SHA-256, idempotency, reconciler (T04); ClamAV worker với `pending → clean | infected | error`, retry/fail-closed (T05); backup/restore T06 để thử giữ record/file sau restart. T07 bổ sung route record, policy/link evidence, kiểm thử xuyên gateway, không viết lại scanner hay baseline migration đã áp dụng.

**Để phase sau:** P04-T02/T03 mới có idempotency chung, outbox PG và dispatcher **sản phẩm**; hiện `worker/entrypoint.js` nói chưa có dispatcher và `platform/outbox/message.ts` chỉ là port, T02 chỉ có spike outbox. P05/P06/P07 mới có chứng từ/lô và scope kho đầy đủ; P08 sở hữu trace projector/upsert `trace_projection`; P12 mới có simulator `ot_reading` và archive worker `archive_manifest`. T07 không làm nghiệp vụ M03, tạo trace graph/QR public, thiết bị OT, archive hay DX-Lab UI. Bốn schema đã có trong `contracts/core-records/`; chỉ `evidence_metadata` là user-write của lát cắt T07, các kind còn lại phải fail closed cho tới khi có service identity và producer đúng phase.

## 2. Luồng dự kiến

### A. Structured records

`POST /api/v1/core/records` và `GET /api/v1/core/records/{id}`: APISIX route `/api/v1/core/*` rewrite thành `/records*` tới core; core tự kiểm Bearer JWT (chữ ký, issuer, audience), đối chiếu active `system.membership`, sau đó authorize theo **kind + action + owner**. `services/core-data/auth.mjs` hiện chỉ nhận user membership; phải tách đường service token có client/scope allowlist, tuyệt đối không lấy `role`, `owner`, `actor` từ JSON/header giả. Cùng actor/policy được `files/` dùng lại; actor user và service đều ghi được `actorSub` hoặc `clientId` vào audit đúng CHECK DB. Từ chối 401 nếu không hợp lệ; 403 nếu không đủ vai/scope; 404 cho ID ngoài phạm vi khi cần chống dò.

Allowlist `kind → schemaVersion → schema` tải từ bốn JSON Schema có sẵn, kiểm `additionalProperties:false` cả payload lẫn envelope; Ajv/ajv-formats đã có trong repo, cần đưa validator vào image production hoặc chọn cách đóng gói tương đương. Kiểm đúng cặp `kind/sourceType/sourceId`: user tạo `evidence_metadata` không tự gửi source key, server cấp `sourceType=evidence` và UUID; `trace_projection` dùng `lot` + UUID và chỉ trace projector P08 được ghi; `ot_reading`, `archive_manifest` dành cho P12. Chặn kind/version/field/ownerType lạ với 422, writer sai quyền với 403; `visibility=private`, `policyVersion=v1` cho evidence v1; không nhận client tự nâng `public/partner`, `builtAt`, `version`, `checksum`, `createdBy` hay source key user. Owner UUID chỉ hợp lệ nếu **owner tồn tại và actor có quyền thật**, không chỉ đúng format. `evidence_metadata.attachmentId` phải tồn tại, `clean`, private và actor có quyền với attachment lẫn owner.

Sau kiểm quyền và schema, core tính SHA-256 trên JSON Canonicalization Scheme (JCS) UTF-8 của payload; dùng lại dependency `canonicalize`, không hash `JSON.stringify` không ổn định. `coreRecordRepository(tx)` ghi record và `recordCoreAudit(tx)` trong **một** `prisma.$transaction`; CAS `version` khi update được cho phép, không HTTP/S3 trong transaction. Unique `(kind,sourceType,sourceId)`: cùng hash trả bản cũ; khác hash trả 409 trừ update có `If-Match` và policy cho phép. `Idempotency-Key` bắt buộc cho create evidence; phải thống nhất nơi giữ key bền vững khi source key do server cấp (xem câu hỏi mở). GET áp lại quyền owner/file và chỉ trả projection/metadata hợp lệ; không dùng `visibility` của DB làm giấy phép public.

### B. Tệp private và evidence link

`POST /api/v1/files` multipart qua APISIX tới core: tái dùng giới hạn 10 MiB, MIME/content check, key ngẫu nhiên, upload `quarantine` và metadata `pending` + audit; `file-scanner` quét ClamAV rồi chuyển bản sạch sang `private` với audit. `GET /api/v1/files/{id}` trả metadata theo quyền; `?download=1` chỉ trả bytes khi `clean`, bucket `private`, checksum đúng và actor có quyền hiện tại. `pending/infected/error` trả 423; service down/timeout giữ quarantine, retry có giới hạn; infected chỉ admin discard, error chỉ admin retry-scan. Không trả URL S3/presigned public.

T04 hiện **từ chối** `ownerType`/`ownerId`, upload luôn `ownerType=core_record`, `ownerId=null`; `authorizedRow` chỉ cho uploader/admin. T07 cần chọn cách gắn liên kết sau clean: ưu tiên tạo `evidence_metadata` chỉ khi owner thật đã được kiểm, đồng thời cập nhật `attachment.ownerType/ownerId` bằng CAS cùng transaction record+audit; khi GET/download kiểm lại owner policy, không chỉ kiểm uploader. Không cho client đổi liên kết hoặc tự gửi `visibility=public`; rollback nếu record/audit/link thất bại. Với owner chưa có bảng/adapter (document P07, batch P06, trace_event P08), không coi UUID giả là chứng từ/lô thật. Giữ unlinked upload private dùng được khi UI tắt; smoke liên kết thật phải đợi owner thật hoặc chủ repo duyệt fixture có kiểm quyền tương đương.

### C. ERP đồng bộ projection sau commit

Khi use case ERP có dữ liệu nguồn thật: trong **transaction app DB** ghi document/stock (nếu action sở hữu movement), audit và một outbox event `core.projection.upsert.v1` mang source ID/version/correlation; **không gọi HTTP core tại đây**. Sau commit, dispatcher P04 claim/lease, lấy service token scope hẹp, gọi `POST /api/v1/core/records` qua gateway với source key và hash/`If-Match`; core kiểm service identity, schema, version và lưu audit. Timeout/5xx: retry backoff, không rollback chứng từ; cùng source+hash trả cùng record; 409 version/hash không khớp vào hàng cần điều tra, không ghi đè mù. Sau ack mới mark delivered; crash sau core commit trước ack thì replay an toàn. Test tắt core rồi bật lại và so một projection/nguồn, không tuyên bố stock/document nằm ở core.

**Phụ thuộc thực tế:** outbox/dispatcher P04 và projection `trace_projection`/nguồn lô P08 chưa có, nên không thể cam kết E2E ERP→core ngay trên nhánh T07 nếu không kéo scope phase sau. T07 chuẩn bị contract/adapter sau commit, thử contract với nguồn kiểm chứng nếu được duyệt; commit tích hợp ERP/dispatcher chỉ thực hiện sau P04 và producer sở hữu loại projection. Không thay outbox bền vững bằng timer trong memory hoặc gọi trực tiếp sau `await transaction.run` không có retry bền vững.

### D. Tắt UI mà lõi còn sống

Compose hiện đặt `erp`, `worker`, `core-data`, `file-scanner`, `file-reconciler` **chung profile `apps`**; `dx-lab` ở `dxlab` (P11, có thể chưa build/run). **Không** dùng `down --profile apps` hoặc `stop` cả profile: sẽ tắt core/scanner. Dùng `docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a stop erp dx-lab worker` (nếu service chưa chạy, script xử lý trường hợp đó). Chạy riêng core-data, file-scanner, file-reconciler cùng gateway, keycloak, postgres, seaweedfs, clamav, flowable; `compose ps` xác nhận `erp`/`dx-lab` không chạy. Dự kiến chuyển profile core/file sang mặc định hoặc profile `core` riêng sau khi duyệt để lệnh khởi động không kéo ERP; không sửa gateway catch-all chỉ để che lỗi.

Smoke qua **gateway**: `GET /gateway/ping` 200; Keycloak OIDC discovery nội bộ 200 và cấp token user test hợp lệ (không in token); Flowable management engine nội bộ với credential test 200, không công bố Flowable REST ra public. `POST /api/v1/files` 202, `GET /api/v1/files/{id}` 200; polling tới clean rồi `GET ...?download=1` 200 và SHA khớp; `POST /api/v1/core/records` 201 với evidence owner hợp lệ, `GET .../{id}` 200. Không token trên core/files phải 401, viewer POST phải 403, người khác GET owner/file phải 404 hoặc 403 theo chính sách thống nhất, file pending/infected/error download 423. Core `/api/v1/health/ready` kiểm nội bộ 200; `/api/v1/core/records` **không** được rơi về ERP catch-all khi ERP tắt. Nếu fixture owner không tồn tại, báo smoke evidence **blocked** thay vì tạo record bằng UUID giả rồi tuyên bố pass.

## 3. Danh sách file dự kiến (khi được duyệt)

Danh sách theo phương án đầy đủ, **20 file**, gồm file đã có và file tạo mới. Một số file/commit phụ thuộc quyết định owner và P04/P08; cập nhật danh sách trước khi code nếu quyết định đổi.

| Đường dẫn | Mục đích |
| --- | --- |
| `services/core-data/server.js` | Gắn record handler bên cạnh file/health, không đưa vào Next. |
| `services/core-data/auth.mjs` | Chuẩn hóa user/service actor, xác minh JWT lại và chặn header giả. |
| `services/core-data/audit.mjs` | Dùng actor/correlation và audit thành công thống nhất; deny/failure ghi log redacted riêng. |
| `services/core-data/records/schema.mjs` (mới) | Load/compile schema allowlist có phiên bản, JCS/checksum; không load kind theo path user. |
| `services/core-data/records/policy.mjs` (mới) | Writer/read/owner policy cho record và file; fail closed nếu chưa có owner resolver. |
| `services/core-data/records/service.mjs` (mới) | Use case create/get, dedupe/CAS, transaction record+link+audit. |
| `services/core-data/records/http.mjs` (mới) | Parse route/body/If-Match và map lỗi HTTP/requestId. |
| `services/core-data/files/upload-service.mjs` | Gắn owner có kiểm quyền, recheck khi metadata/download; giữ scan/retry hiện có. |
| `services/core-data/files/file-policy.mjs` | Giới hạn owner/visibility allowlist thay vì mở upload tự do. |
| `services/core-data/Dockerfile` | COPY `records/` và schema JSON; bảo đảm dependency validator ở image runtime. |
| `deploy/compose.yml` | Tách vòng đời core/file khỏi ERP trong profile và cung cấp config service identity nếu cần. |
| `deploy/scripts/smoke-core.mjs` (mới) | Smoke hai loại dữ liệu qua gateway khi UI tắt; lấy token trong mạng nội bộ, in mã HTTP/ID đã che, không in secret. |
| `tests/platform/core-records.integration.test.mjs` (mới) | Schema/version/role/source/dedupe/CAS/audit, rollback record+audit. |
| `tests/platform/core-evidence.integration.test.mjs` (mới) | Owner thật, pending/clean/error/infected, link private, IDOR và audit file/record. |
| `platform/core-data/projection-client.ts` (mới; sau P04/P08) | ERP adapter gọi gateway bằng service token sau commit. |
| `workers/core-projection-dispatcher.ts` (mới; sau P04/P08) | Handler dùng **outbox PG P04**; lease/retry/ack/dedupe, không tự tạo hàng đợi thứ hai. |
| `tests/platform/core-projection.integration.test.ts` (mới; sau P04/P08) | Core down/crash/replay, retry sau commit, stock/document không rollback. |
| `scripts/generate-openapi.mjs` | Cập nhật mô tả/route nếu contract v1 phải sửa theo quyết định owner/upsert. |
| `scripts/openapi-v1-schemas.mjs` | Sửa nguồn DTO/enum cùng thay đổi contract, không sửa YAML sinh tay. |
| `contracts/openapi/nexora-v1.yaml` | File **được sinh** và kiểm drift; `contracts/core-records/*.schema.json` + fixtures đã có, chỉ sửa khi quyết định làm đổi payload. |

Chưa tính migration mới: `core_record`/`attachment` và CHECK kind/owner đã có; nếu cần khóa idempotency hoặc constraint link mới, bổ sung migration Prisma **số mới** và test quyền/forward, không sửa baseline đã áp dụng. Script smoke hiện tại `deploy/scripts/smoke.sh`/`smoke.mjs` kiểm cả ERP/worker nên **không** dùng để chấm headless; smoke mới dành riêng cho T07.

## 4. Commit đề xuất theo lát cắt

1. `feat(core-data): serve authorized versioned records` — record POST/GET, schema allowlist, policy actor, audit, contract tests, image. Khoảng 8–10 file; 201/200/401/403/422/409 và rollback pass.
2. `feat(core-data): link private evidence to authorized owners` — file policy/link và tests scan/owner/recheck; khoảng 3–5 file, **chỉ hoàn chỉnh khi có owner thật hoặc resolver được chủ repo duyệt**. Không tự mở quyền public.
3. `feat(core-data): prove headless data and file smoke` — vòng đời Compose + smoke riêng; khoảng 2–3 file, UI dừng mà record/file/SSO/gateway/Flowable vẫn chạy.
4. `feat(core-data): dispatch ERP projections after commit` — adapter + handler outbox có sẵn + failure tests, khoảng 3–5 file; **phụ thuộc P04 outbox và P08 producer**, không giả vờ đã commit đủ T07 nếu chúng chưa có. Nếu bổ sung migration/contract, gộp cùng commit tính năng liên quan.

Đây là **đề xuất commit**, không phải lệnh commit trong phiên lập kế hoạch này.

## 5. Kiểm chứng từng checkbox (lệnh đề xuất sau khi code)

- **Checkbox 1:** `npm run test:contracts && npm run test:platform:schema && node --test tests/platform/core-records.integration.test.mjs && npm run test:platform:scan`; integration chạy với PG/S3/ClamAV cô lập theo runner hiện có. Kỳ vọng POST hợp lệ 201, GET 200; thiếu token 401, wrong role 403, kind/field/version/ownerType lạ 422, idempotency/hash/If-Match conflict 409, không có SQL arbitrary. Tệp sạch 200, chưa sạch 423; không public URL. Kiểm `npm run check:openapi` vì YAML được sinh từ script.
- **Checkbox 2:** `node --test tests/platform/core-evidence.integration.test.mjs` và sau P04/P08 `node --test --require tsx/cjs tests/platform/core-projection.integration.test.ts`; đối chiếu `platform.audit_log` theo requestId/targetId: create evidence, upload, scan, download có actor hoặc scanner client đúng; rollback không để record/link/audit thành công mồ côi, deny không log token. Dùng owner thật, viewer/actor khác bị chặn; link private không mở URL. Test kill core sau ERP commit: app document/stock/outbox vẫn commit, restart core dispatcher retry, cùng source chỉ một projection/hash; test rollback app: không có projection mới. Nếu P04/P08 chưa tồn tại, ghi **blocked** với tên dependency, không tính pass.
- **Checkbox 3:** sau `bash deploy/scripts/bootstrap.sh a`, chạy `docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile apps up -d --build` cho stack test cô lập; khi các service healthy, `docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a stop erp dx-lab worker`; xác nhận bằng `docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a ps`. Sau đó `node deploy/scripts/smoke-core.mjs a` (script sẽ dùng Docker network/project để gọi gateway và health nội bộ, **không** phụ thuộc ERP/worker). Kỳ vọng gateway/SSO/Flowable 200, core health 200; POST/GET record 201/200, file upload 202, metadata/download clean 200, SHA đúng, 401/403 và 423 đúng, cả hai UI đều không chạy. Khởi động lại ERP chỉ sau smoke, kiểm record/file còn nguyên. Chạy `bash deploy/scripts/smoke.sh a` **sau** khi ERP/worker được bật lại, không dùng thay smoke headless.
- **Milo qua SSH (nếu sandbox không chạy được integration):** SSH vào máy test đã được cấp quyền, vào checkout repo đúng nhánh, kiểm `git status --short --branch`, thực hiện các lệnh test/smoke trên với **project Compose riêng**, env instance tồn tại tại chỗ; chỉ ghi status, requestId đã che, checksum, exit code vào log để chủ repo đối chiếu. Nếu Docker CLI thiếu Compose plugin, dùng hàm `docker()` trong `deploy/README.md` ở cùng shell trước các lệnh. Không đưa token/secret, nội dung `.env` hoặc cấu hình `docker compose config` không có `-q` vào log. Lệnh này dành cho **phiên thực thi sau**, không chạy trong phiên viết plan.

## 6. Câu hỏi cần chốt và rủi ro

1. **Owner thật chưa có:** P06/P07/P08 chưa tạo batch/document/trace_event trong schema hiện tại. Chủ repo muốn chuyển phần link/evidence smoke sang sau các phase đó, hay duyệt một owner resolver/fixture có dữ liệu thật và quyền có thể kiểm tại T07? Không được coi UUID tùy ý là link hợp lệ.
2. **Mốc ERP sync:** P04 outbox dispatcher và P08 trace projector chưa có. Chốt T07 chỉ bàn giao core contract + smoke độc lập rồi đóng ERP-sync sau phase phụ thuộc, hay cho phép kéo tối thiểu outbox PG vào T07 kèm migration/test? Phương án mặc định: **đợi P04/P08, không tạo queue thứ hai**; vì spec yêu cầu sync, checklist T07 chưa thể đánh hoàn tất trước đó.
3. **Service identity:** `auth.mjs` đang chỉ lookup user membership; cần chốt client/scope/audience `core-records:write` cho projector và cách APISIX phân biệt service-only kind. Không dùng partner `federation:write` hoặc coi service account như Staff.
4. **Idempotency evidence:** server cấp `sourceId` nhưng client có thể retry `POST` với `Idempotency-Key` sau mất response; chốt nơi lưu key→record ID bền vững trước P04-T02 (hay đợi P04), không nhân đôi bản ghi. Chốt route update evidence/trace (`If-Match` trên POST theo blueprint hay thêm PUT/PATCH và sửa OpenAPI nguồn).
5. **Owner policy lúc ERP tắt:** core có quyền đọc tối thiểu dữ liệu owner trên app DB hay cần bản sao policy/owner đã đồng bộ? Nếu chỉ hỏi ERP HTTP để authorize, smoke headless sẽ fail; nếu core đọc bảng trading/catalog, cần migration role SELECT hẹp và recheck quyền khi owner đổi. Chủ repo chốt nguồn dữ liệu, revoke semantics và quyền read `viewer`/uploader sau link.
6. **Gateway/health contract:** APISIX đang rewrite `/api/v1/core/*` thành `/records*`, file prefix thành `/files/*`; core hiện chưa có record handler. Gateway `/api/v1/health/*` rơi vào ERP catch-all nên dùng `/gateway/ping` + core readiness nội bộ khi ERP dừng. Chốt có cần health riêng qua gateway hay giữ nội bộ.

Rủi ro cần kiểm bằng test: policy Phase 2 (`platform/access/policy.ts`) là TypeScript role matrix **chưa có core record/file resource action**, còn core là Node `.mjs`; không import thẳng rồi cho rằng đã đồng nhất. Scope kho chưa có trước P06; deny phải fail closed. Scan bất đồng bộ dễ race giữa `clean`/link/download; dùng CAS và recheck owner sau scan. File upload lên S3 trước PG transaction cần compensation/reconciler T04. Outbox chỉ là spike/port nên HTTP sau commit không có ack/retry bền vững trước P04; auth service và conflict/lag phải quan sát được. `contracts/openapi/nexora-v1.yaml` là file sinh; thay đổi nguồn `scripts/generate-openapi.mjs`/`openapi-v1-schemas.mjs` cùng fixtures nếu đổi shape. Không dùng health hoặc fixture tĩnh thay request có dữ liệu thật.

## 7. Ước lượng

**Khoảng 20 file, 4 commit tính năng**, trong đó commit ERP-sync 3–5 file bị chặn bởi P04/P08; commit link 3–5 file bị chặn bởi owner thật nếu chưa chốt resolver. Phần core record 8–10 file lớn nhất (schema/policy/HTTP/transaction/test); smoke 2–3 file; có thể tăng 1–3 file nếu cần migration, package script hoặc sửa OpenAPI fixture. Không ước lượng ngày/giờ khi các dependency và owner policy chưa được chốt.
