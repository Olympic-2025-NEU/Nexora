<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# BRD — Commercial sales order (POS / orders)

**Status:** Requirements accepted — **2026-11-28**  
**Companion SRS:** [`SRS-sales-order.md`](./SRS-sales-order.md)  
**ADR:** [`0019-commercial-sales-order.md`](../adr/0019-commercial-sales-order.md)  
**Trace companion:** [`BRD-Trace.md`](./BRD-Trace.md)

## 1. Business problem

Thu ngân / bán hàng cần tạo đơn bán có giá, thanh toán, trừ tồn theo lô, và trao khách một mã QR truy xuất trên hóa đơn — tách khỏi chứng từ `sale_record` không tiền.

## 2. Actors

| Actor | Intent |
| --- | --- |
| Sales clerk / cashier | Tạo đơn POS, thanh toán, in/xem QR |
| Staff / Admin | Đọc đơn, hủy draft, revoke/reissue token |
| Customer (follow-on) | Quét QR công khai (portal out of this slice) |

## 3. Epics

| ID | Epic | Tóm tắt |
| --- | --- | --- |
| NX-SO-01 | Commercial order | Header + lines với snapshot giá niêm yết |
| NX-SO-02 | POS checkout | Paid → FEFO lots → GI sale confirm → fulfilled |
| NX-SO-03 | Invoice QR token | Mint `public_trace_token` + QR URL khi fulfilled (lot-managed) |
| NX-SO-04 | Trace continuity | Optional link `sale_record` / issue; giữ sales-records API cho ops không tiền |

## 4. Business rules

- Order stores **list price**, not COGS.
- Stock only via confirmed `goods_issue` purpose `sale` (D14).
- Every fulfilled order with ≥1 lot line mints one active invoice token (BRD-Trace FR-01).
- QR encodes `PUBLIC_BASE_URL/trace/{token}` only (FR-02).
- Public snapshot never includes price, payment, COGS, warehouse internals, or customer PII.

## 5. Out of scope (this slice)

- Full Public Trace Portal UI, CAPTCHA, incident tickets (BRD-Trace FR-03–05).
- Promotions, split tender, AR/AP, multi-currency beyond one list currency.
