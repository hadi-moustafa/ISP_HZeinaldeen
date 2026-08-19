-- "Company payments reset every month" (client-explicit): total_paid now
-- only counts company_payments logged since the 1st of the current
-- calendar month, instead of an ever-growing lifetime total. Nothing is
-- deleted or archived -- every payment row stays in company_payments
-- forever and is still fully browsable per-company on the Company
-- Payments page; this view just stops summing prior months into the
-- running total. It resets itself automatically at each month boundary
-- purely because CURRENT_DATE moves forward -- no cron job, no extra
-- state to maintain.
--
-- total_owed is deliberately left untouched: it's not a historical figure
-- to begin with (it's price x currently-active-subscriber-count, the
-- ISP's ongoing recurring obligation to the company), so there's nothing
-- to "reset" there. Comparing it against a monthly total_paid is actually
-- more consistent than before, since both sides of the balance are now
-- effectively "this month" figures.
CREATE OR REPLACE VIEW company_dues AS
SELECT
  c.id AS comp_id,
  c.name AS company_name,
  COALESCE(SUM(s.paid_price) FILTER (WHERE sub.connection_status = 'active'), 0) AS total_owed,
  COALESCE((
    SELECT SUM(cp.amount)
    FROM company_payments cp
    WHERE cp.comp_id = c.id
      AND cp.payment_date >= date_trunc('month', CURRENT_DATE)::date
  ), 0) AS total_paid
FROM companies c
LEFT JOIN services s ON s.comp_id = c.id
LEFT JOIN subscribers sub ON sub.service_id = s.id
GROUP BY c.id, c.name;
