-- Billing integrity pass, following a full review of debt / forgive /
-- postpone / invoice generation against live data. Every change here is
-- written so the production app still running the previous frontend keeps
-- working: no invoice status values are added, no function the old
-- frontend calls changes its required arguments.
--
-- What changes, in order:
--  1. "Today" and "this month" are computed in Beirut time, not UTC.
--  2. Each invoice's due_date is the subscriber's billing day in that month
--     (their connection-date day), not the 1st.
--  3. A waived invoice records WHY: 'forgiven' (msama7) or 'rolled_over'
--     (its balance moved into a later invoice), plus how much was forgiven.
--  4. Forgiving an invoice renews the subscriber's expiry, same as paying.
--  5. Renewal on paid never lands before the end of the period the invoice
--     covers (paying a rolled-up two-month invoice now covers both months).
--  6. Creating a period's invoice rolls EVERY earlier open invoice into it
--     (unpaid, partial AND postponed), and only closes those out after the
--     new invoice was actually inserted -- previously a conflict with an
--     existing invoice still waived the prior one, silently losing it.
--  7. subscribers.debt = what is OVERDUE (open invoices whose due date --
--     or postponed-to date -- has passed), not "anything not yet paid".
--     A daily job keeps it current as dates pass.
--  8. Invoice generation runs inside Postgres (generate_period_invoices),
--     daily, logged to invoice_generation_runs -- replacing the pg_net HTTP
--     call to the Edge Function, which has a 5s timeout and already timed
--     out once.
--  9. pay_service_line(): the Pay modal's whole Service line (bill, pay,
--     forgive / credit overpayment / new permanent price) as one
--     transaction. An overpayment is recorded as a real payment on next
--     month's invoice, so cash-collected figures match the cash taken.

-- 1. Dates ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_today() RETURNS DATE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Beirut')::date
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_current_period() RETURNS DATE AS $$
  SELECT date_trunc('month', app_today())::date
$$ LANGUAGE sql STABLE;

-- The day of the month a subscriber is billed/renewed on. Same anchor the
-- auto-renew trigger has used since 0010 (connection-date day), with the
-- expiry day as a fallback.
CREATE OR REPLACE FUNCTION subscriber_anchor_day(p_connection_date DATE, p_expiry_date DATE) RETURNS INT AS $$
  SELECT COALESCE(EXTRACT(DAY FROM p_connection_date), EXTRACT(DAY FROM p_expiry_date), 1)::int
$$ LANGUAGE sql IMMUTABLE;

-- p_anchor_day within p_month, clamped to the month's last day (31 -> 30th
-- in a 30-day month, Feb 28/29 in February). Builds from day 1, so it never
-- hits Postgres's `date + interval '1 month'` overflow into the next month.
CREATE OR REPLACE FUNCTION anchor_date_in_month(p_month DATE, p_anchor_day INT) RETURNS DATE AS $$
  SELECT date_trunc('month', p_month)::date
    + (LEAST(p_anchor_day, EXTRACT(DAY FROM (date_trunc('month', p_month) + INTERVAL '1 month - 1 day'))::int) - 1)
$$ LANGUAGE sql IMMUTABLE;

-- The date an open invoice actually falls due: its postponed-to date while
-- postponed, otherwise its due date.
CREATE OR REPLACE FUNCTION invoice_effective_due(p_status TEXT, p_due_date DATE, p_postponed_to DATE) RETURNS DATE AS $$
  SELECT CASE WHEN p_status = 'postponed' THEN COALESCE(p_postponed_to, p_due_date) ELSE p_due_date END
$$ LANGUAGE sql IMMUTABLE;

-- 3. Waive bookkeeping -------------------------------------------------------

ALTER TABLE invoices
  ADD COLUMN waive_reason TEXT CHECK (waive_reason IN ('forgiven', 'rolled_over')),
  ADD COLUMN forgiven_amount DECIMAL(10,2),
  ADD COLUMN waived_at TIMESTAMPTZ;

-- 5. Renewal -----------------------------------------------------------------

-- Moves expiry forward when period p_period_month's invoice is settled (paid
-- or forgiven): one month past the current expiry, but never earlier than
-- the billing day of the month after the period (what that invoice covers).
-- The second bound matters when one invoice carries several months (rolled
-- over), or the stored expiry is far in the past.
CREATE OR REPLACE FUNCTION renew_subscriber_for_period(p_subscriber_id UUID, p_period_month DATE) RETURNS VOID AS $$
DECLARE
  v_connection DATE;
  v_expiry DATE;
  v_anchor INT;
  v_base DATE;
BEGIN
  SELECT connection_date, expiry_date INTO v_connection, v_expiry FROM subscribers WHERE id = p_subscriber_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_anchor := subscriber_anchor_day(v_connection, v_expiry);
  v_base := COALESCE(v_expiry, v_connection, app_today());
  UPDATE subscribers
  SET expiry_date = GREATEST(
        anchor_date_in_month((date_trunc('month', v_base) + INTERVAL '1 month')::date, v_anchor),
        anchor_date_in_month((date_trunc('month', p_period_month) + INTERVAL '1 month')::date, v_anchor)
      ),
      updated_at = now()
  WHERE id = p_subscriber_id;
END;
$$ LANGUAGE plpgsql;

-- Status from payments vs amount_due. Unchanged rules plus:
--  * a zero-amount invoice (e.g. fully covered by a credit) is 'paid', so it
--    renews like any other -- before, 0 paid on 0 due stayed 'unpaid' forever;
--  * a postponed invoice stays 'postponed' until fully paid, so its
--    postponed-to date keeps counting (a partial payment used to flip it to
--    'partial' and a deleted payment to 'unpaid', dropping the date);
--  * waived invoices are never touched (as before).
CREATE OR REPLACE FUNCTION recompute_invoice_status(p_invoice_id UUID) RETURNS VOID AS $$
DECLARE
  v_amount_due DECIMAL(10,2);
  v_old_status TEXT;
  v_subscriber_id UUID;
  v_period DATE;
  v_total_paid DECIMAL(10,2);
  v_new_status TEXT;
BEGIN
  SELECT amount_due, status, subscriber_id, period_month
  INTO v_amount_due, v_old_status, v_subscriber_id, v_period
  FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR v_old_status = 'waived' THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid FROM payments WHERE invoice_id = p_invoice_id;

  IF v_total_paid >= v_amount_due THEN
    v_new_status := 'paid';
  ELSIF v_old_status = 'postponed' THEN
    v_new_status := 'postponed';
  ELSIF v_total_paid > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'unpaid';
  END IF;

  IF v_new_status IS DISTINCT FROM v_old_status THEN
    UPDATE invoices SET status = v_new_status, updated_at = now() WHERE id = p_invoice_id;
  END IF;

  IF v_new_status = 'paid' AND v_old_status IS DISTINCT FROM 'paid' THEN
    PERFORM renew_subscriber_for_period(v_subscriber_id, v_period);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Payments trigger: recomputes the invoice a payment was on AND the one it
-- moved to (an UPDATE changing invoice_id previously left the old invoice's
-- status stale).
CREATE OR REPLACE FUNCTION sync_invoice_status() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.invoice_id IS NOT NULL THEN
    PERFORM recompute_invoice_status(OLD.invoice_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.invoice_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.amount IS DISTINCT FROM OLD.amount) THEN
    PERFORM recompute_invoice_status(NEW.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- amount_due edits (credit, new permanent price) re-derive status too.
CREATE OR REPLACE FUNCTION sync_invoice_status_on_amount() RETURNS TRIGGER AS $$
BEGIN
  PERFORM recompute_invoice_status(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_amount_status
  AFTER UPDATE OF amount_due ON invoices
  FOR EACH ROW WHEN (NEW.amount_due IS DISTINCT FROM OLD.amount_due)
  EXECUTE FUNCTION sync_invoice_status_on_amount();

-- 3 + 4. Waiving: stamp reason/amount, and renew on forgive. Any direct
-- `status = 'waived'` update without a reason (which is exactly what the
-- previous frontend's msama7 button sends) is a forgiveness; rollover sets
-- 'rolled_over' explicitly.
CREATE OR REPLACE FUNCTION invoice_waive_stamp() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'waived' AND OLD.status IS DISTINCT FROM 'waived' THEN
    NEW.waive_reason := COALESCE(NEW.waive_reason, 'forgiven');
    NEW.waived_at := now();
    IF NEW.waive_reason = 'forgiven' THEN
      NEW.forgiven_amount := GREATEST(
        NEW.amount_due - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = NEW.id), 0), 0);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_waive_stamp
  BEFORE UPDATE OF status ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoice_waive_stamp();

CREATE OR REPLACE FUNCTION invoice_forgive_renew() RETURNS TRIGGER AS $$
BEGIN
  PERFORM renew_subscriber_for_period(NEW.subscriber_id, NEW.period_month);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_forgive_renew
  AFTER UPDATE OF status ON invoices
  FOR EACH ROW
  WHEN (NEW.status = 'waived' AND OLD.status IS DISTINCT FROM 'waived' AND NEW.waive_reason = 'forgiven')
  EXECUTE FUNCTION invoice_forgive_renew();

-- 7. Debt = overdue --------------------------------------------------------

CREATE OR REPLACE FUNCTION subscriber_overdue_amount(p_subscriber_id UUID) RETURNS DECIMAL(10,2) AS $$
  SELECT COALESCE(SUM(GREATEST(i.amount_due - COALESCE(
           (SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0), 0)), 0)::decimal(10,2)
  FROM invoices i
  WHERE i.subscriber_id = p_subscriber_id
    AND i.status IN ('unpaid', 'partial', 'postponed')
    AND invoice_effective_due(i.status, i.due_date, i.postponed_to) < app_today()
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION recompute_subscriber_debt(p_subscriber_id UUID) RETURNS VOID AS $$
DECLARE
  v_debt DECIMAL(10,2) := subscriber_overdue_amount(p_subscriber_id);
BEGIN
  UPDATE subscribers SET debt = v_debt, updated_at = now()
  WHERE id = p_subscriber_id AND debt IS DISTINCT FROM v_debt;
END;
$$ LANGUAGE plpgsql;

-- Dates move without any row changing, so the stored debt is refreshed
-- daily (and after every generation run). Only rows whose value changed
-- are written.
CREATE OR REPLACE FUNCTION refresh_all_subscriber_debt() RETURNS INTEGER AS $$
DECLARE
  v_changed INTEGER;
BEGIN
  UPDATE subscribers s
  SET debt = x.overdue, updated_at = now()
  FROM (SELECT id, subscriber_overdue_amount(id) AS overdue FROM subscribers) x
  WHERE x.id = s.id AND s.debt IS DISTINCT FROM x.overdue;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$ LANGUAGE plpgsql;

-- 2 + 6. Invoice creation ------------------------------------------------

-- What a new invoice for this subscriber+period would be: their price
-- (custom override if > 0, else the service's sell_price) plus every
-- earlier invoice still open (unpaid, partial or postponed). Kept in step
-- with create_period_invoice below; the Pay modal uses it to pre-fill.
CREATE OR REPLACE FUNCTION compute_invoice_amount(p_subscriber_id UUID, p_period_month DATE)
RETURNS DECIMAL(10,2) AS $$
DECLARE
  v_price DECIMAL(10,2);
  v_carried DECIMAL(10,2);
BEGIN
  SELECT COALESCE(NULLIF(sub.price, 0), s.sell_price) INTO v_price
  FROM subscribers sub
  LEFT JOIN services s ON s.id = sub.service_id
  WHERE sub.id = p_subscriber_id;

  SELECT COALESCE(SUM(GREATEST(i.amount_due - COALESCE(
           (SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0), 0)), 0)
  INTO v_carried
  FROM invoices i
  WHERE i.subscriber_id = p_subscriber_id
    AND i.period_month < date_trunc('month', p_period_month)::date
    AND i.status IN ('unpaid', 'partial', 'postponed');

  RETURN COALESCE(v_price, 0) + v_carried;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_period_invoice(p_subscriber_id UUID, p_service_id UUID, p_period_month DATE)
RETURNS UUID AS $$
DECLARE
  v_period DATE := date_trunc('month', p_period_month)::date;
  v_price DECIMAL(10,2);
  v_connection DATE;
  v_expiry DATE;
  v_carried DECIMAL(10,2);
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
         MAX(i.postponed_to) FILTER (WHERE i.status = 'postponed')
  INTO v_carried, v_latest_postponed
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

  INSERT INTO invoices (subscriber_id, service_id, period_month, amount_due, due_date, status)
  VALUES (p_subscriber_id, p_service_id, v_period, COALESCE(v_price, 0) + v_carried, v_due, 'unpaid')
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

-- 8. Generation inside Postgres --------------------------------------------

CREATE TABLE invoice_generation_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month DATE NOT NULL,
  source       TEXT NOT NULL,
  created      INTEGER NOT NULL,
  skipped      INTEGER NOT NULL,
  failed       INTEGER NOT NULL,
  errors       JSONB NOT NULL DEFAULT '[]'::jsonb,
  debt_changed INTEGER NOT NULL DEFAULT 0,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent: bills every active subscriber with a service who has no
-- invoice for the period yet. One subscriber failing is recorded and
-- skipped, never aborts the rest.
CREATE OR REPLACE FUNCTION generate_period_invoices(p_period_month DATE DEFAULT NULL, p_source TEXT DEFAULT 'manual')
RETURNS JSONB AS $$
DECLARE
  v_period DATE := date_trunc('month', COALESCE(p_period_month, app_current_period()))::date;
  v_sub RECORD;
  v_id UUID;
  v_created INTEGER := 0;
  v_skipped INTEGER := 0;
  v_failed INTEGER := 0;
  v_errors JSONB := '[]'::jsonb;
  v_debt_changed INTEGER;
BEGIN
  FOR v_sub IN
    SELECT id, name, service_id FROM subscribers
    WHERE connection_status = 'active' AND service_id IS NOT NULL
    ORDER BY name
  LOOP
    BEGIN
      v_id := create_period_invoice(v_sub.id, v_sub.service_id, v_period);
      IF v_id IS NULL THEN
        v_skipped := v_skipped + 1;
      ELSE
        v_created := v_created + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('subscriber', v_sub.name, 'error', SQLERRM);
    END;
  END LOOP;

  v_debt_changed := refresh_all_subscriber_debt();

  INSERT INTO invoice_generation_runs (period_month, source, created, skipped, failed, errors, debt_changed)
  VALUES (v_period, p_source, v_created, v_skipped, v_failed, v_errors, v_debt_changed);

  RETURN jsonb_build_object('periodMonth', v_period, 'created', v_created, 'skipped', v_skipped,
                            'failed', v_failed, 'errors', v_errors);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace the monthly HTTP job with a daily in-database one. Daily, so a
-- missed run heals itself the next night and debt stays current as due
-- dates pass. 22:05 UTC = just after midnight in Beirut (UTC+2/+3).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('generate-monthly-invoices', 'billing-daily');
END $$;

SELECT cron.schedule('billing-daily', '5 22 * * *', $$SELECT generate_period_invoices(NULL, 'cron')$$);

-- Debt-line payments: now include postponed invoices, and can be limited to
-- periods before the current one so the Service and Debt lines never apply
-- money to the same invoice. The new argument defaults to NULL, so calls
-- with the previous 7 arguments behave as before.
DROP FUNCTION IF EXISTS pay_subscriber_debt_fifo(UUID, DECIMAL, DATE, TEXT, TEXT, UUID, UUID);

CREATE FUNCTION pay_subscriber_debt_fifo(
  p_subscriber_id UUID,
  p_amount DECIMAL(10,2),
  p_payment_date DATE,
  p_method TEXT,
  p_note TEXT,
  p_collector_id UUID,
  p_staff_id UUID,
  p_before_period DATE DEFAULT NULL
) RETURNS DECIMAL(10,2) AS $$
DECLARE
  v_remaining DECIMAL(10,2) := p_amount;
  v_applied DECIMAL(10,2) := 0;
  v_invoice RECORD;
  v_balance DECIMAL(10,2);
  v_chunk DECIMAL(10,2);
BEGIN
  FOR v_invoice IN
    SELECT i.id, i.amount_due,
           COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) AS paid
    FROM invoices i
    WHERE i.subscriber_id = p_subscriber_id
      AND i.status IN ('unpaid', 'partial', 'postponed')
      AND (p_before_period IS NULL OR i.period_month < p_before_period)
    ORDER BY i.period_month ASC
    FOR UPDATE OF i
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_balance := v_invoice.amount_due - v_invoice.paid;
    CONTINUE WHEN v_balance <= 0;
    v_chunk := LEAST(v_balance, v_remaining);

    INSERT INTO payments (invoice_id, subscriber_id, collector_id, amount, payment_date, method, note, staff_id)
    VALUES (v_invoice.id, p_subscriber_id, p_collector_id, v_chunk, p_payment_date, p_method, p_note, p_staff_id);

    v_remaining := v_remaining - v_chunk;
    v_applied := v_applied + v_chunk;
  END LOOP;

  RETURN v_applied;
END;
$$ LANGUAGE plpgsql;

-- 9. The Pay modal's Service line, atomically -------------------------------
--
-- p_choice (only meaningful when the amount doesn't match what's owed):
--   under-payment:  'msama7' forgives the rest; anything else leaves it
--                   open (it carries into next month's invoice)
--   over-payment:   'rollover' records the excess as a payment on next
--                   month's invoice; 'skip' cancels the whole line
-- p_new_price: the entered amount becomes the subscriber's permanent price
--   and this month's bill.
CREATE OR REPLACE FUNCTION pay_service_line(
  p_subscriber_id UUID,
  p_amount DECIMAL(10,2),
  p_choice TEXT,
  p_new_price BOOLEAN,
  p_payment_date DATE,
  p_method TEXT,
  p_note TEXT,
  p_collector_id UUID,
  p_staff_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_period DATE := app_current_period();
  v_next_period DATE := (app_current_period() + INTERVAL '1 month')::date;
  v_service UUID;
  v_invoice_id UUID;
  v_status TEXT;
  v_due DECIMAL(10,2);
  v_paid DECIMAL(10,2);
  v_remaining DECIMAL(10,2);
  v_pay DECIMAL(10,2);
  v_excess DECIMAL(10,2) := 0;
  v_next_id UUID;
  v_next_remaining DECIMAL(10,2);
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be 0 or more.';
  END IF;

  SELECT service_id INTO v_service FROM subscribers WHERE id = p_subscriber_id;
  IF v_service IS NULL THEN
    RAISE EXCEPTION 'This subscriber has no service assigned to bill against.';
  END IF;

  PERFORM create_period_invoice(p_subscriber_id, v_service, v_period);

  SELECT id, status, amount_due INTO v_invoice_id, v_status, v_due
  FROM invoices WHERE subscriber_id = p_subscriber_id AND period_month = v_period
  FOR UPDATE;
  IF v_status = 'waived' THEN
    RAISE EXCEPTION 'This month''s invoice is already closed (forgiven).';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE invoice_id = v_invoice_id;
  v_remaining := GREATEST(v_due - v_paid, 0);

  IF p_new_price THEN
    -- Entered amount is the new monthly price and this month's whole bill.
    UPDATE subscribers SET price = p_amount, updated_at = now() WHERE id = p_subscriber_id;
    UPDATE invoices SET amount_due = GREATEST(p_amount, v_paid), updated_at = now() WHERE id = v_invoice_id;
    v_pay := GREATEST(p_amount - v_paid, 0);
  ELSE
    IF p_amount > v_remaining AND p_choice = 'skip' THEN
      RETURN jsonb_build_object('invoiceId', v_invoice_id, 'applied', 0, 'skipped', true);
    END IF;
    v_pay := LEAST(p_amount, v_remaining);
    IF p_amount > v_remaining AND p_choice = 'rollover' THEN
      v_excess := p_amount - v_remaining;
    END IF;
  END IF;

  IF v_pay > 0 THEN
    INSERT INTO payments (invoice_id, subscriber_id, collector_id, amount, payment_date, method, note, staff_id)
    VALUES (v_invoice_id, p_subscriber_id, p_collector_id, v_pay, p_payment_date, p_method, p_note, p_staff_id);
  END IF;

  IF NOT p_new_price AND p_amount < v_remaining AND p_choice = 'msama7' THEN
    UPDATE invoices SET status = 'waived', waive_reason = 'forgiven' WHERE id = v_invoice_id;
  END IF;

  IF v_excess > 0 THEN
    PERFORM create_period_invoice(p_subscriber_id, v_service, v_next_period);
    SELECT i.id, i.amount_due - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0)
    INTO v_next_id, v_next_remaining
    FROM invoices i WHERE i.subscriber_id = p_subscriber_id AND i.period_month = v_next_period
    FOR UPDATE;
    IF v_excess > v_next_remaining THEN
      RAISE EXCEPTION 'Overpayment of % is more than next month''s bill (%). Enter a smaller amount.',
        v_excess, v_next_remaining;
    END IF;
    INSERT INTO payments (invoice_id, subscriber_id, collector_id, amount, payment_date, method, note, staff_id)
    VALUES (v_next_id, p_subscriber_id, p_collector_id, v_excess, p_payment_date, p_method,
            COALESCE(p_note || ' -- ', '') || 'paid in advance', p_staff_id);
  END IF;

  RETURN jsonb_build_object('invoiceId', v_invoice_id, 'applied', v_pay, 'advance', v_excess, 'skipped', false);
END;
$$ LANGUAGE plpgsql;

-- monthly_log: expose why an invoice was waived and how much was forgiven
-- (appended at the end -- CREATE OR REPLACE VIEW can only add trailing
-- columns, see 0006).
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
  (SELECT MAX(p.payment_date) FROM payments p WHERE p.invoice_id = i.id) AS collected_at,
  s.service_id,
  s.company_id,
  svc.name AS service_name,
  comp.name AS company_name,
  s.owner_id,
  s.default_collector_id AS collector_id,
  i.waive_reason,
  i.forgiven_amount
FROM invoices i
JOIN subscribers s ON i.subscriber_id = s.id
LEFT JOIN owners o ON s.owner_id = o.id
LEFT JOIN collectors col ON s.default_collector_id = col.id
LEFT JOIN services svc ON svc.id = s.service_id
LEFT JOIN companies comp ON comp.id = s.company_id;

-- Backfill ----------------------------------------------------------------

-- The three existing waived invoices were all msama7 (none has a later
-- invoice that could have absorbed them).
UPDATE invoices i
SET waive_reason = 'forgiven',
    waived_at = COALESCE(i.waived_at, i.updated_at),
    forgiven_amount = GREATEST(i.amount_due - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0), 0)
WHERE i.status = 'waived' AND i.waive_reason IS NULL;

-- Forgiven subscribers whose expiry never moved (the bug this fixes).
SELECT renew_subscriber_for_period(i.subscriber_id, i.period_month)
FROM invoices i
JOIN subscribers s ON s.id = i.subscriber_id
WHERE i.waive_reason = 'forgiven' AND s.expiry_date < app_today();

-- Open invoices get their real billing-day due date.
UPDATE invoices i
SET due_date = anchor_date_in_month(i.period_month, subscriber_anchor_day(s.connection_date, s.expiry_date))
FROM subscribers s
WHERE s.id = i.subscriber_id AND i.status IN ('unpaid', 'partial') AND i.due_date = i.period_month;

SELECT refresh_all_subscriber_debt();
