# BRD — Liên kết doanh nghiệp (partner link)

**Status:** Living appendix (aligned to self-host + opt-in inter-enterprise notices)  
**Audience:** Product / admin UX  
**Transport:** unchanged (D05/D08 under the hood). This document defines **business language**, onboarding, and the **unified Partner model** only.

## 1. Business model

- Mỗi doanh nghiệp tự vận hành một bản Nexora trên tên miền / VPS / máy chủ riêng.
- Hai doanh nghiệp cùng dùng Nexora có thể **chủ động** liên kết để gửi/nhận thông báo nghiệp vụ (ví dụ chuyển hàng liên DN).
- Không có nền tảng trung tâm dùng chung database; không tự động tìm đối tác trên mạng.

### 1.1 Partner thống nhất (supplier / customer theo chứng từ)

Trong thực tế, khi **một bên xuất hàng và một bên nhận hàng**, hai đơn vị chính là **nhà cung cấp** và **bên nhận (customer)** của nhau trên chiều đó — kết nối qua Nexora.

| Khái niệm | Quy tắc sản phẩm |
| --- | --- |
| **Partner** (`system.partner`) | Một thực thể duy nhất: doanh nghiệp đã đăng ký trên instance, có thể thiết lập liên kết hệ thống. |
| **Liên kết** (`partner_connection`) | Kênh gửi/nhận thông báo nghiệp vụ hai chiều giữa hai instance Nexora. |
| **Supplier / Customer** | **Không** gắn cố định lên bản ghi Partner. Vai trò suy ra từ **chiều chứng từ**: bên xuất = nhà cung cấp; bên nhận = bên nhận hàng. Chiều ngược lại thì vai trò đảo. |
| **UI chứng từ** | Dùng nhãn **Đối tác nhận** / **Đối tác gửi** (hoặc tương đương), không bắt chọn “là NCC” / “là KH” trên master Partner. |

**Không làm (MVP):** tách danh mục “Nhà cung cấp” và “Khách hàng” chỉ vì hai DN cùng dùng Nexora; không biến Partner thành master CRM khách/NCC thuần (không có instance Nexora) — xem [`BRD.md`](./BRD.md) §5.

**NCC lẻ (ADR 0020):** nhà cung cấp không dùng Nexora là aggregate riêng `catalog.local_supplier`, UI `/trading/suppliers` và gắn trên phiếu nhập nội bộ (`goods_receipt` / `/trading/inbound`). Không tạo `partner_connection`, không giả `issuerInstanceId`.

## 2. Thuật ngữ UI (bắt buộc)

| Không dùng trên UI người dùng | Dùng trên UI |
| --- | --- |
| Federation / M2M / Keycloak / outbox / inbox / envelope | Liên kết đối tác / thông báo nghiệp vụ |
| endpointUrl | Địa chỉ nhận thông báo |
| issuerInstanceId | Mã định danh hệ thống |
| outboundClientId / secret | Mã ủy quyền gửi đi / tham chiếu mật khẩu ủy quyền |
| inboundClientId | Mã đối tác được phép gửi đến chúng ta |
| Dead letter / Reprocess | Gửi lại thông báo lỗi / Xử lý lại thông báo |
| Vận hành federation | Theo dõi liên kết đối tác |
| Master “Supplier” / “Customer” cố định trên Partner | Đối tác; trên chứng từ: Đối tác gửi / Đối tác nhận |

## 3. Onboarding (nghiệp vụ)

1. Hai bên trao đổi mã định danh hệ thống và thông tin ủy quyền qua kênh nội bộ an toàn.
2. Mỗi bên thêm đối tác trên **Kết nối đối tác** (`/partners`), nhập địa chỉ hệ thống đối tác; hệ thống điền sẵn địa chỉ nhận thông báo mặc định (`https://{domain}/api/v1/federation/events`).
3. Cấu hình ủy quyền hai chiều và lưu liên kết.
4. Kiểm tra liên kết; chỉ khi ổn mới dùng luồng chuyển/nhận hàng liên DN (khi xuất, bên bạn là nhà cung cấp trên chiều đó; khi nhận, bên bạn là bên nhận).
5. Sự cố gửi nhận: dùng khu vực theo dõi liên kết ngay trên màn hình **Kết nối đối tác**.

## 4. Success criteria

- Admin cấu hình được liên kết mà không cần đọc ADR kỹ thuật.
- Một giao diện `/partners`: CRUD đối tác + thiết lập liên kết (modal) + theo dõi gửi/nhận; copy VI/EN không lộ jargon vận hành nội bộ.
- Copy và tài liệu làm rõ: Partner thống nhất; supplier/customer theo chiều xuất–nhận, không nhân đôi master.
- API/contract federation không đổi chỉ vì đổi wording.
