-- Phase 5: invoicing/payments/postponement support.

ALTER TABLE invoices ADD COLUMN whatsapp_sent_at TIMESTAMPTZ;

-- Postponing must update the invoice, write an audit row, AND move the
-- subscriber's expiry_date, atomically -- never just one of the three.
CREATE OR REPLACE FUNCTION postpone_invoice(
  p_invoice_id UUID,
  p_new_due_date DATE,
  p_reason TEXT,
  p_staff_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_old_due_date DATE;
  v_subscriber_id UUID;
BEGIN
  SELECT due_date, subscriber_id INTO v_old_due_date, v_subscriber_id
  FROM invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  UPDATE invoices
  SET postponed_to = p_new_due_date,
      status = 'postponed',
      updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO postponements (invoice_id, old_due_date, new_due_date, reason, requested_by)
  VALUES (p_invoice_id, v_old_due_date, p_new_due_date, p_reason, p_staff_id);

  UPDATE subscribers
  SET expiry_date = p_new_due_date,
      updated_at = now()
  WHERE id = v_subscriber_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
