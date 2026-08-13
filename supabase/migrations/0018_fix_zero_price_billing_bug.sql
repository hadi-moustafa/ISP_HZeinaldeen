-- Critical fix: compute_invoice_amount()/create_period_invoice()
-- (0016/0017) used COALESCE(sub.price, s.sell_price) to apply a
-- subscriber's custom price override -- but subscribers.price is 0 (not
-- NULL) for every real subscriber, because the ISP panel's Excel export
-- always has Price=0 and the importer faithfully writes that literal 0
-- (0012_full_import_columns.sql only NULLIFs an empty *string*, not a
-- numeric zero). COALESCE only falls through on NULL, so every subscriber
-- was silently being billed $0 instead of their real service price --
-- confirmed live: all 201 subscribers with a service had price=0, and
-- compute_invoice_amount returned 0.00 for one whose real service price
-- is $25. A $0 invoice can also never reach 'paid' status
-- (sync_invoice_status's v_total_paid <= 0 branch wins even at 0 paid on
-- 0 due), so it never triggers the auto-renew-on-paid expiry bump either
-- -- explaining reports of subscribers whose expiry date wouldn't move
-- and whose Pay modal showed "max 0.00", blocking any real payment.
--
-- This was already the known, documented behavior for this exact field
-- before the billing engine work (0012: "Price/Balance ... are
-- informational only and do not feed invoice generation") -- treating a
-- literal 0 as "no override" restores that guarantee while still letting
-- a real positive custom price (set by hand, never by import) through.
CREATE OR REPLACE FUNCTION compute_invoice_amount(p_subscriber_id UUID, p_period_month DATE)
RETURNS DECIMAL(10,2) AS $$
DECLARE
  v_price DECIMAL(10,2);
  v_prev_period DATE;
  v_prev_due DECIMAL(10,2);
  v_prev_paid DECIMAL(10,2);
  v_prev_status TEXT;
  v_shortfall DECIMAL(10,2) := 0;
BEGIN
  SELECT COALESCE(NULLIF(sub.price, 0), s.sell_price) INTO v_price
  FROM subscribers sub
  LEFT JOIN services s ON s.id = sub.service_id
  WHERE sub.id = p_subscriber_id;

  v_prev_period := (date_trunc('month', p_period_month) - INTERVAL '1 month')::date;

  SELECT i.amount_due, i.status, COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0)
  INTO v_prev_due, v_prev_status, v_prev_paid
  FROM invoices i
  WHERE i.subscriber_id = p_subscriber_id AND i.period_month = v_prev_period;

  IF v_prev_status IN ('unpaid', 'partial') THEN
    v_shortfall := GREATEST(v_prev_due - v_prev_paid, 0);
  END IF;

  RETURN COALESCE(v_price, 0) + v_shortfall;
END;
$$ LANGUAGE plpgsql;

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
  SELECT COALESCE(NULLIF(sub.price, 0), s.sell_price) INTO v_price
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

-- Repair the real invoices already created wrong by the buggy function
-- (confirmed live: 9 real August invoices sitting at amount_due=0). Only
-- touches currently-open (unpaid/partial) invoices -- anything already
-- paid or waived is left alone. Safe to recompute via the now-fixed
-- compute_invoice_amount(): each affected invoice's own subscriber+period
-- is unchanged, so it looks at the same prior-period shortfall it would
-- have at creation time.
UPDATE invoices
SET amount_due = compute_invoice_amount(subscriber_id, period_month),
    updated_at = now()
WHERE status IN ('unpaid', 'partial') AND amount_due = 0;
