-- System-wide subscriber workflow overhaul, phase 1 (schema):
--   - Replaces the free-typed-then-region-tagged address model with a
--     single predefined "addresses" dropdown (client instruction: "solid
--     addresses that are predefined", "remove region"). Same admin-managed
--     reference-table pattern as regions/collectors/owners.
--   - The old free-text subscribers.address column is left in place,
--     UNTOUCHED -- it holds real historical data with no reliable
--     automatic mapping onto the new predefined list (client confirmed the
--     new list starts empty, not seeded from existing data), so nothing is
--     migrated/discarded here. It's simply no longer bound to the form.
--   - Adds collect_track_items: a new personal "Dabdabeh" list per staff
--     member (client confirmed: personal, not shared) that a collector/
--     admin builds via a new subscriber-list bulk action and manually
--     reorders top-to-bottom.
--   - Extends monthly_log (append-only trailing columns, same constraint
--     hit before in 0006/0019 -- CREATE OR REPLACE VIEW only allows adding
--     new trailing columns) with real id columns so the Monthly Log page
--     can filter by company/service/owner/collector instead of matching
--     on name strings.

CREATE TABLE addresses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_addresses_updated_at BEFORE UPDATE ON addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE subscribers ADD COLUMN address_id UUID REFERENCES addresses(id) ON DELETE SET NULL;
CREATE INDEX idx_subscribers_address_id ON subscribers(address_id);

ALTER TABLE subscribers DROP COLUMN region_id;
DROP TABLE regions;

CREATE TABLE collect_track_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id        UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    subscriber_id   UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, subscriber_id)
);
CREATE INDEX idx_collect_track_items_staff_id ON collect_track_items(staff_id);

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
  s.default_collector_id AS collector_id
FROM invoices i
JOIN subscribers s ON i.subscriber_id = s.id
LEFT JOIN owners o ON s.owner_id = o.id
LEFT JOIN collectors col ON s.default_collector_id = col.id
LEFT JOIN services svc ON svc.id = s.service_id
LEFT JOIN companies comp ON comp.id = s.company_id;

-- Excel import RPC: region matching redirected at addresses (same
-- auto-create-by-name treatment regions had -- an unresolved address isn't
-- worth blocking an import over, unlike Company/Service).
CREATE OR REPLACE FUNCTION import_subscribers_batch(
  p_rows JSONB,
  p_staff_id UUID,
  p_filename TEXT,
  p_rows_total INTEGER,
  p_skipped JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_row JSONB;
  v_address JSONB;
  v_address_name TEXT;
  v_address_id UUID;
  v_owner_name TEXT;
  v_owner_id UUID;
  v_subscriber_id UUID;
  v_created INTEGER := 0;
  v_updated INTEGER := 0;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_address := v_row->'address';
    v_address_id := NULL;
    IF v_address IS NOT NULL AND v_address <> 'null'::jsonb THEN
      v_address_name := NULLIF(trim(v_address->>'region'), '');
      IF v_address_name IS NOT NULL THEN
        SELECT id INTO v_address_id FROM addresses WHERE name = v_address_name;
        IF v_address_id IS NULL THEN
          INSERT INTO addresses (name) VALUES (v_address_name)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id INTO v_address_id;
        END IF;
      END IF;
    END IF;

    v_owner_name := NULLIF(trim(v_row->>'owner_name'), '');
    v_owner_id := NULL;
    IF v_owner_name IS NOT NULL THEN
      SELECT id INTO v_owner_id FROM owners WHERE name = v_owner_name;
      IF v_owner_id IS NULL THEN
        INSERT INTO owners (name) VALUES (v_owner_name) RETURNING id INTO v_owner_id;
      END IF;
    END IF;

    SELECT id INTO v_subscriber_id
    FROM subscribers
    WHERE external_username = v_row->>'external_username';

    IF v_subscriber_id IS NULL THEN
      v_subscriber_id := gen_random_uuid();
      INSERT INTO subscribers (
        id, external_username, name, phone, notes, connection_status,
        expiry_date, connection_date, service_id, company_id, owner_id,
        default_collector_id, address, address_id, building, password,
        switch, mac_address, price, balance, nationality
      ) VALUES (
        v_subscriber_id,
        v_row->>'external_username',
        v_row->>'name',
        NULLIF(v_row->>'phone', ''),
        NULLIF(v_row->>'notes', ''),
        v_row->>'connection_status',
        NULLIF(v_row->>'expiry_date', '')::date,
        NULLIF(v_row->>'connection_date', '')::date,
        (v_row->>'service_id')::uuid,
        NULLIF(v_row->>'company_id', '')::uuid,
        v_owner_id,
        CASE WHEN (v_row->>'has_collector')::boolean
             THEN (v_row->>'default_collector_id')::uuid END,
        CASE WHEN v_address IS NOT NULL AND v_address <> 'null'::jsonb
             THEN NULLIF(v_address->>'line1', '') END,
        v_address_id,
        NULLIF(v_row->>'building', ''),
        NULLIF(v_row->>'password', ''),
        NULLIF(v_row->>'switch', ''),
        NULLIF(v_row->>'mac_address', ''),
        NULLIF(v_row->>'price', '')::decimal,
        NULLIF(v_row->>'balance', '')::decimal,
        NULLIF(v_row->>'nationality', '')
      );
      v_created := v_created + 1;
    ELSE
      UPDATE subscribers SET
        name               = v_row->>'name',
        phone              = COALESCE(NULLIF(v_row->>'phone', ''), phone),
        notes              = COALESCE(NULLIF(v_row->>'notes', ''), notes),
        connection_status  = v_row->>'connection_status',
        expiry_date        = NULLIF(v_row->>'expiry_date', '')::date,
        connection_date    = COALESCE(NULLIF(v_row->>'connection_date', '')::date, connection_date),
        service_id         = (v_row->>'service_id')::uuid,
        company_id         = COALESCE(NULLIF(v_row->>'company_id', '')::uuid, company_id),
        owner_id           = COALESCE(v_owner_id, owner_id),
        default_collector_id = CASE WHEN (v_row->>'has_collector')::boolean
                                     THEN (v_row->>'default_collector_id')::uuid
                                     ELSE default_collector_id END,
        address            = CASE WHEN v_address IS NOT NULL AND v_address <> 'null'::jsonb
                                   THEN COALESCE(NULLIF(v_address->>'line1', ''), address)
                                   ELSE address END,
        address_id         = COALESCE(v_address_id, address_id),
        building           = COALESCE(NULLIF(v_row->>'building', ''), building),
        password           = COALESCE(NULLIF(v_row->>'password', ''), password),
        switch             = COALESCE(NULLIF(v_row->>'switch', ''), switch),
        mac_address        = COALESCE(NULLIF(v_row->>'mac_address', ''), mac_address),
        price              = COALESCE(NULLIF(v_row->>'price', '')::decimal, price),
        balance            = COALESCE(NULLIF(v_row->>'balance', '')::decimal, balance),
        nationality        = COALESCE(NULLIF(v_row->>'nationality', ''), nationality),
        updated_at         = now()
      WHERE id = v_subscriber_id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  INSERT INTO import_logs (staff_id, filename, rows_total, rows_created, rows_updated, rows_skipped, skipped)
  VALUES (p_staff_id, p_filename, p_rows_total, v_created, v_updated, jsonb_array_length(p_skipped), p_skipped);

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', jsonb_array_length(p_skipped));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
