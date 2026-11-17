# D10 — Một ứng dụng DX-Lab H-P-D-I ở tầng 2

- Ngày: 2026-11-16. Trạng thái: **chấp nhận kiến trúc/UX baseline**, runtime chứng minh ở P11/G11; reviewer thứ hai G00.
- Quyết định: tạo **một** `apps/dx-lab/` Next/React/Tailwind frontend build/deploy riêng với Nexora ERP và core data/file API headless. Bốn vùng H (profile/task), P (approval/giao nhận), D (inventory/trace/gap), I (AI nguồn/Draft) chia sẻ login nhưng mỗi thao tác đi qua gateway, không có DB credential. ERP ở tầng ứng dụng nghiệp vụ khác; DX-Lab chứng minh dịch vụ lõi được app thứ hai tiêu thụ.
- Câu hỏi: làm sao minh chứng không gian H-P-D-I mà không nhầm UI ERP với lõi tầng 1 hoặc dựng bốn app rỗng?

## Lát cắt và acceptance

Route/component/state cụ thể ở `ui-ai-spec-v1.md`; phạm vi nghiệp vụ ở `scope-v1.md`. H: login, vai, task theo quyền. P: GoodsIssue Flowable Approver khác creator, receiving actual vs sent. D: lot timeline A→B→C, source, `partner_asserted/missing`, QR public allowlist. I: getLot/getStock/getTrace dưới user scope, tạo Draft, người dùng tự confirm. Khi **dừng hoàn toàn ERP và DX-Lab**, core SSO/gateway/data/file/workflow vẫn phục vụ các API headless của chính nó. API nghiệp vụ M01–M04 thuộc ERP sẽ dừng cùng ERP; không dùng các route đó để chứng minh core còn chạy. Mỗi vùng phải có loading/error/403/offline state và ít nhất một API/test chạy thật.

Lựa chọn khác (một dashboard trong ERP) bị loại vì không chứng minh ranh giới ứng dụng tầng 2 riêng; bốn app độc lập tốn tài nguyên và tăng rủi ro demo. Không xây email/chat/Kanban/BI tổng quát chỉ để điền chữ H-P-D-I. P00 chưa có runtime DX-Lab; P11 phải chứng minh từ source, gateway trace, browser E2E/mobile và smoke core headless. Team xác nhận UX/thiết kế cuối ở P11, không đánh dấu AC chỉ bởi ADR.
