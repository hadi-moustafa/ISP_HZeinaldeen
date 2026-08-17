-- Backend for the Pay modal overhaul: paying down a subscriber's existing
-- debt (which can span several old unpaid/partial invoices) and paying
-- for products (which have no invoice/period concept, only a bare
-- payment_status enum) both need a real amount-collected ledger and
-- atomic multi-row writes -- a client-side loop of N separate inserts
-- isn't safe here (a mid-loop failure would leave some rows paid and
-- others not, with no clean client-side undo), so these mirror
-- create_period_invoice's (0017) atomic single-function pattern.

-- product_movements had no way to say *how much* of a partial sale was
-- actually collected -- payment_status alone can't express that. Existing
-- 'paid' rows get backfilled to their full amount (unit_price * |quantity|);
-- existing 'unpaid'/'partial' rows are backfilled to 0 rather than
-- guessing a historical split that was never actually recorded -- they'll
-- simply show as fully outstanding until next touched through the new
-- flow, which is honest given no real record of the split exists.
ALTER TABLE product_movements ADD COLUMN amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE product_movements
SET amount_paid = CASE
      WHEN payment_status = 'paid' THEN unit_price * ABS(quantity)
      ELSE 0
    END
WHERE movement_type = 'sale';

-- Applies p_amount to this subscriber's oldest unpaid/partial invoices
-- first, splitting across as many as needed (one payments row per
-- invoice, each capped at that invoice's own remaining balance) until the
-- amount is exhausted or invoices run out. Returns the amount actually
-- applied so the caller can tell if the entered amount exceeded the real
-- debt. Every insert is a normal payments row, so enforce_payment_cap
-- (0015), sync_invoice_status (0001), and the subscribers.debt-syncing
-- triggers (0016) all fire exactly as they do for any other payment --
-- nothing here needs to touch subscribers.debt directly.
CREATE OR REPLACE FUNCTION pay_subscriber_debt_fifo(
  p_subscriber_id UUID,
  p_amount DECIMAL(10,2),
  p_payment_date DATE,
  p_method TEXT,
  p_note TEXT,
  p_collector_id UUID,
  p_staff_id UUID
) RETURNS DECIMAL(10,2) AS $$
DECLARE
  v_remaining DECIMAL(10,2) := p_amount;
  v_applied DECIMAL(10,2) := 0;
  v_invoice RECORD;
  v_balance DECIMAL(10,2);
  v_chunk DECIMAL(10,2);
BEGIN
  FOR v_invoice IN
    SELECT i.id, i.amount_due,
           COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) AS paid
    FROM invoices i
    WHERE i.subscriber_id = p_subscriber_id AND i.status IN ('unpaid', 'partial')
    ORDER BY i.period_month ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_balance := v_invoice.amount_due - v_invoice.paid;
    IF v_balance <= 0 THEN
      CONTINUE;
    END IF;
    v_chunk := LEAST(v_balance, v_remaining);

    INSERT INTO payments (invoice_id, subscriber_id, collector_id, amount, payment_date, method, note, staff_id)
    VALUES (v_invoice.id, p_subscriber_id, p_collector_id, v_chunk, p_payment_date, p_method, p_note, p_staff_id);

    v_remaining := v_remaining - v_chunk;
    v_applied := v_applied + v_chunk;
  END LOOP;

  RETURN v_applied;
END;
$$ LANGUAGE plpgsql;

-- Find-or-creates next period's invoice (same logic create_period_invoice
-- already uses -- called directly so the two never compute a different
-- baseline amount) then subtracts a credit from it, clamped at 0. Used for
-- "deduct the overpaid excess from next month's bill".
CREATE OR REPLACE FUNCTION apply_next_period_credit(
  p_subscriber_id UUID,
  p_service_id UUID,
  p_next_period_month DATE,
  p_credit_amount DECIMAL(10,2)
) RETURNS VOID AS $$
DECLARE
  v_invoice_id UUID;
BEGIN
  v_invoice_id := create_period_invoice(p_subscriber_id, p_service_id, p_next_period_month);
  IF v_invoice_id IS NULL THEN
    SELECT id INTO v_invoice_id FROM invoices
    WHERE subscriber_id = p_subscriber_id AND period_month = p_next_period_month;
  END IF;

  UPDATE invoices
  SET amount_due = GREATEST(amount_due - p_credit_amount, 0), updated_at = now()
  WHERE id = v_invoice_id;
END;
$$ LANGUAGE plpgsql;

-- Same FIFO shape as pay_subscriber_debt_fifo, but against this
-- subscriber's other outstanding product sales instead of invoices --
-- products have no "next month's bill" to credit, so an overpayment on
-- one product is instead applied to whatever else this subscriber still
-- owes on other products, oldest sale first. Returns the amount actually
-- applied (an unapplied remainder means there was nothing left to credit,
-- letting the caller refuse the overpayment).
CREATE OR REPLACE FUNCTION apply_product_overpayment_fifo(
  p_subscriber_id UUID,
  p_credit_amount DECIMAL(10,2)
) RETURNS DECIMAL(10,2) AS $$
DECLARE
  v_remaining DECIMAL(10,2) := p_credit_amount;
  v_applied DECIMAL(10,2) := 0;
  v_movement RECORD;
  v_total DECIMAL(10,2);
  v_balance DECIMAL(10,2);
  v_chunk DECIMAL(10,2);
BEGIN
  FOR v_movement IN
    SELECT id, unit_price, quantity, amount_paid
    FROM product_movements
    WHERE subscriber_id = p_subscriber_id
      AND movement_type = 'sale'
      AND payment_status IN ('unpaid', 'partial')
    ORDER BY movement_date ASC, created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_total := COALESCE(v_movement.unit_price, 0) * ABS(v_movement.quantity);
    v_balance := v_total - v_movement.amount_paid;
    IF v_balance <= 0 THEN
      CONTINUE;
    END IF;
    v_chunk := LEAST(v_balance, v_remaining);

    UPDATE product_movements
    SET amount_paid = amount_paid + v_chunk,
        payment_status = CASE WHEN amount_paid + v_chunk >= v_total THEN 'paid' ELSE 'partial' END
    WHERE id = v_movement.id;

    v_remaining := v_remaining - v_chunk;
    v_applied := v_applied + v_chunk;
  END LOOP;

  RETURN v_applied;
END;
$$ LANGUAGE plpgsql;
