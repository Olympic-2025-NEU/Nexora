# D02 — Object storage và file riêng tư

- Ngày: 2026-11-17. Trạng thái: **chọn SeaweedFS S3 API cho P01/P03** dựa trên spike; full volume restore, scanner, policy và reviewer G00 còn mở.
- Câu hỏi: chọn storage S3 tự host có source và image phiên bản xác định, URL ký, file riêng tư và đường phục hồi như thế nào?
- Quyết định: `chrislusf/seaweedfs:4.53@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0`. Tách namespace/bucket `quarantine`, `private`, `public` theo instance; object key và checksum lưu metadata tại core API. Chỉ core/worker có credential S3; browser chỉ nhận URL ký ngắn hạn sau authz. [Source/tag 4.53](https://github.com/seaweedfs/seaweedfs/releases/tag/4.53), [license Apache-2.0](https://github.com/seaweedfs/seaweedfs/blob/4.53/LICENSE).

## Phương án và tiêu chí

SeaweedFS qua tiêu chí S3 PUT/GET riêng tư, presigned GET, volume tồn tại qua restart, logical backup/restore và build từ source. MinIO Community là phương án S3 khác nhưng không chọn trong baseline này; nếu đổi phải test lại image/source/license, bucket policy và backup, không đổi ngầm chỉ vì SDK cùng chuẩn. Không dùng filesystem của Next làm nơi lưu bằng chứng.

## Spike và giới hạn

[Compose/smoke D02](../phase-plan/evidence/spikes/infra/README.md): unsigned GET 403, presigned GET 200, object còn sau restart; backup bằng GET, xóa scratch object và PUT phục hồi cho cùng SHA-256 `6fd0bb7258ef62dd33a5d436ab00b730b91c1b58e648895002906c5acef5e4ba`. Đây là **logical object restore**, chưa phải khôi phục toàn bộ filer/master/volume hay DB metadata. Container RAM **152.7 MiB snapshot**, không phải peak/full stack.

Tarball tag 4.53 commit `4ab66fb` SHA-256 `d499b380cb22fb6c1dedd8e11ba62958ffe7f655dc4655f6993e578ccb8b0f4b0`; binary Linux amd64 build bằng `golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36`, SHA-256 `41ae42900d747de851c166c80410919335683bf01a4bdfbf7a122d04e25a857f`, lệnh `weed version` in `4.53`. Source build pass; chưa chứng minh image phát hành byte-for-byte từ source hay giấy phép transitive dependency.

Lệnh build cô lập với `--memory=6g`, `GOMAXPROCS=2`, `go build -p 2 -trimpath` trong [README spike](../phase-plan/evidence/spikes/infra/README.md) chạy lại exit 0; binary thứ hai SHA-256 `fd39922d6add08c4ce019e6a34536fa92f452f67205a8289b4858947d3c6fa12`, version vẫn 4.53. Một lần build không giới hạn khi cả stack spike đang chạy làm Docker Engine reset, nên build/release cần chạy tách khỏi demo và đo peak RAM. Hash hai binary khác nhau; không nhận là bit-for-bit reproducible.

P03 phải triển khai API upload/metadata riêng, scan ClamAV fail-closed trước khi đổi visibility, kiểm authz/expiry/size/MIME/checksum, bucket ACL không public nhầm, backup DB+object và **full volume restore**. P00-T04/D13 rà SBOM/notice. Không gọi private object spike là file service ứng dụng đã xong.
