-- One definition of what the ISP owes each company, and one server-side
-- computation of the dashboard's headline numbers.
--
-- Company side. The subscriber's expiry_date is "paid until" -- it jumps a
-- month ahead the moment the subscriber pays -- so using it as the date the
-- ISP must renew the line with the company made an early payer vanish from
-- "payments due" even though the company still has to be paid on the
-- usual day. The company renewal date is now the subscriber's billing day
-- (connection-date day, same anchor as invoices -- see 0030), which never
-- moves when the subscriber pays.
--
-- Per company, all in Beirut time:
--   owed_month     paid_price x active subscribers (the standing monthly
--                  obligation; same figure company_dues.total_owed shows)
--   paid_month     company payments dated this calendar month
--   due_so_far     paid_price of subscribers whose billing day this month
--                  has already passed
--   window_*       renewals falling in [today, today + p_days] (this
--                  month's or next month's billing day)
--   have           paid_month - due_so_far - window_amount: what's left of
--                  this month's payments after covering every renewal up
--                  to the end of the window. Negative = still to pay.
CREATE OR REPLACE FUNCTION company_due_schedule(p_days INT DEFAULT 0)
RETURNS TABLE (
  comp_id UUID,
  company_name TEXT,
  counts_in_totals BOOLEAN,
  active_subscribers INT,
  owed_month DECIMAL(12,2),
  paid_month DECIMAL(12,2),
  due_so_far DECIMAL(12,2),
  window_count INT,
  window_amount DECIMAL(12,2),
  have DECIMAL(12,2)
) AS $$
  WITH d AS (
    SELECT app_today() AS today,
           app_current_period() AS m,
           app_today() + LEAST(GREATEST(COALESCE(p_days, 0), 0), 30) AS until
  ),
  occ AS (
    SELECT s.comp_id,
           COALESCE(s.paid_price, 0) AS price,
           anchor_date_in_month(d.m, subscriber_anchor_day(sub.connection_date, sub.expiry_date)) AS this_occ,
           anchor_date_in_month((d.m + INTERVAL '1 month')::date,
                                subscriber_anchor_day(sub.connection_date, sub.expiry_date)) AS next_occ
    FROM subscribers sub
    JOIN services s ON s.id = sub.service_id
    CROSS JOIN d
    WHERE sub.connection_status = 'active'
  ),
  agg AS (
    SELECT o.comp_id,
           COUNT(*)::int AS active_subscribers,
           SUM(o.price) AS owed_month,
           SUM(o.price) FILTER (WHERE o.this_occ < d.today) AS due_so_far,
           SUM(((o.this_occ BETWEEN d.today AND d.until)::int + (o.next_occ BETWEEN d.today AND d.until)::int))::int AS window_count,
           SUM(o.price * ((o.this_occ BETWEEN d.today AND d.until)::int + (o.next_occ BETWEEN d.today AND d.until)::int)) AS window_amount
    FROM occ o CROSS JOIN d
    GROUP BY o.comp_id
  ),
  paid AS (
    SELECT cp.comp_id, SUM(cp.amount) AS paid_month
    FROM company_payments cp CROSS JOIN d
    WHERE cp.payment_date >= d.m AND cp.payment_date < (d.m + INTERVAL '1 month')::date
    GROUP BY cp.comp_id
  )
  SELECT c.id,
         c.name,
         c.counts_in_totals,
         COALESCE(a.active_subscribers, 0),
         COALESCE(a.owed_month, 0),
         COALESCE(p.paid_month, 0),
         COALESCE(a.due_so_far, 0),
         COALESCE(a.window_count, 0),
         COALESCE(a.window_amount, 0),
         COALESCE(p.paid_month, 0) - COALESCE(a.due_so_far, 0) - COALESCE(a.window_amount, 0)
  FROM companies c
  LEFT JOIN agg a ON a.comp_id = c.id
  LEFT JOIN paid p ON p.comp_id = c.id
  ORDER BY c.name
$$ LANGUAGE sql STABLE;

-- company_dues keeps its columns (the previous frontend reads it) but now
-- uses Beirut time for "this month", same as company_due_schedule.
CREATE OR REPLACE VIEW company_dues AS
SELECT
  c.id AS comp_id,
  c.name AS company_name,
  COALESCE(SUM(s.paid_price) FILTER (WHERE sub.connection_status = 'active'), 0) AS total_owed,
  COALESCE((
    SELECT SUM(cp.amount)
    FROM company_payments cp
    WHERE cp.comp_id = c.id
      AND cp.payment_date >= app_current_period()
      AND cp.payment_date < (app_current_period() + INTERVAL '1 month')::date
  ), 0) AS total_paid,
  c.counts_in_totals
FROM companies c
LEFT JOIN services s ON s.comp_id = c.id
LEFT JOIN subscribers sub ON sub.service_id = s.id
GROUP BY c.id, c.name, c.counts_in_totals;

-- Dashboard headline numbers, computed from real invoices instead of
-- re-deriving "what's due" from service prices in the browser.
--
--   period_*   this month's bills: what the invoices say is due (plus what
--              an invoice would say for any active subscriber not billed
--              yet), what's been paid against them, what was forgiven, and
--              what's left
--   cash_*     money actually received this month, by date: subscriber
--              payments on any invoice (old debt, advance payments
--              included) and product sales collected
--   company_paid_month_all  everything paid out to companies/expense
--              accounts this month (all of it left the cash box)
CREATE OR REPLACE FUNCTION dashboard_summary() RETURNS JSONB AS $$
  WITH d AS (
    SELECT app_current_period() AS m, (app_current_period() + INTERVAL '1 month')::date AS n
  ),
  billable AS (
    SELECT sub.id, sub.debt,
           i.id AS invoice_id, i.status, i.amount_due, i.forgiven_amount,
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
    FROM subscribers sub
    CROSS JOIN d
    LEFT JOIN invoices i ON i.subscriber_id = sub.id AND i.period_month = d.m
    WHERE sub.connection_status = 'active' AND sub.service_id IS NOT NULL
  ),
  period AS (
    SELECT
      COUNT(*) AS billable_subscribers,
      COUNT(*) FILTER (WHERE invoice_id IS NULL) AS unbilled,
      COALESCE(SUM(CASE WHEN invoice_id IS NULL THEN compute_invoice_amount(id, (SELECT m FROM d))
                        ELSE amount_due END), 0) AS due,
      COALESCE(SUM(paid), 0) AS paid,
      COALESCE(SUM(forgiven_amount), 0) AS forgiven,
      COUNT(*) FILTER (WHERE status IN ('paid', 'waived')) AS paid_users
    FROM billable
  ),
  sales AS (
    SELECT
      COALESCE(SUM(ABS(quantity)), 0) AS units,
      COALESCE(SUM(ABS(quantity) * COALESCE(unit_price, 0)), 0) AS total,
      COALESCE(SUM(amount_paid), 0) AS paid
    FROM product_movements pm CROSS JOIN d
    WHERE pm.movement_type = 'sale' AND pm.movement_date >= d.m AND pm.movement_date < d.n
  )
  SELECT jsonb_build_object(
    'periodMonth', (SELECT m FROM d),
    'totalSubscribers', (SELECT COUNT(*) FROM subscribers),
    'billableSubscribers', p.billable_subscribers,
    'unbilledSubscribers', p.unbilled,
    'periodDue', p.due,
    'periodPaid', p.paid,
    'periodForgiven', p.forgiven,
    'periodLeft', GREATEST(p.due - p.paid - p.forgiven, 0),
    'paidUsers', p.paid_users,
    'unpaidUsers', p.billable_subscribers - p.paid_users,
    'overdueSubscribers', (SELECT COUNT(*) FROM subscribers WHERE debt > 0),
    'overdueAmount', (SELECT COALESCE(SUM(debt), 0) FROM subscribers),
    'productUnits', s.units,
    'productTotal', s.total,
    'productPaid', s.paid,
    'productLeft', GREATEST(s.total - s.paid, 0),
    'cashSubscribers', (SELECT COALESCE(SUM(amount), 0) FROM payments, d
                        WHERE payment_date >= d.m AND payment_date < d.n),
    'cashProducts', s.paid,
    'companyPaidMonthAll', (SELECT COALESCE(SUM(amount), 0) FROM company_payments, d
                            WHERE payment_date >= d.m AND payment_date < d.n)
  )
  FROM period p, sales s
$$ LANGUAGE sql STABLE;
