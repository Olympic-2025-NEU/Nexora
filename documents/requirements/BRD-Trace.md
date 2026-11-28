# TÀI LIỆU ĐẶC TẢ NGHIỆP VỤ & YÊU CẦU HỆ THỐNG (BRD – SRS)

**Phân hệ:** Truy xuất Nguồn gốc Hóa đơn & Quản lý Sự cố Chất lượng Lô hàng (Invoice QR Traceability & Lot Incident Management)

**Hệ thống:** Nexora ERP (Open-Source, Self-Hosted, Single-Enterprise Instance)

**Phiên bản:** 1.0

---

## PHẦN I: BUSINESS REQUIREMENTS DOCUMENT (BRD)

### 1. Mục tiêu nghiệp vụ (Business Objectives)

* **Minh bạch nguồn gốc tới tay người mua:** Cho phép khách hàng cuối hoặc đối tác quét duy nhất **01 mã QR trên hóa đơn bán hàng** để tra cứu toàn bộ sản phẩm, mã lô, ngày sản xuất, hạn sử dụng và hành trình kiểm định của đơn hàng.
* **Khép kín vòng phản hồi chất lượng:** Cho phép khách hàng gửi báo cáo sự cố chất lượng trực tiếp từ từng dòng hàng trong hóa đơn mà không cần cài ứng dụng hay đăng nhập tài khoản.
* **Khoanh vùng rủi ro tức thì:** Tự động liên kết phản ánh của khách hàng với **Mã lô (`Lot ID`)** thực tế đã xuất kho, hỗ trợ bộ phận QA/Kho phát hiện lô lỗi sớm, tạm khóa xuất bán (`Quarantine`) hoặc kích hoạt thu hồi (`Recall`).
* **Bảo toàn tính toàn vẹn dữ liệu:** Đảm bảo mọi thông tin truy xuất và lịch sử khiếu nại được lưu vết bất biến (Immutable Audit), tách biệt hoàn toàn giữa dữ liệu công khai và dữ liệu nhạy cảm nội bộ.

### 2. Phạm vi hệ thống (Scope)

* **Trong phạm vi (In-Scope):**
* Tự động sinh `public_trace_token` duy nhất cho mỗi hóa đơn bán hàng phát sinh xuất kho theo lô.
* Hiển thị và in mã QR tổng trên mẫu hóa đơn bán hàng (A4, A5, hóa đơn nhiệt POS) trỏ về `https://{enterprise-domain}/trace/{public_trace_token}`.
* Cổng tra cứu công khai (Public Trace Portal) hiển thị danh sách sản phẩm theo hóa đơn, chi tiết nguồn gốc từng lô và biểu mẫu báo cáo sự cố cho từng dòng hàng.
* Phân hệ tiếp nhận, phân loại sự cố, cảnh báo ngưỡng lỗi theo lô và khóa/thu hồi lô trong nội bộ Nexora.


* **Ngoài phạm vi (Out-of-Scope):**
* Chia sẻ dữ liệu liên doanh nghiệp tự động (Multi-tenant SaaS); việc liên thông chuỗi cung ứng nếu có sẽ thông qua API/Event opt-in riêng.
* Tích hợp cổng thanh toán hoàn tiền tự động khi phát sinh khiếu nại.



### 3. Các bên liên quan & Vai trò (Stakeholders & Actors)

| Vai trò | Mô tả hành vi chính |
| --- | --- |
| **Khách hàng / Người nhận hàng** | Quét mã QR trên hóa đơn, kiểm tra thông tin sản phẩm/lô, gửi báo cáo sự cố kèm ảnh/video bằng chứng và theo dõi trạng thái xử lý. |
| **Nhân viên Bán hàng / Thu ngân** | Tạo hóa đơn bán hàng, xác nhận xuất kho theo lô, in/gửi hóa đơn có gắn mã QR tổng. |
| **Nhân viên QA / CSKH** | Tiếp nhận phiếu sự cố từ QR, đối chiếu bằng chứng, xác minh nguyên nhân và cập nhật kết quả xử lý. |
| **Quản lý Kho / Vận hành** | Nhận cảnh báo khi một lô vượt ngưỡng báo cáo lỗi, thực hiện tạm khóa tồn kho (`Hold/Quarantine`) hoặc kích hoạt thu hồi lô (`Recall`). |
| **Quản trị viên Hệ thống (Admin)** | Cấu hình tên miền doanh nghiệp, chính sách hiển thị trường thông tin công khai, ngưỡng cảnh báo lô và giới hạn chống spam. |

---

## PHẦN II: SYSTEM REQUIREMENTS SPECIFICATION (SRS)

### 1. Luồng nghiệp vụ tổng thể (End-to-End Workflow)

1. **Phát hành hóa đơn & Sinh Token:** Khi hóa đơn bán hàng chuyển sang trạng thái hoàn tất xuất kho (`Completed / Shipped`), hệ thống sinh 01 `public_trace_token` ngẫu nhiên, duy nhất, liên kết với `invoice_id` và chụp ảnh dữ liệu truy xuất tại thời điểm xuất (`Trace Snapshot`).
2. **In ấn & Trao hóa đơn:** Hệ thống render mã QR từ URL `https://{domain}/trace/{public_trace_token}` lên hóa đơn kèm hướng dẫn quét mã.
3. **Quét mã & Xem danh sách mặt hàng:** Khách hàng quét QR mở giao diện Mobile-first Public Portal $\rightarrow$ Hệ thống hiển thị thông tin xác thực doanh nghiệp, thông tin chung hóa đơn (đã ẩn dữ liệu nhạy cảm) và danh sách các dòng sản phẩm/lô thuộc hóa đơn đó.
4. **Xem phả hệ lô & Gửi báo cáo sự cố:** Khách hàng chọn một dòng sản phẩm cụ thể $\rightarrow$ Xem chi tiết lô (NSX, HSD, chứng nhận, trạng thái lô) $\rightarrow$ Bấm **"Báo cáo vấn đề"** $\rightarrow$ Chọn loại lỗi, số lượng lỗi, đính kèm ảnh/video thực tế, nhập thông tin liên hệ và gửi.
5. **Tiếp nhận & Cảnh báo tự động:** Hệ thống tạo `Lot Incident Ticket` gắn cứng với `invoice_item_id` và `lot_id`. Nếu tổng số báo cáo hợp lệ của `lot_id` đạt ngưỡng cấu hình (VD: $\ge 3$ hóa đơn độc lập), hệ thống phát cảnh báo đỏ cho Quản lý Kho/QA.
6. **Xử lý & Cập nhật trạng thái lô:** QA/Kho xác minh, cập nhật trạng thái phiếu sự cố và (nếu cần) chuyển trạng thái lô sang `QUARANTINED` hoặc `RECALLED`. Trạng thái thu hồi lập tức phản ánh lên Public Portal khi bất kỳ khách hàng nào quét QR có chứa lô đó.

---

### 2. Yêu cầu chức năng (Functional Requirements)

#### FR-01: Quản lý Token Truy xuất Hóa đơn

* **FR-01.1:** Mỗi hóa đơn bán hàng có ít nhất 01 dòng hàng quản lý theo lô sẽ tự động được cấp 01 `public_trace_token` (chuỗi ngẫu nhiên tối thiểu 32 ký tự URL-safe, không sử dụng ID tự tăng).
* **FR-01.2:** Token không hết hạn khi hóa đơn đã hoàn tất (đảm bảo khách hàng có thể truy xuất trong suốt vòng đời sử dụng sản phẩm).
* **FR-01.3:** Cho phép Admin thu hồi hoặc cấp lại token trong trường hợp hóa đơn bị hủy/lập lại do sai sót nghiệp vụ trước khi giao hàng.

#### FR-02: Hiển thị Mã QR trên Hóa đơn

* **FR-02.1:** Tích hợp thành phần QR Code vào mẫu in hóa đơn (POS nhiệt 58mm/80mm, A5, A4) và bản xuất PDF hóa đơn điện tử.
* **FR-02.2:** Nội dung mã hóa QR chỉ chứa URL đầy đủ `https://{configured_domain}/trace/{public_trace_token}` để đảm bảo tốc độ quét cao trên mọi camera điện thoại.

#### FR-03: Cổng Tra cứu Công khai (Public Trace Portal)

* **FR-03.1 (Xác thực & Header):** Hiển thị logo doanh nghiệp, tên đơn vị phát hành, mã hóa đơn rút gọn (che một phần ký tự nếu cấu hình), ngày mua hàng và badge xác thực nguồn gốc.
* **FR-03.2 (Danh sách dòng hàng theo lô):** Liệt kê toàn bộ sản phẩm trong hóa đơn. Nếu 01 sản phẩm trên hóa đơn được xuất từ nhiều lô khác nhau (VD: 3 hộp `LOT-A` và 2 hộp `LOT-B`), giao diện tách rõ từng dòng theo lô để khách báo cáo chính xác.
* **FR-03.3 (Chi tiết nguồn gốc lô):** Khi bấm vào từng dòng hàng, hiển thị: Tên sản phẩm, Mã lô (`Lot Number`), Ngày sản xuất, Hạn sử dụng, Trạng thái an toàn của lô (`Bình thường` / `Đang kiểm tra` / `Thu hồi`), và các mốc hành trình/chứng nhận được phép công khai.
* **FR-03.4 (Cảnh báo thu hồi chủ động):** Nếu lô hàng đang ở trạng thái `RECALLED`, hiển thị banner cảnh báo nổi bật ngay đầu trang kèm hướng dẫn liên hệ thu hồi/đổi trả.

#### FR-04: Gửi & Theo dõi Báo cáo Sự cố từ Khách hàng

* **FR-04.1:** Tại mỗi dòng sản phẩm/lô trong hóa đơn, hiển thị nút **"Báo cáo vấn đề"**.
* **FR-04.2:** Biểu mẫu báo cáo bao gồm:
* Danh mục lỗi bắt buộc: *Hư hỏng / Biến chất*, *Hết hạn / Cận date*, *Bao bì rách / Thiếu hàng*, *Nghi ngờ tem nhãn / Hàng giả*, *Khác*.
* Số lượng sản phẩm gặp vấn đề (ràng buộc: $1 \le \text{số lượng lỗi} \le \text{số lượng mua của dòng hàng đó}$).
* Mô tả chi tiết (tối đa 1.000 ký tự).
* Tải lên bằng chứng: Tối đa 5 tệp ảnh/video (JPG, PNG, WEBP, MP4), hỗ trợ mở trực tiếp camera trên trình duyệt di động.
* Thông tin liên hệ khách hàng: Họ tên, Số điện thoại / Email.


* **FR-04.3:** Sau khi gửi thành công, hệ thống cấp **Mã tra cứu phản ánh** (VD: `INC-2026-0042`) và hiển thị tiến độ xử lý (*Đã tiếp nhận* $\rightarrow$ *Đang xác minh* $\rightarrow$ *Đã xử lý / Đã từ chối kèm lý do*) ngay trên giao diện QR của hóa đơn đó.

#### FR-05: Quản lý Sự cố & Khoanh vùng Lô Nội bộ (Back-Office)

* **FR-05.1:** Cung cấp màn hình danh sách & chi tiết **Sự cố Chất lượng Lô** trong phân hệ Truy xuất / Kho.
* **FR-05.2:** Hiển thị ngữ cảnh đầy đủ trên phiếu sự cố: Thông tin khách phản ánh, ảnh/video bằng chứng, link tới Hóa đơn gốc, link tới Phiếu nhập kho đầu vào của Lô, Nhà cung cấp và danh sách các hóa đơn khác đã xuất cùng Lô đó.
* **FR-05.3:** **Cảnh báo ngưỡng tự động:** Khi một `lot_id` phát sinh từ $N$ báo cáo sự cố trở lên (mặc định $N = 3$, cấu hình được), hệ thống gửi thông báo ưu tiên cao tới Quản lý Kho/QA và đề xuất hành động **"Tạm khóa xuất lô (Quarantine)"**.
* **FR-05.4:** Khi lô chuyển sang `QUARANTINED` hoặc `RECALLED`, hệ thống kho tự động chặn chọn lô này trong mọi giao dịch xuất bán/luân chuyển mới.

---

### 3. Yêu cầu Phi chức năng & Bảo mật (Non-Functional & Security Requirements)

* **NFR-01 (Kiến trúc & Bất biến dữ liệu):**
* Tuân thủ kiến trúc Modular Monolith của Nexora; module `Traceability` giao tiếp với `Sales` và `Inventory` qua Domain Events / Service Interfaces rõ ràng.
* Dữ liệu báo cáo sự cố và lịch sử thay đổi trạng thái lô là **Append-Only / Immutable**; cấm xóa cứng bản ghi sự cố hoặc sửa đổi dấu vết lô lịch sử.


* **NFR-02 (Bảo mật cổng Public & Chống rò rỉ dữ liệu):**
* **Zero Sensitive Data Exposure:** API public `/api/public/trace/{token}` tuyệt đối không trả về giá nhập, giá vốn, biên lợi nhuận, tồn kho hiện tại, tên nhà cung cấp nội bộ (trừ khi bật tùy chọn công khai nguồn gốc) hoặc thông tin khách hàng khác.
* **Rate Limiting & Anti-Spam:** Giới hạn số lượt truy cập theo IP, áp dụng CAPTCHA ẩn/challenge khi gửi báo cáo, và giới hạn tối đa số lần gửi báo cáo trên mỗi `invoice_item_id` (VD: tối đa 3 lần/dòng hàng) để chống spam làm nhiễu cảnh báo khóa lô.
* **Bảo mật tệp tải lên:** Kiểm tra MIME-type thực tế, giới hạn dung lượng tệp (VD: tối đa 10MB/ảnh, 30MB/video), đổi tên tệp ngẫu nhiên và lưu trữ tách biệt khỏi thư mục thực thi mã nguồn.


* **NFR-03 (Hiệu năng):**
* Trang Public Trace Portal đạt thời gian tải đầu tiên (FCP) dưới `1.5 giây` trên mạng di động 4G, tối ưu giao diện Mobile-first không cần tải bundle nặng của trang quản trị ERP.



---

### 4. Mô hình Dữ liệu Đề xuất (Core Entities)

```text
1. invoice_trace_tokens
   - id (PK)
   - invoice_id (FK, Unique)
   - token (VARCHAR(64), Unique, Indexed)
   - status (ENUM: ACTIVE, REVOKED)
   - snapshot_data (JSONB — lưu thông tin sản phẩm/lô tại thời điểm xuất)
   - created_at

2. lot_incidents
   - id (PK)
   - incident_code (VARCHAR(32), Unique — VD: INC-2026-0042)
   - trace_token_id (FK -> invoice_trace_tokens.id)
   - invoice_id (FK)
   - invoice_item_id (FK)
   - product_id (FK)
   - lot_id (FK -> inventory_lots.id, Indexed)
   - issue_type (ENUM: DAMAGED, EXPIRED, PACKAGING_QUANTITY, COUNTERFEIT_SUSPECT, OTHER)
   - affected_quantity (DECIMAL)
   - description (TEXT)
   - reporter_name (VARCHAR)
   - reporter_contact (VARCHAR)
   - status (ENUM: SUBMITTED, INVESTIGATING, RESOLVED, REJECTED)
   - resolution_note (TEXT, Nullable)
   - resolved_by (FK -> users.id, Nullable)
   - created_at, updated_at

3. lot_incident_evidences
   - id (PK)
   - incident_id (FK -> lot_incidents.id)
   - file_path (VARCHAR)
   - file_type (ENUM: IMAGE, VIDEO)
   - checksum_sha256 (VARCHAR(64))
   - uploaded_at

4. lot_status_audits (Lưu vết khóa / thu hồi lô)
   - id (PK)
   - lot_id (FK -> inventory_lots.id)
   - previous_status (VARCHAR)
   - new_status (ENUM: ACTIVE, QUARANTINED, RECALLED)
   - reason (TEXT)
   - triggered_by_incident_id (FK -> lot_incidents.id, Nullable)
   - changed_by (FK -> users.id)
   - created_at

```

---

### 5. Tiêu chí Nghiệm thu (Acceptance Criteria)

* [ ] Khi hoàn tất 01 hóa đơn có 2 sản phẩm (trong đó 1 sản phẩm xuất từ 2 lô khác nhau), hệ thống tạo đúng 01 `public_trace_token` và hiển thị đủ 3 dòng chi tiết lô khi quét QR.
* [ ] Khi gửi báo cáo sự cố với số lượng lớn hơn số lượng đã mua trên hóa đơn, hệ thống chặn và trả về thông báo lỗi hợp lệ.
* [ ] Khi 03 hóa đơn độc lập cùng báo lỗi cho `LOT-X`, trạng thái `LOT-X` phát cảnh báo cho Quản lý Kho; sau khi chuyển sang `QUARANTINED`, nhân viên bán hàng không thể tạo phiếu xuất mới lấy hàng từ `LOT-X`.
* [ ] Khi `LOT-X` chuyển sang `RECALLED`, bất kỳ khách hàng nào quét QR của hóa đơn có chứa `LOT-X` đều thấy cảnh báo thu hồi màu đỏ trên màn hình điện thoại.
* [ ] Dữ liệu phản hồi của API public không chứa bất kỳ thông tin nào về giá vốn, tồn kho còn lại hay dữ liệu của hóa đơn khác.

---