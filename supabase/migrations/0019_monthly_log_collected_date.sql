-- Exposes the date a subscriber's invoice was actually collected on, for
-- the monthly log page's new "Collected on" column -- the view previously
-- had amount_paid but no date, so there was no way to see when a payment
-- landed without opening each subscriber individually. Uses the latest
-- payment_date across all payments against that invoice (a partial invoice
-- can have more than one payment row) so it reads as "most recently paid
-- on", not "first paid on". NULL when no payment has been logged yet.
-- Appended at the end, not inserted among the existing columns --
-- CREATE OR REPLACE VIEW only allows adding new trailing columns (same
-- constraint 0006_monthly_log_invoice_id.sql hit).
CREATE OR REPLACE VIEW monthly_log AS
SELECT
  i.period_month,
  s.id AS subscriber_id,
  s.name AS subscriber_name,
  o.name AS owner_name,
  col.name AS default_collector_name,
  i.amount_due,
  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS amount_paid,
  i.status,
  i.due_date,
  i.postponed_to,
  i.id AS invoice_id,
  (SELECT MAX(p.payment_date) FROM payments p WHERE p.invoice_id = i.id) AS collected_at
FROM invoices i
JOIN subscribers s ON i.subscriber_id = s.id
LEFT JOIN owners o ON s.owner_id = o.id
LEFT JOIN collectors col ON s.default_collector_id = col.id;
