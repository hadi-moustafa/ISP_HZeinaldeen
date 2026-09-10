-- Two corrections to the Company Analysis page, both client-reported.
--
-- 1. Some "companies" aren't resellers at all -- "Ali lcha8el" and "Hsen
--    masrouf" are expense accounts (no services, no subscribers, so
--    total_owed is permanently 0) that only ever have payments logged
--    against them. Summing those payments into the page's "Paid this
--    month" total overstated what we'd actually paid the real reseller
--    companies. A per-company flag handles it instead of hard-coding two
--    names, so any company can be moved in or out of the totals later
--    from Admin > Companies.
--
-- 2. total_paid had a lower bound (>= the 1st of this month) but no upper
--    bound, so a payment dated into a future month would already count
--    toward this month's total. Both ends of the window are now pinned to
--    the current calendar month.
--
-- total_owed needs no month scoping: it's price x currently-active
-- subscriber count -- the standing monthly obligation, with no date input
-- at all, so it can't carry anything in from another month.

ALTER TABLE companies ADD COLUMN counts_in_totals BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN companies.counts_in_totals IS
  'False for expense accounts that are not reseller companies -- they still appear on the Company Analysis page and still accept logged payments, but are left out of that page''s summary totals.';

UPDATE companies SET counts_in_totals = false
WHERE lower(trim(name)) IN ('ali lcha8el', 'hsen masrouf');

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
      AND cp.payment_date <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
  ), 0) AS total_paid,
  c.counts_in_totals
FROM companies c
LEFT JOIN services s ON s.comp_id = c.id
LEFT JOIN subscribers sub ON sub.service_id = s.id
GROUP BY c.id, c.name, c.counts_in_totals;
