# Phạm vi và nghĩa “xong” của Nexora MVP — v1

**Task:** P00-T02. **Ngày đối chiếu:** 16/11/2026 (giờ Việt Nam). **Trạng thái:** hợp đồng phạm vi để triển khai và nghiệm thu; tài liệu này không chứng minh tính năng đã chạy. Mọi AC chỉ đạt khi có test và bằng chứng trên commit/release cụ thể. **Thứ tự nguồn:** [SOURCE_OF_TRUTH](../referents/SOURCE_OF_TRUTH.md); khi mâu thuẫn, đề thi/thể lệ hiện hành đứng trước Chương 6, rồi mới tới plan. Quyết định kỹ thuật chi tiết thuộc ADR/contract P00-T03/T05.

## 1. Phân loại yêu cầu và ranh giới kiến trúc

| Loại | Nghĩa và quy tắc đóng |
| --- | --- |
| **Bắt buộc theo đề thi/thể lệ** | Đề thi §3–4, điều kiện nguồn mở, hồ sơ nộp và chứng cứ trình diễn phải có thực. Một AC nghiệp vụ không tự thay thế bằng chứng cho lõi. |
| **Bắt buộc theo MVP Nexora** | Toàn bộ AC-01…AC-13 ở Chương 6 §6.10 và kịch bản A→B→C là cam kết của nhóm. Chúng không phải 13 tiêu chí nguyên văn do BTC đặt ra, nhưng bỏ một AC làm MVP của dự án chưa xong. |
| **Mở rộng có kiểm soát** | Chi tiết triển khai/test tăng độ tin cậy hoặc điểm sản phẩm, ví dụ partial receiving, outbox/inbox, cảnh báo rủi ro, trạng thái gap. Chỉ triển khai phần cần để chứng minh AC và §3–4; phần nâng cao khác phải có change request. |
| **Ngoài MVP** | Các mục Chương 6 §6.9 và mục 6 dưới đây. Không kéo vào critical path trừ khi BTC có yêu cầu mới được xác nhận và nhóm cập nhật scope/gate. |

**Ranh giới ba tầng.** Tầng 1 là nền tảng dịch vụ lõi **headless**, cung cấp Identity/SSO, API Gateway, dữ liệu có cấu trúc/phi cấu trúc và Workflow qua API; ứng dụng ở tầng trên tiêu thụ dịch vụ đó. Next.js ERP là ứng dụng nghiệp vụ, không được trình bày như bằng chứng duy nhất của tầng 1. Tầng 2 có ít nhất một ứng dụng giao diện H-P-D-I chạy thật; phạm vi triển khai của nhóm là DX-Lab workspace tách khỏi core và gắn với nghiệp vụ Nexora. Tầng 3 là ứng dụng hàng hóa Nexora, gồm M01/M02/M03/M04/AI01. Mỗi instance thuộc một doanh nghiệp và có PostgreSQL riêng; federation qua API, không truy vấn chéo DB. Đề tham chiếu có nhắc multi-tenancy ở kiến trúc rộng hơn; mức chấp nhận mô hình cách ly bằng instance riêng **cần BTC xác nhận**, chưa được tự suy là tương đương.

### Đối chiếu trực tiếp đề thi §3–4

| Mã | Yêu cầu từ đề | Phạm vi minh chứng của Nexora | Điều kiện nghiệm thu và bằng chứng | Trạng thái/điểm cần xác nhận |
| --- | --- | --- | --- | --- |
| E3-1 | Tầng 1 headless, không UI cho người dùng cuối | Identity/SSO, gateway, core-data API có phân quyền, file API/storage, Flowable BPMN, audit/health; ERP và DX-Lab gọi qua contract | Sơ đồ deployment và network; request OIDC/public/M2M đi qua gateway; cùng core phục vụ app H-P-D-I; UI nghiệp vụ chỉ ở tầng ứng dụng | **Bắt buộc**; không coi `platform/` scaffold hoặc trang Next.js là core đã chạy |
| E3-2 | Dịch vụ lõi: Identity/SSO, API Gateway, structured/unstructured data, Workflow | Đăng nhập và quyền qua OIDC; gateway route/auth; PostgreSQL giao dịch và API dữ liệu; private object/file flow; một process phê duyệt thực thi | Test đăng nhập/403, route/policy gateway, transaction/rollback, upload-scan-download, BPMN task approve/reject; chứng cứ lõi còn chạy khi app UI không hiện | **Bắt buộc**; chốt lựa chọn cụ thể ở ADR P00-T03 |
| E3-3 | Ít nhất một ứng dụng giao diện tầng 2 trong H-P-D-I | Một DX-Lab workspace với bốn lát cắt H/P/D/I có luồng thật, dùng API lõi và dữ liệu Nexora | Người dùng thao tác được, xem task/data/source, AI draft; chứng minh app gọi các dịch vụ tầng 1, không chỉ mock/screenshot | **Bắt buộc**; diễn giải UX chi tiết ở mục 4 |
| E4-1 | Tách dữ liệu theo vòng đời/tốc độ; OLTP nhanh và đẩy lịch sử xuống hồ dữ liệu không nghẽn core | PG giữ transaction; sau commit outbox/worker đẩy sự kiện lịch sử có schema, checksum, source ID vào kho lịch sử có thể truy vấn; D/report đọc projection/kho lịch sử | Test confirm khi worker/kho lịch sử chậm hoặc tắt vẫn hoàn tất; retry không trùng; truy vấn và đối chiếu được bản lịch sử với nguồn PG | **Nguyên lý bắt buộc**; thiết kế kho lịch sử cụ thể chốt ở ADR. JSON dump không truy vấn được không đủ để tự nhận là lakehouse |
| E4-2 | Hội tụ IT/OT, kết nối quy trình với dữ liệu cảm biến và bản sao số theo thời gian thực | Fixture thiết bị quét/nhiệt độ có timestamp, device ID và lot, được xác thực/chuẩn hóa, gắn event giao nhận và trạng thái lot; thể hiện độ trễ/cảnh báo | Demo luồng ingest → business event/lot representation → UI; test dữ liệu sai, trễ, lặp; chỉ rõ dữ liệu mô phỏng | **Nguyên lý bắt buộc**; độ sâu “digital twin/thời gian thực” BTC chấp nhận vẫn cần xác nhận. Không gọi fixture mô phỏng là hệ sensor production |
| E4-3 | Lineage, nguồn gốc, chất lượng thông tin báo cáo | Mỗi event/projection/report giữ issuer, source event/document IDs, transform/policy version, thời điểm và verification/gap status | Truy từ số báo cáo/Passport về source; test missing/out-of-order/disputed; report hiển thị độ tin cậy, không lấp gap bằng suy đoán | **Nguyên lý bắt buộc**; partner assertion không được trình bày là kiểm chứng độc lập |
| E4-4 | Zero Trust, GitOps, kiểm dịch mã độc ở biên, tự phục hồi | Gateway default-deny/token scope, least privilege; upload qua vùng cách ly/scan trước khi file dùng được; manifest trong Git và controller reconcile ít nhất môi trường demo; health/restart/restore | 401/403/scan-malware-fail-closed; đổi manifest/drift rồi quan sát reconcile; kill service/worker và đo phục hồi, không mất/nhân đôi giao dịch | **Nguyên lý bắt buộc**; Compose/CI đơn lẻ không được gọi là GitOps; mức tự phục hồi cần BTC xác nhận |

Bảng bảy lớp công nghệ tại đề thi §4 là **ví dụ tham chiếu**, không buộc dùng đúng Nuxt, Hasura, MinIO, ArgoCD hay toàn bộ sản phẩm nêu tên. Mỗi thay thế phải chứng minh được năng lực tương ứng, giấy phép và build từ source. Các dịch vụ tham chiếu lớn hơn MVP như Vault/HSM, WebGIS, OCR, streaming bus độc lập hoặc multi-tenant tập trung không tự động trở thành task Nexora; nếu cách diễn giải của BTC buộc có chúng, nhóm phải mở change request và sửa gate trước release.

## 2. AC-01…AC-13: hợp đồng nghiệm thu MVP

Mỗi dòng là **bắt buộc theo MVP Nexora**. Cột §3–4 chỉ liên hệ với đề thi, không nói rằng AC đó một mình đáp ứng toàn bộ yêu cầu. Kịch bản và lớp test chuẩn nằm ở [test-matrix.md](./test-matrix.md); PoF và bằng chứng trình diễn ở [contest-scorecard.md](./contest-scorecard.md).

| AC / nguồn Ch6 §6.10 | Module / phase | Kết quả tối thiểu quan sát được | Đối chiếu §3–4 và bằng chứng để đóng |
| --- | --- | --- | --- |
| **AC-01** Ba bản triển khai độc lập, DB riêng | Platform, M01; P01/P09/P13 | Dựng A/B/C từ source với app DB, volume và credential riêng; dừng B thì A/C còn xử lý nghiệp vụ nội bộ | §3 core phục vụ từng app; §4 isolation/recovery. Compose/config, truy vấn identity từng DB, failure log; không có connection chéo |
| **AC-02** Tài khoản và hồ sơ doanh nghiệp mỗi bản | M01; P02/P05 | Realm/client độc lập; Admin quản hồ sơ, user, partner; Staff không sửa connection; role Approver chỉ duyệt theo quyền | §3 Identity/SSO; §4 Zero Trust. UI/API 200/403, claim redacted, audit và DB snapshot |
| **AC-03** Sản phẩm, lô, tồn kho | M02; P06/P07 | Tạo SKU/barcode, batch, warehouse; receipt hợp lệ tăng tồn theo lot; hai issue cạnh tranh không làm âm tồn; lô `inspect` không xuất | §3 structured data; §4 OLTP/quality. Transaction/concurrency assertions, balance/movement/history query |
| **AC-04** Phiếu nhập/xuất gắn lô | M03; P07 | Draft không đổi stock; confirm đúng một movement, audit, outbox; PartnerTransfer/SaleRecord link issue và không trừ lần hai | §3 Workflow + data; §4 lifecycle/lineage. API/UI flow và integration rollback/idempotency |
| **AC-05** Chuyển thông tin lô giữa doanh nghiệp qua API | M04; P09 | A gửi envelope versioned qua gateway M2M; B kiểm issuer/partner và trả **technical ACK**; mất ACK/retry không tạo nhận trùng | §3 gateway; §4 Zero Trust/lineage. Trace mạng redacted, outbox/inbox/ACK và duplicate tests |
| **AC-06** Xác nhận hàng thực nhận | M03/M04; P07/P09 | B xác nhận `actualQuantity` độc lập số gửi; sent 12, actual 10 tạo discrepancy 2; B chỉ +10 khi confirm, không cộng GoodsReceipt lần hai | §3 Workflow/data; §4 provenance/quality. Balance trước/sau, receipt event, partial/duplicate tests |
| **AC-07** Lịch sử lô qua ba doanh nghiệp | M04; P08/P09/P13 | C truy ngược A→B→C qua issuer-qualified links và ba DB riêng; A offline vẫn xem summary đã lưu, có status stale/partner-asserted/gap | §4 lineage/lifecycle. E2E trace, source IDs, query tại C và offline result |
| **AC-08** QR và lịch sử công khai đúng quyền | M04; P08/P11 | QR mở Passport chỉ có allowlist; token revoke được; private balance/note/file/member email không lộ | §3 data/file + tầng 2 UI; §4 Zero Trust. URL/QR, snapshot response, negative privacy test |
| **AC-09** Giao dịch/đơn vị nhận liên quan lô cần kiểm tra | M04; P08/P09 | Forward trace liệt kê các chặng có chứng cứ; nếu chưa có downstream summary thì hiện `unknown downstream`, không tuyên bố đầy đủ | §4 lineage/quality. Query source IDs, UI và test thiếu dữ liệu |
| **AC-10** AI tra cứu dữ liệu có kiểm soát | AI01; P10 | AI gọi tool nghiệp vụ theo quyền, trả số liệu khớp API kèm source, 403 khi user không có quyền | §3 tầng 2 I và Identity/data; §4 Zero Trust/quality. Tool audit, so sánh API, negative test |
| **AC-11** AI hỗ trợ Draft, người dùng xác nhận | AI01/M03; P10/P11 | AI tạo **một** loại chứng từ Draft; user xem/sửa rồi confirm qua M03; AI không có tool confirm và Draft không đổi stock | §3 tầng 2 I/P và Workflow; §4 audit/Zero Trust. State/balance trước-sau, adversarial tool test |
| **AC-12** Một quy trình phê duyệt mẫu | Platform/M03; P04/P07/P11 | Flowable OSS BPMN tạo task GoodsIssue; Approver khác creator approve/reject; chưa duyệt/bị từ chối không confirm | §3 Workflow bắt buộc. BPMN version, task/API/UI log, stock assertion cho cả hai nhánh |
| **AC-13** Cài lại từ repo và tài liệu nguồn mở | Platform/ops; P00/P01/P13 | Người khác clone public, build, migrate/seed, chạy demo, test, backup/restore không cần secret trong Git; release trước khi nộp | §3 triển khai core/app; §4 GitOps/recovery; thể lệ PoF. Runbook fresh clone, version/tag/checksum, image digest, release timestamp |

**Quy tắc chung khi đóng AC:** Test chạy trên dữ liệu deterministic, ghi commit/tag, lệnh, môi trường, kết quả và người review. Demo UI đơn thuần không thay thế test backend. Không tạo dấu `[x]` chỉ nhờ tài liệu. Phân quyền Admin/Staff/Approver, audit, idempotency và quyền công bố phải được kiểm tra dọc luồng tương ứng. AGPL-3.0-only là lựa chọn dự án; P00-T04 phải kiểm kê quyền cấp phép, dependency và notice trước khi tuyên bố đáp ứng thể lệ. Điều kiện tiên quyết theo thể lệ là giấy phép được OSI công nhận và source truy cập tự do trên Internet; các mục PoF khác là thang điểm/chứng cứ, không được tự gọi tất cả là điều kiện loại trực tiếp.

## 3. Kịch bản chấp nhận A → B → C

Nguồn dữ liệu cụ thể là [demo-fixtures.md](./demo-fixtures.md): mọi lượng `EA` là decimal string; ID trong fixture là nhãn logic, script sẽ lưu UUID thực. A, B, C dùng ba DB riêng; `originLot=(A,A-L1)` được giữ xuyên chuỗi nhưng mỗi bên có local batch riêng. Receipt/issue/receiving là owner movement theo contract; transfer/sale chỉ tham chiếu issue.

| Bước | Hành động qua ứng dụng/API | Tồn A / B / C | Bằng chứng và ràng buộc |
| --- | --- | --- | --- |
| 0 | Admin tạo product, batch, warehouse; batch A từ `inspect` sang `available` có audit | 0 / 0 / 0 | Không seed balance bằng SQL; lô `inspect` không thể issue |
| 1 | A confirm GoodsReceipt 20 | 20 / 0 / 0 | Một +20 movement, audit, outbox sau commit |
| 2–3 | A tạo GoodsIssue 12, Approver khác creator duyệt, confirm; PartnerTransfer 12 link issue | 8 / 0 / 0 | Một −12, một federation outbox; transfer không trừ lần hai |
| 4 | B nhận envelope A và trả technical ACK | 8 / 0 / 0 | Inbox/ACK một lần; ACK không có nghĩa đã nhận hàng |
| 5 | B confirm actual 10 và chuyển batch sau kiểm nguồn sang `available` | 8 / 10 / 0 | Một +10; discrepancy 2; A không bị âm thầm sửa chứng từ xuất |
| 6 | B issue/approve/confirm 6 và transfer 6 sang C | 8 / 4 / 0 | Một −6; B→C giữ origin `(A,A-L1)` và upstream references |
| 7 | C ACK, confirm actual 6, kiểm nguồn rồi cho batch `available` | 8 / 4 / 6 | Một +6; backward trace A→B→C, status nguồn rõ ràng |
| 8 | C issue/approve/confirm 2 purpose `sale`, SaleRecord link issue; tạo QR Passport | **8 / 4 / 4** | Một −2; sale không trừ lần hai; QR chỉ hiện projection công khai |

Cuối luồng, tổng tồn đã biết là 16: 20 ban đầu trừ 2 chênh lệch A→B và 2 đã bán. Đây là kiểm tra số lượng trong demo, không phải kết luận kế toán về số hàng thiếu. A đã xuất 12; B chỉ nhận và cộng 10. Từ một event cuối, người xem phải truy được issuer, source document/event, mapping lô và trạng thái xác minh từng chặng. Forward trace chỉ được nhận là đầy đủ trong phạm vi dữ liệu downstream đã nhận và có quyền xem.

### Happy, error và offline phải chạy được

| Nhánh | Hành động kiểm thử | Kết quả chấp nhận |
| --- | --- | --- |
| **Happy** | Chạy tuần tự 0–8, đăng nhập các vai khác nhau, thao tác không sửa DB bằng tay | Số tồn đúng mỗi bước; approvals, technical ACK, actual receiving, lineage, QR và AI Draft có màn hình/API tương ứng; evidence gắn manifest |
| **Pending/reject** | Draft GoodsIssue hoặc Flowable task chờ/bị từ chối | Không có movement/confirmed trace/outbox; Approver khác người tạo; chỉ trạng thái document/process đổi |
| **Concurrent/duplicate** | Hai issue vượt 20; confirm lặp; cùng idempotency key + cùng/khác payload; nhận lại cùng `messageId` với cùng/khác hash | Một issue fail 409, không âm tồn; retry hợp lệ trả kết quả cũ; payload/hash khác bị 409/audit; không có movement/inbox/receipt trùng |
| **Partial receiving** | B ACK sent 12 rồi confirm actual 10 hai lần | B vẫn 0 sau ACK, sau confirm chỉ +10 một lần; discrepancy 2 và receipt event một lần |
| **Offline B** | Tắt B sau khi A confirm transfer; bật lại và gây mất ACK | A vẫn xử lý nội bộ với tồn 8, outbox pending/retry; B khi hồi phục có một inbox và một pending receiving, không tự cộng stock |
| **Offline A / lệch thứ tự** | Tắt A khi C xem trace; cho C nhận B→C trước upstream reference | C hiển thị summary được phép lưu với `stale/partner-asserted` hoặc gap; không bịa event A; khi upstream tới thì reprocess và cập nhật status |
| **Auth/service failure** | Suspend partner; Staff truy private file; token partner gọi user API; Flowable/scan/AI down | Queue/alert hoặc 403/404 theo policy, không side effect; approval chờ, file fail-closed, AI fallback; không confirm stock trái rule |

Kịch bản này là **hợp đồng kiểm thử**, chưa phải script/seed hoặc tính năng hiện có. P05–P09 tạo fixture idempotent; P13 chạy E2E trên môi trường sạch, lưu video/log/traces đã loại secret và số liệu đối chiếu DB.

## 4. Một ứng dụng tầng 2 H-P-D-I

DX-Lab là **một** workspace H-P-D-I có UI chạy thật ở tầng 2, tách runtime khỏi headless core. ERP Nexora vẫn là ứng dụng nghiệp vụ tầng trên. Tên route chính xác chốt ở contract/UI phase sau; những lát cắt dưới đây là hành vi chấp nhận, không phải yêu cầu mở rộng thành cổng doanh nghiệp tổng quát.

| Không gian | Luồng tối thiểu trong DX-Lab | Dịch vụ lõi/dữ liệu được tiêu thụ | Cách chứng minh không chỉ là màn hình giả |
| --- | --- | --- | --- |
| **H — Human** | Người dùng đăng nhập, xem hồ sơ/quyền và các task được giao; Admin thấy partner theo scope | Identity/SSO, core-data API có quyền | Token/role, 200/403 và cập nhật thật từ instance hiện hành |
| **P — Process** | Staff tạo/chuyển phiếu; Approver nhận task, duyệt/từ chối; B nhập actual receiving | Gateway, Workflow BPMN, API M03 | Task ID/process version và stock trước/sau; pending/reject không làm movement |
| **D — Data** | Xem tồn theo lot, timeline A→B→C, discrepancy, provenance/gap và số liệu lịch sử | Structured data, archive/projection, file evidence có quyền | Truy từ số liệu tới event/source IDs; chạy tình huống A offline và dữ liệu thiếu |
| **I — Intelligence** | Hỏi AI về lot có source; tạo một chứng từ Draft; cảnh báo quy tắc hết hạn/sai lệch | AI service gọi business tools được cấp quyền qua gateway | So kết quả với API; AI không có quyền confirm; Draft không đổi stock |

Không xây email/chat, Kanban, BI tổng quát, RAG/OCR hay POS chỉ để điền đủ tên H/P/D/I. §3 yêu cầu **ít nhất một ứng dụng minh họa** trong không gian H-P-D-I; cách nhóm chọn gộp bốn lát cắt trong DX-Lab là phạm vi dự án và phải chứng minh bằng luồng sống. Độ sâu BTC mong đợi cho từng lát cắt cần hỏi thêm khi có kênh chính thức.

## 5. Cổng nguồn mở, release và nộp bài

- **Điều kiện dự thi và PoF:** Source public truy cập tự do trên Internet; giấy phép thuộc danh sách OSI, nhóm chọn `AGPL-3.0-only` nhưng phải kiểm kê quyền sở hữu/giấy phép dependency. Theo [contest-scorecard.md](./contest-scorecard.md), chuẩn bị SPDX từng file tự viết, full `LICENSE`, attribution, repo web viewer, issue tracker, changelog, tài liệu build từ source và chạy ngoài checkout, release có version **trước lúc gửi bài**. Không bundle hay sửa source dependency trái quy định. PoF 50 điểm và phần sản phẩm/showcase 50 điểm không được gộp thành “chạy demo là đủ”.
- **Mốc nộp đã kiểm tra từ nguồn BTC:** [Bài đề thi trên website chính thức VFOSSA](https://vfossa.vn/tin-tuc/de-thi-phan-mem-nguon-mo-olp-2026-798.html), §5, ghi **17:00 Chủ Nhật 06/12/2026**, thư gửi `olpvietnam@vaip.vn` và `thuky@vfossa.vn`, tiêu đề `BÀI THI PMNM 2026 - [Tên Đội] - [Tên Trường]`. Bản PDF đề thi tại thư mục cha, trang 6 §5, ghi **06/12/2025** và mâu thuẫn với mùa thi/lịch thể lệ 2026. Mốc trong bài VFOSSA là bằng chứng công bố chính thức tại ngày đối chiếu, **chưa phải phản hồi riêng của BTC cho đội**.
- **Việc đội phải làm thủ công, owner: trưởng nhóm/giảng viên hướng dẫn:** xác nhận đăng ký dự thi qua trường; kiểm tra thông báo BTC mới nhất và, nếu cần, hỏi BTC trên kênh công bố để xác nhận hạn/kênh nộp cùng cách hiểu E3-1/E4-2/E4-4; lưu link/ảnh hoặc phản hồi có ngày. Sau khi nộp, giữ email sent/receipt. Agent không được xem `git push`, tag hoặc release là đã nộp bài. Không gửi thư thay đội khi chưa được giao rõ.
- **Gate trước gửi:** clone sạch và chạy lại core/app/A→B→C, license scan, PoF evidence, release/tag/checksum và demo rehearsal; nếu một yêu cầu đề thi §3–4 chưa có minh chứng hoặc cách hiểu còn tranh chấp, đánh dấu rủi ro có owner thay vì tuyên bố đạt.

## 6. Ngoài MVP và quy tắc thay đổi

Theo Chương 6 §6.9, **không triển khai** kế toán/tài chính/công nợ; CRM/loyalty; POS đầy đủ, thanh toán, giá/khuyến mãi; quản trị sản xuất/BOM/lệnh sản xuất; QC nhiều bước/chứng nhận chuyên ngành; thu hồi đa cấp; dashboard phân tích kinh doanh nâng cao; AI tự phê duyệt hay điều phối nhiều nghiệp vụ; Workflow Builder tổng quát; nhân sự/phòng ban phức tạp. Một `SaleRecord` gắn lot, cảnh báo rule đơn giản và một process phê duyệt mẫu vẫn **trong** MVP, không phải phiên bản đầy đủ của những hệ trên. SaaS multi-tenant tập trung không thuộc kiến trúc chọn; A/B/C là instance độc lập.

Mọi đề nghị thêm module/sản phẩm hạ tầng ngoài phạm vi phải ghi: nguồn yêu cầu (BTC hay sản phẩm), AC/§3–4 nào bị ảnh hưởng, test mới, chi phí, chủ sở hữu, và phê duyệt cập nhật scope/ADR/gate. Không tự mở rộng Chương 5/7 thành cam kết MVP. Nếu cách hiểu chính thức của BTC khác bảng này, cập nhật scope và test matrix trước khi làm tiếp các phase phụ thuộc.

## 7. Nguồn đối chiếu và chỗ chưa được chứng minh

| Nguồn | Phần dùng |
| --- | --- |
| `D:\opensource\Đề thi phần mềm nguồn mở - OLP 2026.pdf` | Trang 4–5, §3–4; trang 6, §5 có năm 2025 mâu thuẫn |
| `D:\opensource\Thể lệ cuộc thi phần mềm nguồn mở - OLP 2026.pdf` | Trang 1–3, lịch/điều kiện nguồn mở, PoF và chấm sản phẩm |
| `D:\opensource\Quick-guide-to-DXOS.pdf` | Trang 4–5, đối chiếu PoF và khung H-P-D-I |
| `D:\opensource\Nexora - NEU.OPUS5.5.pdf` và [bản Markdown Chương 6](<../nexora/Nexora - NEU.OPUS5.5.md>) | §6.1–6.10: M01–M04/AI01, loại trừ, AC-01…13 |
| [Nguồn chân lý](../referents/SOURCE_OF_TRUTH.md), [test matrix](./test-matrix.md), [scorecard](./contest-scorecard.md), [demo fixture](./demo-fixtures.md) | Ưu tiên nguồn, mức test/evidence, PoF, số lượng và nhánh lỗi |
| [VFOSSA: đề thi PMNM 2026](https://vfossa.vn/tin-tuc/de-thi-phan-mem-nguon-mo-olp-2026-798.html) | §3–5 online; mốc 17:00 06/12/2026 và kênh nộp tại ngày kiểm tra |

**Chưa được chứng minh chỉ bằng P00-T02:** core đã chạy, AC đạt, mô phỏng IT/OT được BTC chấp nhận, khả năng single-org/instance thỏa diễn giải multi-tenancy, tính tương thích giấy phép mọi dependency, đăng ký và gửi bài hợp lệ. Các mục này phải có test, ADR/license inventory hoặc xác nhận BTC ở task/gate tương ứng.
