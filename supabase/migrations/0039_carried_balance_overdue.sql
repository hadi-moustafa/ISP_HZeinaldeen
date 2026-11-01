-- Carried-over balances stay overdue.
--
-- Problem (seen live on 2026-11-01): create_period_invoice() rolls every
-- earlier open invoice into the new month's invoice and gives the combined
-- invoice the new month's due date. subscribers.debt only counts invoices
-- past their due date, so October's unpaid money -- already late -- read as
-- "not due yet" until the November billing day. 20 subscribers owing for
-- October showed grey, not red, and were missing from the Debt filter.
--
-- Fix: the new invoice remembers how much of it was carried in
-- (carried_amount) and when that carried part was due (carried_due_date).
-- Overdue now = for each open invoice:
--   * past its own (effective) due date      -> everything still unpaid
--   * else, carried part past carried_due    -> the unpaid carried part
-- Payments on a combined invoice pay the carried (oldest) part first.
-- The invoice amount, statuses and the Pay flow are unchanged.

ALTER TABLE invoices
  ADD COLUMN carried_amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN carried_due_date DATE;

-- Backfill open invoices. create_period_invoice waives the absorbed
-- invoices in the same transaction that inserts the new one, so their
-- waived_at equals the new invoice's created_at (both are now()).
UPDATE invoices n
SET carried_amount   = x.carried,
    carried_due_date = x.carried_due
FROM (
  SELECT n2.id,
         SUM(GREATEST(o.amount_due - COALESCE(
               (SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = o.id), 0), 0)) AS carried,
         MAX(invoice_effective_due(
               CASE WHEN o.postponed_to IS NOT NULL THEN 'postponed' ELSE 'unpaid' END,
               o.due_date, o.postponed_to)) AS carried_due
  FROM invoices n2
  JOIN invoices o
    ON o.subscriber_id = n2.subscriber_id
   AND o.period_month < n2.period_month
   AND o.status = 'waived'
   AND o.waive_reason = 'rolled_over'
   AND o.waived_at = n2.created_at
  WHERE n2.status IN ('unpaid', 'partial', 'postponed')
  GROUP BY n2.id
) x
WHERE x.id = n.id;

CREATE OR REPLACE FUNCTION subscriber_overdue_amount(p_subscriber_id UUID) RETURNS DECIMAL(10,2) AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN invoice_effective_due(i.status, i.due_date, i.postponed_to) < app_today()
        THEN GREATEST(i.amount_due - i.paid, 0)
      WHEN i.carried_amount > 0 AND COALESCE(i.carried_due_date, i.due_date) < app_today()
        THEN GREATEST(LEAST(i.carried_amount, i.amount_due) - i.paid, 0)
      ELSE 0
    END), 0)::decimal(10,2)
  FROM (
    SELECT inv.*, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = inv.id), 0) AS paid
    FROM invoices inv
    WHERE inv.subscriber_id = p_subscriber_id
      AND inv.status IN ('unpaid', 'partial', 'postponed')
  ) i
$$ LANGUAGE sql STABLE;

-- Same as 0030, plus recording carried_amount / carried_due_date.
CREATE OR REPLACE FUNCTION create_period_invoice(p_subscriber_id UUID, p_service_id UUID, p_period_month DATE)
RETURNS UUID AS $$
DECLARE
  v_period DATE := date_trunc('month', p_period_month)::date;
  v_price DECIMAL(10,2);
  v_connection DATE;
  v_expiry DATE;
  v_carried DECIMAL(10,2);
  v_carried_due DATE;
  v_latest_postponed DATE;
  v_due DATE;
  v_invoice_id UUID;
BEGIN
  -- Serializes concurrent creation for the same subscriber (cron + a Pay
  -- tap at the same moment) so the carried balance is read exactly once.
  SELECT COALESCE(NULLIF(sub.price, 0), s.sell_price), sub.connection_date, sub.expiry_date
  INTO v_price, v_connection, v_expiry
  FROM subscribers sub
  LEFT JOIN services s ON s.id = COALESCE(p_service_id, sub.service_id)
  WHERE sub.id = p_subscriber_id
  FOR UPDATE OF sub;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscriber % not found', p_subscriber_id;
  END IF;

  IF EXISTS (SELECT 1 FROM invoices WHERE subscriber_id = p_subscriber_id AND period_month = v_period) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(GREATEST(i.amount_due - COALESCE(
           (SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0), 0)), 0),
         MAX(i.postponed_to) FILTER (WHERE i.status = 'postponed'),
         MAX(invoice_effective_due(i.status, i.due_date, i.postponed_to))
  INTO v_carried, v_latest_postponed, v_carried_due
  FROM invoices i
  WHERE i.subscriber_id = p_subscriber_id
    AND i.period_month < v_period
    AND i.status IN ('unpaid', 'partial', 'postponed');

  -- Due on the billing day; if a carried-in invoice was promised a later
  -- date, that promise still holds for the combined invoice.
  v_due := anchor_date_in_month(v_period, subscriber_anchor_day(v_connection, v_expiry));
  IF v_latest_postponed IS NOT NULL AND v_latest_postponed > v_due THEN
    v_due := v_latest_postponed;
  END IF;

  INSERT INTO invoices (subscriber_id, service_id, period_month, amount_due, due_date, status,
                        carried_amount, carried_due_date)
  VALUES (p_subscriber_id, p_service_id, v_period, COALESCE(v_price, 0) + v_carried, v_due, 'unpaid',
          v_carried, CASE WHEN v_carried > 0 THEN v_carried_due END)
  ON CONFLICT (subscriber_id, period_month) DO NOTHING
  RETURNING id INTO v_invoice_id;

  IF v_invoice_id IS NULL THEN
    RETURN NULL; -- lost a race; nothing was carried, nothing is closed
  END IF;

  -- Only now that the new invoice exists: close out what it absorbed.
  UPDATE invoices
  SET status = 'waived', waive_reason = 'rolled_over'
  WHERE subscriber_id = p_subscriber_id
    AND period_month < v_period
    AND status IN ('unpaid', 'partial', 'postponed');

  -- Zero-amount invoice (free service) settles immediately.
  PERFORM recompute_invoice_status(v_invoice_id);
  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql;

SELECT refresh_all_subscriber_debt();
