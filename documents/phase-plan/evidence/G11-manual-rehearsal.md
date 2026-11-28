# G11 — Hướng dẫn nghiệm thu thủ công DX-Lab

Gate chỉ được ký sau khi người kiểm tra ghi **kết quả thực tế** cho các mục dưới đây. Dùng dữ liệu demo synthetic; không gửi mật khẩu, OTP, token QR còn hiệu lực hoặc ảnh chứa thông tin riêng lên issue/chat công khai. Nếu một điều kiện không có dữ liệu để thử, ghi `BLOCKED` thay vì `PASS`.

## 1. Chuẩn bị bản UI cần kiểm tra (Windows, ổ D)

Mở PowerShell tại checkout đã lấy nhánh `phase13/p13-t09-g11-remediation`. File `a.env` nằm ngoài Git; thay `$instanceEnv` bằng đường dẫn thực trên ổ D. Các lệnh chỉ thay container **DX-Lab A**, không tạo DB mới.

```powershell
Set-Location D:\opensource\Nexora
$instanceEnv = 'D:\opensource\Nexora-phase10\deploy\instances\a.env'
docker build -t nexora-dx-lab:p11-remediation -f apps/dx-lab/Dockerfile .
$env:NEXORA_IMAGE_TAG = 'p11-remediation'
docker compose -p nexora-a --env-file $instanceEnv -f deploy/compose.yml --profile dxlab up -d --no-deps --no-build --force-recreate dx-lab
docker inspect nexora-a-dx-lab-1 --format '{{.Config.Image}} {{.State.Health.Status}}'
```

Chỉ bắt đầu khi dòng cuối là `nexora-dx-lab:p11-remediation healthy`. A: `http://127.0.0.1:19080/dxlab`; B/C khi đã được triển khai: cổng `19081`/`19082`. Trên máy kiểm tra hiện tại B/C chưa chạy và RAM trống lúc rà soát khoảng 1 GiB: **không khởi động đồng thời ba stack trên máy này**. Dùng máy khác hoặc giải phóng tài nguyên theo `deploy/README.md` trước khi làm luồng A→B→C.

## 2. Các bước cần làm và kết quả mong đợi

| Task | Tài khoản / thao tác | Kết quả cần ghi |
| --- | --- | --- |
| T03 H | Staff A mở `/dxlab/work`, `/dxlab/profile`, `/dxlab/partners`, rồi thử `/dxlab/members`. Administrator A mở `/dxlab/members`, mời một tài khoản demo, disable lại; sửa org ở `/dxlab/profile`. Approver A mở `/dxlab/work` với một approval có `evidenceFileIds`. | Staff bị chặn ở Members; Admin lưu được và 409 khi hai tab dùng version cũ; Approver thấy inbox, chỉ metadata tệp `clean` (MIME, bytes, checksum), không thấy raw file/secret. `/work` hiện thông báo nhận hàng đang chờ và phiếu nhận mà actor được quyền đọc. Lặp lại context tổ chức trên B/C khi có stack. |
| T04 P | Với lô demo, Staff mở `/dxlab/operations/receipts`, chọn lô/kho/UOM, xem quality/expiry/balance; tạo Draft, mở chính phiếu qua link, sửa số lượng và lưu. Ở Issues, bấm **Tải nguồn xuất còn hàng**, chọn source, tạo/submit. Approver khác người tạo mở `/dxlab/work/approvals`, approve/reject (reject có lý do); Staff tải lại cho tới khi quyết định rời `decision_pending`, rồi confirm. B Staff mở Receivings, chọn thông báo chuyển hàng đã xác minh và lô nhận phù hợp cho từng dòng, so sánh sent/actual/discrepancy/ACK. | Draft chưa đổi tồn; sửa Draft đổi version; self-approve bị từ chối; `decision_pending` không được coi là đã duyệt; confirm hợp lệ đổi tồn một lần; ACK kỹ thuật không đồng nghĩa nhận hàng. Dùng fixture demo, không xác nhận hàng thật. |
| T05 D | Mở `/dxlab/data/inventory` → một lot → Backward/Forward/Impact, dùng lọc issuer và Trang sau. Trên lot có policy public đã duyệt, bấm **Phát hành QR**, mở link Passport ở trình duyệt riêng không đăng nhập; khi có URL HTTPS mà điện thoại truy cập được thì quét QR trên điện thoại. Kiểm tra tab Network và HTML, sau đó revoke QR bằng công cụ quản lý Passport hiện có. | Nguồn/verification/gap đúng API; không mất node sau 20 mục; Passport chỉ hiện product, lot public, issuer, timeline allowlist, không có giá, email, kho/tồn, credential hay raw payload; token revoked trả trạng thái không hợp lệ. Ghi rõ nếu chưa có policy/token hoặc URL điện thoại truy cập được. |
| T06 I | Sau khi bật AI theo `evidence/G10.md`, hỏi một mã lot trùng issuer, chọn lại đúng issuer; hỏi lot có rủi ro. Đề xuất Receipt Draft, **sửa quantity** trên form AI trước khi bấm **Tạo Draft M03**, mở link đến đúng phiếu, sửa/confirm qua M03. Thử một user không có quyền tool và thử lúc provider dừng. | AI hỏi lại khi mơ hồ; câu trả lời có source/asOf/verification và cảnh báo; user thiếu quyền bị chặn; provider xuống có link xem dữ liệu trực tiếp; chỉ action M03 của người dùng mới làm tồn đổi. Hiện A ERP cũ có thể chưa bật provider: ghi `BLOCKED` nếu chưa triển khai Phase 10 ERP/Ollama/adapter. |
| T07 lỗi mạng | Trên Chrome DevTools → Network → **Offline**, điền form Receipt Draft synthetic rồi bấm Tạo. Bật Online lại, kiểm tra danh sách trước khi thử lại. Sau đó chạy hành trình A→B→C với các vai trò phù hợp, dùng một trình duyệt thật trên mỗi instance. | Form giữ dữ liệu, báo mất kết nối; không tự gửi lại hoặc tạo hai chứng từ. A→B→C có đủ giao dịch, nhận hàng và trace xuyên instance. HTTP smoke hoặc mở trang đơn thuần chưa đủ. |
| T08 khả dụng | Chrome DevTools Device Toolbar ở **360×800** và desktop **1280×800**: chụp H/P/D/I, QR trên điện thoại. Dùng Tab/Shift+Tab/Enter qua form, mở Windows Narrator bằng `Win+Ctrl+Enter` để nghe heading, label, lỗi và nút; thử chuỗi dài, timezone và số thập phân. | Không tràn ngang; thứ tự focus hợp lý; mỗi input có label; lỗi được đọc; nút thực hiện bằng bàn phím; ngày/số không gây hiểu sai; QR quét được. Ghi thiết bị, trình duyệt và screen reader dùng để thử. |

Tài khoản demo và cách bật stack nằm trong `deploy/instances/{a,b,c}.env` (ignored) và `deploy/README.md`. Không chụp màn hình đăng nhập, OTP hoặc mật khẩu. Nếu thiếu dữ liệu cho một mục, ghi tên fixture còn cần seed và tiếp tục mục độc lập.

**QR trên điện thoại:** URL `127.0.0.1` trong QR trỏ tới chính điện thoại nên không mở được A trên máy tính. Khi chạy local, kiểm tra link Passport bằng cửa sổ ẩn danh trên chính máy tính; ghi `BLOCKED` cho bước quét điện thoại. Để nghiệm thu quét thật, triển khai reverse proxy HTTPS có địa chỉ truy cập được từ điện thoại và cấu hình `PUBLIC_BASE_URL` của DX-Lab và ERP theo URL đó (đồng bộ OIDC redirect của Keycloak), rồi phát hành token mới. Không sửa QR thủ công sang HTTP LAN vì như vậy không kiểm chứng URL phát hành thực tế.

**Chuẩn bị policy cho T05:** đăng nhập Administrator A, mở `http://127.0.0.1:19080/trace` → **Passport và mã QR** → nhập ID lô local (lấy từ URL `/dxlab/data/lots/{id}`) → mở **Quản lý chính sách công bố**. Chọn `organization`, `product`, `batch` là `public`; đặt `timeline` là `public` nếu muốn kiểm timeline, còn `evidence` chỉ chọn `public` khi đã có tệp clean được phép công bố. Bấm **Tạo bản nháp**, ghi phiên bản trả về, rồi **Duyệt vN**. Quay lại DX-Lab, nhập chính xác `vN` trong ô phiên bản và bấm **Phát hành QR**. Nếu projection còn stale, dùng chức năng rebuild ở `/trace` và kiểm tra trạng thái trước khi thử lại. Mở link Passport trước khi bấm **Thu hồi QR** trong chính DX-Lab; tải lại link Passport cũ sau thu hồi phải hiện token không hợp lệ. Không chia sẻ token trong chat.

## 3. Mẫu ghi kết quả để chốt gate

```text
Ngày/giờ (Asia/Saigon):
Commit + image tag đang chạy:
Instance / vai trò / trình duyệt / thiết bị:
Task và URL:
Fixture synthetic (ID chứng từ/lô, không có secret):
Các bước đã làm:
Kết quả mong đợi / quan sát: PASS | FAIL | BLOCKED
Ảnh/log đã redacted (đường dẫn hoặc link):
Người kiểm tra và lỗi còn mở:
```

Đội đối chiếu kết quả với `phase-11-dx-lab-ui.md`, `test-matrix.md` và `G11.md`. Chỉ tick các mục còn mở và đổi G11 thành PASS khi mọi điều kiện bắt buộc đã có bằng chứng; cố vấn/owner ghi người duyệt, ngày và commit được duyệt.

## 4. Trả A về image cũ sau buổi kiểm tra

```powershell
Set-Location D:\opensource\Nexora
$env:NEXORA_IMAGE_TAG = 'p11-local'
docker compose -p nexora-a --env-file $instanceEnv -f deploy/compose.yml --profile dxlab up -d --no-deps --no-build --force-recreate dx-lab
docker inspect nexora-a-dx-lab-1 --format '{{.Config.Image}} {{.State.Health.Status}}'
docker image rm nexora-dx-lab:p11-remediation
```

Chỉ gỡ image test sau khi DX-Lab A đã khỏe trên `p11-local`. Model Ollama và volume dữ liệu không bị tác động bởi các lệnh này.
