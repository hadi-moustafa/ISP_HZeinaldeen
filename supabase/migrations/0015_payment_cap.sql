-- Hard backstop so a subscriber's total payments on one invoice can never
-- exceed that invoice's amount_due (e.g. a $30 service can never show $40
-- paid) -- the app already caps this client-side (max attribute + a
-- pre-submit check in SubscribersListPage/InvoicesSection), but that alone
-- doesn't protect against a second staff member submitting concurrently or
-- anything hitting the API directly. Ad-hoc payments (invoice_id IS NULL,
-- already allowed elsewhere in the app for a subscriber with no service to
-- bill against) aren't capped since there's no invoice amount to cap
-- against. The Debt-mode 2x invoice isn't a special case here -- it's
-- already reflected in that invoice's own amount_due, so paying up to the
-- doubled amount is correctly still allowed.
CREATE OR REPLACE FUNCTION enforce_payment_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_amount_due DECIMAL(10,2);
  v_total_other DECIMAL(10,2);
BEGIN
  IF NEW.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT amount_due INTO v_amount_due FROM invoices WHERE id = NEW.invoice_id;
  IF v_amount_due IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_other
  FROM payments
  WHERE invoice_id = NEW.invoice_id AND id IS DISTINCT FROM NEW.id;

  IF v_total_other + NEW.amount > v_amount_due THEN
    RAISE EXCEPTION 'Payment of % would push total paid to % past this invoice''s amount_due of %',
      NEW.amount, v_total_other + NEW.amount, v_amount_due;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_enforce_cap
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_cap();
