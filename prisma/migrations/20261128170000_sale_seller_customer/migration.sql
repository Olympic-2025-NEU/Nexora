-- SPDX-License-Identifier: AGPL-3.0-only
-- Sale create metadata: optional seller membership + customer partner (POS / orders UI).
BEGIN;

ALTER TABLE trading.sale_detail
  ADD COLUMN seller_membership_id uuid REFERENCES system.membership(id) ON DELETE RESTRICT,
  ADD COLUMN customer_partner_id uuid REFERENCES system.partner(id) ON DELETE RESTRICT;

CREATE INDEX idx_trading_sale_seller ON trading.sale_detail(seller_membership_id);
CREATE INDEX idx_trading_sale_customer ON trading.sale_detail(customer_partner_id);

COMMIT;
