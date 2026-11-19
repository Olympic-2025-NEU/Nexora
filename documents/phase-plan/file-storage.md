# P03 file storage v1 — upload, quyền và reconciliation

## Ranh giới dữ liệu

- D02 dùng SeaweedFS 4.53 với bucket vật lý riêng cho `quarantine`, `private`, `public` mỗi instance. Bảng `platform.attachment.bucket` lưu **loại bucket**, không lưu tên vật lý. `core-data` giữ credential S3 nội bộ; browser/DX-Lab không nhận credential hoặc URL bucket private. Bucket không có public-read ACL. Core được `List` chỉ ở quarantine để dọn orphan.
- `POST /api/v1/files` yêu cầu Bearer OIDC có chữ ký/issuer/audience hợp lệ, membership active thuộc instance, role Administrator hoặc Staff và `Idempotency-Key` 16–128 ký tự. Core tự xác thực lại; không tin header danh tính do client gửi. Gateway định tuyến cả `/api/v1/files` và `/api/v1/files/{id}` đến Core.
- T04 chỉ tạo tệp **chưa link owner**: `owner_type='core_record'`, `owner_id=NULL`, `visibility='private'`. `ownerType`/`ownerId` từ request và visibility khác private bị 422 cho tới khi T07 có policy owner thực. Không lấy tên file từ client làm S3 key. Key `pending/<UUID ngẫu nhiên>` không chứa tên, ID hay token.
- MIME v1: PDF, PNG, JPEG, UTF-8 plain text; kiểm chữ ký/UTF-8 và kích thước 1 byte đến 10 MiB. HTML/SVG/ZIP/executable và MIME khai sai bị từ chối. T04 chưa chứng nhận tệp sạch: object ở quarantine, metadata `scan_state='pending'`; scanner T05 mới quyết định `clean`/`infected`/`error` và chuyển object hợp lệ sang private.

## Thứ tự ghi và bù lỗi

1. Xác thực/phân quyền, parse multipart có giới hạn, SHA-256 bytes, kiểm replay trong PG theo hash của actor + route + key. Cùng key/cùng nội dung trả lại attachment ID; cùng key/khác nội dung trả 409.
2. PUT bytes vào bucket quarantine. S3 lỗi thì không tạo metadata. Sau PUT, một transaction PG tạo `attachment` và success audit cùng request ID. PG/audit lỗi thì xóa object bù; nếu thao tác xóa lỗi, ghi reason code và reconciler xử lý sau.
3. `file-reconciler` chạy khi profile `apps` bật, mỗi 15 phút. Nó chỉ xóa `pending/` object quá 15 phút **không có** metadata; nếu attachment `pending` quá hạn nhưng object mất, tăng version, đặt `error` và ghi audit cùng transaction. Chạy lại không tạo tác động thứ hai. Không dùng reconciler để promote file sạch hoặc xóa file có metadata.

## Đọc và vận hành

- `GET /api/v1/files/{id}` trả metadata cho uploader hoặc Administrator; người khác nhận 404 để không lộ sự tồn tại. `?download=1` chỉ stream khi row `clean`, bucket `private`, visibility `private`, actor có quyền và SHA-256/kích thước khớp metadata. Pending/infected/error nhận 423. Bytes trả với `Content-Disposition: attachment`, `nosniff`, CSP sandbox và `no-store`; successful download có audit. Không có presigned URL public ở v1.
- Backup DB và SeaweedFS phải cùng tập snapshot/manifest ở T06; attachment chứa checksum để so sau restore. T04 integration test dùng DB + bucket tạm riêng và volume tạm, kiểm compensation và restart. `npm run test:platform:files` chạy bài test đó; không dùng credential instance thật.
- T05 phải bổ sung scanner và thao tác admin xử lý error/infected. T07 phải bổ sung owner link/resource policy, structured records và smoke qua gateway khi UI tắt. Cho tới lúc đó, file chưa gắn chứng từ/lô và không được gọi là evidence công khai.
