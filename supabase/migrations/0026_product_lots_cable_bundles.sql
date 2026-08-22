-- Inventory overhaul: stock batches (same product bought again at a
-- different cost/sell price), cable products (continuous length, sold in
-- pieces at a flat per-unit price regardless of exact meters used), and
-- bundles (a fixed-price kit of several real products sold as one line).
--
-- One mechanism covers all three asks instead of three parallel systems:
--   - product_lots: one row per purchase batch. Buying the same product
--     again at a different cost just means inserting another lot -- this
--     alone is "add new stock under the same name with a different cost
--     and sell price." Sales auto-pick the oldest lot with enough
--     quantity (FIFO, confirmed with the client -- no staff batch picker).
--     Deliberately NOT split across lots: a sale that needs more than any
--     single lot currently holds is rejected with a clear error asking
--     staff to split it into two smaller sales, rather than fragmenting
--     one sale's amount_paid/payment_status across multiple movement rows.
--   - product_movements.total_amount: nullable override for "what this
--     line actually charges," used only when the charge isn't
--     unit_price * quantity (cable's flat per-unit price regardless of
--     meters used; a bundle's custom price). NULL for every existing/
--     standard-product row, so all pre-existing money math is untouched
--     unless explicitly switched to COALESCE(total_amount, unit_price *
--     abs(quantity)).
--   - bundle_items: a bundle is itself a products row (product_type=
--     'bundle', no lots/stock of its own) listing the real products (and
--     quantities) it deducts stock from when sold.

ALTER TABLE products
  ADD COLUMN product_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (product_type IN ('standard', 'cable', 'bundle')),
  ADD COLUMN cable_unit_length DECIMAL(10,2); -- e.g. 70 (m) -- display context only, never a formula input

-- monthly_financials (0001_init.sql) reads product_movements.quantity
-- directly (SUM(quantity * unit_price * -1)) via a view rule, which blocks
-- widening the column's type underneath it -- drop and recreate around the
-- ALTER. Recreation also fixes the same total_amount-override gap this
-- migration fixes everywhere else: a cable/bundle sale's real revenue is
-- its total_amount, not quantity * unit_price (meters used or "1 bundle"
-- times a possibly-NULL unit_price is not the charged amount).
DROP VIEW monthly_financials;

-- Widen from INTEGER: cable stock is measured in fractional meters, and a
-- lot's remaining quantity needs the same precision. Existing integer
-- values cast losslessly.
ALTER TABLE products ALTER COLUMN quantity_in_stock TYPE DECIMAL(10,2) USING quantity_in_stock::DECIMAL(10,2);
ALTER TABLE product_movements ALTER COLUMN quantity TYPE DECIMAL(10,2) USING quantity::DECIMAL(10,2);

CREATE TABLE product_lots (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    cost_price        DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    sell_price        DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
    quantity_in_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
    received_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    note              TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_lots_product_id ON product_lots(product_id);

ALTER TABLE product_movements
  ADD COLUMN lot_id UUID REFERENCES product_lots(id) ON DELETE SET NULL,
  ADD COLUMN total_amount DECIMAL(10,2);
CREATE INDEX idx_product_movements_lot_id ON product_movements(lot_id);

CREATE TABLE bundle_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity   DECIMAL(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    UNIQUE(bundle_id, product_id)
);
CREATE INDEX idx_bundle_items_bundle_id ON bundle_items(bundle_id);

-- Backfill: every existing product's current cost/sell/stock becomes its
-- first lot, so nothing already on hand is lost when lots become the
-- source of truth for "what will the next sale actually charge."
-- Historical product_movements rows are left with lot_id NULL -- there's
-- no reliable way to attribute past sales to a specific batch after the
-- fact, and products.quantity_in_stock (the real trigger-maintained
-- total) is untouched by this, so no stock figure changes.
INSERT INTO product_lots (product_id, cost_price, sell_price, quantity_in_stock, received_date)
SELECT id, cost_price, sell_price, quantity_in_stock, CURRENT_DATE
FROM products
WHERE quantity_in_stock > 0 OR cost_price > 0 OR sell_price > 0;

-- Keeps a lot's own remaining quantity in sync whenever a sale/adjustment/
-- return movement targets it. Restock is deliberately excluded: a restock
-- movement always accompanies a brand-new lot (via restock_product_lot()
-- below), which already sets that lot's initial quantity directly --
-- applying this trigger too would double-count it.
CREATE OR REPLACE FUNCTION apply_lot_movement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lot_id IS NOT NULL AND NEW.movement_type != 'restock' THEN
    UPDATE product_lots
    SET quantity_in_stock = quantity_in_stock + NEW.quantity
    WHERE id = NEW.lot_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_product_movement_lot_sync
  AFTER INSERT ON product_movements
  FOR EACH ROW EXECUTE FUNCTION apply_lot_movement();

-- Oldest lot that alone holds enough quantity to cover a sale of
-- p_quantity. NULL if no single lot qualifies (even if the *sum* across
-- lots would be enough) -- deliberately simple, see file header.
CREATE OR REPLACE FUNCTION pick_lot_for_sale(p_product_id UUID, p_quantity DECIMAL(10,2))
RETURNS UUID AS $$
  SELECT id FROM product_lots
  WHERE product_id = p_product_id AND quantity_in_stock >= p_quantity
  ORDER BY received_date ASC, created_at ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Records a new purchase batch: a new product_lots row plus its matching
-- restock movement, together, so "the same product bought again at a
-- different cost" is always one atomic action.
CREATE OR REPLACE FUNCTION restock_product_lot(
  p_product_id UUID, p_quantity DECIMAL(10,2), p_cost_price DECIMAL(10,2), p_sell_price DECIMAL(10,2),
  p_note TEXT, p_received_date DATE, p_staff_id UUID
) RETURNS UUID AS $$
DECLARE
  v_lot_id UUID;
BEGIN
  INSERT INTO product_lots (product_id, cost_price, sell_price, quantity_in_stock, received_date, note)
  VALUES (p_product_id, p_cost_price, p_sell_price, p_quantity, p_received_date, p_note)
  RETURNING id INTO v_lot_id;

  INSERT INTO product_movements (
    product_id, movement_type, quantity, unit_price, lot_id, staff_id, note, movement_date, payment_status
  ) VALUES (
    p_product_id, 'restock', p_quantity, p_cost_price, v_lot_id, p_staff_id, p_note, p_received_date, 'paid'
  );

  RETURN v_lot_id;
END;
$$ LANGUAGE plpgsql;

-- Single entry point for logging ANY sale (standard/cable/bundle) so all
-- three go through the same FIFO-lot-picking, stock-deducting,
-- payment-status-computing path. Returns the id of the "billing" movement
-- row (the one Pay-modal/payment-status logic tracks): for standard/cable
-- that's the only row inserted; for a bundle it's the bundle's own charge
-- row, with one additional zero-priced stock-deduction row per component.
CREATE OR REPLACE FUNCTION log_product_sale(
  p_product_id UUID, p_quantity DECIMAL(10,2), p_subscriber_id UUID, p_note TEXT,
  p_staff_id UUID, p_movement_date DATE, p_total_amount DECIMAL(10,2), p_amount_paid DECIMAL(10,2)
) RETURNS UUID AS $$
DECLARE
  v_product RECORD;
  v_lot_id UUID;
  v_unit_price DECIMAL(10,2);
  v_total DECIMAL(10,2);
  v_payment_status TEXT;
  v_movement_id UUID;
  v_item RECORD;
  v_item_lot_id UUID;
BEGIN
  SELECT id, product_type, name INTO v_product FROM products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  IF v_product.product_type = 'bundle' THEN
    -- One billing row for the bundle itself at its custom total_amount,
    -- no lot (bundles hold no stock of their own).
    v_total := COALESCE(p_total_amount, 0);
    v_payment_status := CASE
      WHEN p_amount_paid <= 0 THEN 'unpaid'
      WHEN p_amount_paid < v_total THEN 'partial'
      ELSE 'paid'
    END;
    INSERT INTO product_movements (
      product_id, movement_type, quantity, unit_price, total_amount, amount_paid,
      subscriber_id, staff_id, note, movement_date, payment_status
    ) VALUES (
      p_product_id, 'sale', -1, NULL, v_total, LEAST(p_amount_paid, v_total),
      p_subscriber_id, p_staff_id, p_note, p_movement_date, v_payment_status
    ) RETURNING id INTO v_movement_id;

    -- Deduct real stock for each component, fully "paid" (already covered
    -- by the bundle's own charge above) -- any component without enough
    -- stock in a single lot aborts and rolls back the whole sale.
    FOR v_item IN SELECT product_id, quantity FROM bundle_items WHERE bundle_id = p_product_id LOOP
      v_item_lot_id := pick_lot_for_sale(v_item.product_id, v_item.quantity);
      IF v_item_lot_id IS NULL THEN
        RAISE EXCEPTION 'Not enough stock in a single batch for bundle component % (need %)', v_item.product_id, v_item.quantity;
      END IF;
      INSERT INTO product_movements (
        product_id, movement_type, quantity, unit_price, lot_id, amount_paid,
        subscriber_id, staff_id, note, movement_date, payment_status
      ) VALUES (
        v_item.product_id, 'sale', -v_item.quantity, 0, v_item_lot_id, 0,
        p_subscriber_id, p_staff_id, 'Bundle component: ' || v_product.name, p_movement_date, 'paid'
      );
    END LOOP;

    RETURN v_movement_id;
  END IF;

  -- standard / cable
  v_lot_id := pick_lot_for_sale(p_product_id, p_quantity);
  IF v_lot_id IS NULL THEN
    RAISE EXCEPTION 'Not enough stock in a single batch of % for this sale (need %)', v_product.name, p_quantity;
  END IF;
  SELECT sell_price INTO v_unit_price FROM product_lots WHERE id = v_lot_id;

  IF v_product.product_type = 'cable' THEN
    v_total := COALESCE(p_total_amount, v_unit_price);
  ELSE
    v_total := COALESCE(p_total_amount, v_unit_price * p_quantity);
  END IF;
  v_payment_status := CASE
    WHEN p_amount_paid <= 0 THEN 'unpaid'
    WHEN p_amount_paid < v_total THEN 'partial'
    ELSE 'paid'
  END;

  INSERT INTO product_movements (
    product_id, movement_type, quantity, unit_price, lot_id,
    total_amount, amount_paid, subscriber_id, staff_id, note, movement_date, payment_status
  ) VALUES (
    p_product_id, 'sale', -p_quantity, v_unit_price, v_lot_id,
    CASE WHEN v_product.product_type = 'cable' THEN v_total ELSE p_total_amount END,
    LEAST(p_amount_paid, v_total), p_subscriber_id, p_staff_id, p_note, p_movement_date, v_payment_status
  ) RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql;

-- Money-total math everywhere a movement's charge is read must prefer the
-- total_amount override (cable/bundle) over unit_price * abs(quantity)
-- (everything else, unchanged). apply_product_overpayment_fifo's cap per
-- row is the one existing SQL call site that needs this update.
CREATE OR REPLACE FUNCTION apply_product_overpayment_fifo(p_subscriber_id UUID, p_credit_amount DECIMAL(10,2))
RETURNS DECIMAL(10,2) AS $$
DECLARE
  v_remaining DECIMAL(10,2) := p_credit_amount;
  v_row RECORD;
  v_line_total DECIMAL(10,2);
  v_apply DECIMAL(10,2);
  v_new_paid DECIMAL(10,2);
BEGIN
  FOR v_row IN
    SELECT id, COALESCE(total_amount, unit_price * ABS(quantity)) AS line_total, amount_paid
    FROM product_movements
    WHERE subscriber_id = p_subscriber_id AND movement_type = 'sale' AND payment_status IN ('unpaid', 'partial')
    ORDER BY movement_date ASC, created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_line_total := v_row.line_total;
    v_apply := LEAST(v_remaining, v_line_total - v_row.amount_paid);
    IF v_apply <= 0 THEN CONTINUE; END IF;
    v_new_paid := v_row.amount_paid + v_apply;
    UPDATE product_movements
    SET amount_paid = v_new_paid,
        payment_status = CASE WHEN v_new_paid >= v_line_total THEN 'paid' ELSE 'partial' END
    WHERE id = v_row.id;
    v_remaining := v_remaining - v_apply;
  END LOOP;
  RETURN p_credit_amount - v_remaining;
END;
$$ LANGUAGE plpgsql;

-- Recreated from 0001_init.sql with one fix: product revenue now prefers
-- total_amount (cable/bundle's real charge) over quantity * unit_price,
-- same COALESCE rule as everywhere else in this migration.
CREATE VIEW monthly_financials AS
SELECT
  date_trunc('month', p.payment_date)::date AS period_month,
  'services' AS revenue_type,
  SUM(p.amount) AS total
FROM payments p
GROUP BY 1
UNION ALL
SELECT
  date_trunc('month', pm.movement_date)::date AS period_month,
  'products' AS revenue_type,
  SUM(COALESCE(pm.total_amount, pm.quantity * pm.unit_price * -1)) AS total -- sale movements are negative quantity
FROM product_movements pm
WHERE pm.movement_type = 'sale'
GROUP BY 1;
