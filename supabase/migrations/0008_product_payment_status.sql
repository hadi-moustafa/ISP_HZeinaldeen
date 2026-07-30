-- Lets the inventory page color-code a sale movement by whether the ISP has
-- actually been paid for it: sold & paid, sold but unpaid, or partially
-- paid. Meaningful only for movement_type = 'sale'; defaults to 'paid' for
-- restock/adjustment/return since those aren't sales owed by a customer.
ALTER TABLE product_movements
  ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('paid', 'unpaid', 'partial'));
