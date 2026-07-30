-- When an invoice fully pays off, auto-renews the subscriber by moving
-- expiry_date forward one month, anchored to the day-of-month of their
-- original connection_date (per explicit client decision: "a month from
-- when he is added"). Only fires on the transition INTO 'paid' (not on
-- every payment row change once already paid, and not reversed if a
-- payment is later deleted).
--
-- Postgres gotcha avoided here: `date + interval '1 month'` does NOT clamp
-- to the target month's last day -- '2026-01-31'::date + interval '1 month'
-- rolls over to March 2nd, not February 28th. Building the target month via
-- date_trunc(...)::date (always day 1, so it's overflow-safe) and then
-- clamping the day back down avoids that.
CREATE OR REPLACE FUNCTION sync_invoice_status()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id UUID;
  v_total_paid DECIMAL(10,2);
  v_amount_due DECIMAL(10,2);
  v_old_status TEXT;
  v_new_status TEXT;
  v_subscriber_id UUID;
  v_connection_date DATE;
  v_expiry_date DATE;
  v_anchor_day INT;
  v_base_date DATE;
  v_target_month_start DATE;
  v_days_in_target_month INT;
  v_new_expiry DATE;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid FROM payments WHERE invoice_id = v_invoice_id;
  SELECT amount_due, status, subscriber_id INTO v_amount_due, v_old_status, v_subscriber_id
  FROM invoices WHERE id = v_invoice_id;

  v_new_status := CASE
        WHEN v_total_paid <= 0 THEN 'unpaid'
        WHEN v_total_paid < v_amount_due THEN 'partial'
        ELSE 'paid'
      END;

  UPDATE invoices
  SET status = v_new_status,
      updated_at = now()
  WHERE id = v_invoice_id
    AND status NOT IN ('waived'); -- don't override a manually waived invoice

  IF v_new_status = 'paid' AND v_old_status IS DISTINCT FROM 'paid' AND v_subscriber_id IS NOT NULL THEN
    SELECT connection_date, expiry_date INTO v_connection_date, v_expiry_date
    FROM subscribers WHERE id = v_subscriber_id;

    v_base_date := COALESCE(v_expiry_date, v_connection_date, CURRENT_DATE);
    v_anchor_day := EXTRACT(DAY FROM COALESCE(v_connection_date, v_base_date))::int;

    v_target_month_start := (date_trunc('month', v_base_date) + INTERVAL '1 month')::date;
    v_days_in_target_month := EXTRACT(
      DAY FROM (v_target_month_start + INTERVAL '1 month - 1 day')
    )::int;

    v_new_expiry := v_target_month_start
      + (LEAST(v_anchor_day, v_days_in_target_month) - 1) * INTERVAL '1 day';

    UPDATE subscribers
    SET expiry_date = v_new_expiry, updated_at = now()
    WHERE id = v_subscriber_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
