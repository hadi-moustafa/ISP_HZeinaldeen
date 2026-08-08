-- Three related billing changes, confirmed with the client before writing
-- this (real subscriber/payment data is live, so these needed to be right
-- before touching anything):
--
-- 1. Per-subscriber custom pricing now actually feeds billing.
--    subscribers.price was previously informational only; when set, it's
--    now the effective monthly price instead of services.sell_price, for
--    every future invoice (cron + on-demand). Clearing it (NULL) goes back
--    to the service's normal price.
-- 2. Partial-payment shortfall carries forward exactly one cycle ("strict
--    2-month window", client's explicit choice over a compounding rolling
--    balance): if last period's invoice was left unpaid/partial, the
--    shortfall (amount_due - paid) is added on top of the normal price
--    when the NEXT invoice is generated. The period after that looks only
--    at ITS immediately-preceding period, so a shortfall never carries
--    more than one cycle regardless of whether it was ever paid off.
-- 3. subscribers.debt is a new stored column: current total outstanding
--    across the subscriber's unpaid/partial invoices (any period) --
--    replaces scanning invoices at read time (the old
--    listDebtSubscriberIds() approach) as the one source of truth for
--    "is this subscriber in debt" app-wide (list Debt filter, dashboard
--    debt count, red card color). Kept in sync by triggers so it's
--    correct no matter what touches invoices/payments -- the JS app, the
--    generate-monthly-invoices Edge Function, or a direct SQL fix.

ALTER TABLE subscribers ADD COLUMN debt DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Effective price (custom override or service price) plus at most one
-- period's carried-forward shortfall. Used by both the monthly cron and
-- any on-demand invoice creation so the two never compute this
-- differently.
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
  SELECT COALESCE(sub.price, s.sell_price) INTO v_price
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

-- Recomputes and stores one subscriber's current total outstanding balance
-- across every unpaid/partial invoice they have (any period -- same scope
-- listDebtSubscriberIds() used). Postponed/paid/waived invoices don't
-- count, matching the existing red/orange/green card scheme elsewhere.
CREATE OR REPLACE FUNCTION recompute_subscriber_debt(p_subscriber_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE subscribers s
  SET debt = COALESCE((
        SELECT SUM(i.amount_due - COALESCE(p.paid, 0))
        FROM invoices i
        LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) p
          ON p.invoice_id = i.id
        WHERE i.subscriber_id = p_subscriber_id AND i.status IN ('unpaid', 'partial')
      ), 0),
      updated_at = now()
  WHERE s.id = p_subscriber_id;
END;
$$ LANGUAGE plpgsql;

-- Fires on every invoice change, from any source. This also covers
-- payment-driven status changes: sync_invoice_status() (0001_init.sql)
-- updates invoices.status on every payments INSERT/UPDATE/DELETE, which
-- itself fires this trigger -- no separate payments-side hook needed.
CREATE OR REPLACE FUNCTION sync_subscriber_debt_from_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_subscriber_debt(OLD.subscriber_id);
    RETURN OLD;
  ELSE
    PERFORM recompute_subscriber_debt(NEW.subscriber_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_sync_debt
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION sync_subscriber_debt_from_invoice();

-- Backfill: every subscriber's debt column needs a real value from
-- existing invoices/payments the moment this column exists, not just the
-- 0 default while real unpaid invoices already sit in the table.
UPDATE subscribers s
SET debt = COALESCE(agg.total, 0)
FROM (
  SELECT i.subscriber_id, SUM(i.amount_due - COALESCE(p.paid, 0)) AS total
  FROM invoices i
  LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) p
    ON p.invoice_id = i.id
  WHERE i.status IN ('unpaid', 'partial')
  GROUP BY i.subscriber_id
) agg
WHERE s.id = agg.subscriber_id;
