-- Exposes the invoice id on monthly_log so the UI can log a payment
-- directly against "this subscriber's invoice for the current period"
-- without a second round-trip per row.
-- invoice_id appended at the end, not inserted among the existing columns:
-- CREATE OR REPLACE VIEW only allows adding new trailing columns, not
-- reordering/renaming existing ones (confirmed live -- the first attempt at
-- this migration, with invoice_id first, failed against the real project).
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
  i.id AS invoice_id
FROM invoices i
JOIN subscribers s ON i.subscriber_id = s.id
LEFT JOIN owners o ON s.owner_id = o.id
LEFT JOIN collectors col ON s.default_collector_id = col.id;
