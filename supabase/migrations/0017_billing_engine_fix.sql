-- Fixes a real bug caught during live verification of 0016: computing a new
-- period's amount_due (service/custom price + previous period's shortfall)
-- never closed out the invoice that shortfall came from, so it stayed
-- 'unpaid'/'partial' forever -- subscribers.debt (a sum across every
-- unpaid/partial invoice) then double-counted that same shortfall in both
-- the old invoice and the new, inflated one it was rolled into. Confirmed
-- live: a $5 shortfall correctly rolled into next month's $30 invoice,
-- that $30 was paid in full, but debt stayed at $5 instead of clearing.
--
-- Fix: creating a new period's invoice is now one atomic function that
-- also marks whatever prior invoice its shortfall was pulled from as
-- 'waived' -- that invoice's balance has moved to the new invoice, so it
-- must stop being counted on its own. Reusing 'waived' is deliberate:
-- sync_invoice_status() already treats waived invoices as "nothing more
-- owed here" and never recomputes their status again, which is exactly
-- right for a balance that's been carried forward rather than forgiven --
-- the tradeoff is a rollover-closed invoice and a manually-waived one now
-- look identical in the UI, which is acceptable since both correctly mean
-- "not billed further."
CREATE OR REPLACE FUNCTION create_period_invoice(p_subscriber_id UUID, p_service_id UUID, p_period_month DATE)
RETURNS UUID AS $$
DECLARE
  v_price DECIMAL(10,2);
  v_prev_period DATE;
  v_prev_id UUID;
  v_prev_due DECIMAL(10,2);
  v_prev_paid DECIMAL(10,2);
  v_prev_status TEXT;
  v_shortfall DECIMAL(10,2) := 0;
  v_amount DECIMAL(10,2);
  v_invoice_id UUID;
BEGIN
  SELECT COALESCE(sub.price, s.sell_price) INTO v_price
  FROM subscribers sub
  LEFT JOIN services s ON s.id = sub.service_id
  WHERE sub.id = p_subscriber_id;

  v_prev_period := (date_trunc('month', p_period_month) - INTERVAL '1 month')::date;

  SELECT i.id, i.amount_due, i.status,
         COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0)
  INTO v_prev_id, v_prev_due, v_prev_status, v_prev_paid
  FROM invoices i
  WHERE i.subscriber_id = p_subscriber_id AND i.period_month = v_prev_period;

  IF v_prev_status IN ('unpaid', 'partial') THEN
    v_shortfall := GREATEST(v_prev_due - v_prev_paid, 0);
    IF v_shortfall > 0 THEN
      UPDATE invoices SET status = 'waived', updated_at = now() WHERE id = v_prev_id;
    END IF;
  END IF;

  v_amount := COALESCE(v_price, 0) + v_shortfall;

  INSERT INTO invoices (subscriber_id, service_id, period_month, amount_due, due_date, status)
  VALUES (p_subscriber_id, p_service_id, p_period_month, v_amount, p_period_month, 'unpaid')
  ON CONFLICT (subscriber_id, period_month) DO NOTHING
  RETURNING id INTO v_invoice_id;

  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql;
