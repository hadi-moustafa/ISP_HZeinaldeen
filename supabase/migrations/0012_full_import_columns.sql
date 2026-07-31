-- Client gave the full, authoritative list of Excel columns and asked for a
-- real subscribers column per column, plus a clean split between Reseller
-- (-> owners, "who the account belongs to") and the new Company column
-- (-> companies, the network operator servicing them) -- previously
-- "Reseller" alone did the job Company now does.
--
-- password/switch/mac_address were previously stashed in import_metadata
-- jsonb as a schema-avoidance shortcut; now real columns per explicit
-- instruction. import_metadata has nothing left to hold once those move out,
-- so it's dropped rather than kept around empty.
--
-- price/balance are explicitly PER-SUBSCRIBER override fields (client
-- decision), independent of services.sell_price/paid_price which remain the
-- shared default for everyone on that plan -- these do not feed invoicing.

ALTER TABLE subscribers ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE subscribers ADD COLUMN password TEXT;
ALTER TABLE subscribers ADD COLUMN switch TEXT;
ALTER TABLE subscribers ADD COLUMN mac_address TEXT;
ALTER TABLE subscribers ADD COLUMN building TEXT;
ALTER TABLE subscribers ADD COLUMN price DECIMAL(10,2);
ALTER TABLE subscribers ADD COLUMN balance DECIMAL(10,2);
CREATE INDEX idx_subscribers_company_id ON subscribers(company_id);

-- Backfill company_id from each subscriber's current service, so this
-- migration doesn't silently blank out "which company" for existing data.
UPDATE subscribers s
SET company_id = sv.comp_id
FROM services sv
WHERE s.service_id = sv.id AND s.company_id IS NULL;

-- Backfill the three fields that used to live in import_metadata.
UPDATE subscribers
SET password    = NULLIF(import_metadata->>'password', ''),
    switch      = NULLIF(import_metadata->>'switch', ''),
    mac_address = NULLIF(import_metadata->>'mac_address', '')
WHERE import_metadata IS NOT NULL AND import_metadata <> '{}'::jsonb;

ALTER TABLE subscribers DROP COLUMN import_metadata;

-- Excel import RPC, rewritten for the new column set:
--   - Reseller -> owners (auto-created by name if it doesn't exist yet, same
--     low-stakes auto-create treatment as regions -- unlike Company/Service,
--     an unresolved owner isn't worth blocking an import over).
--   - Company -> company_id, pre-resolved client-side (same pattern as
--     service_id) since Company also disambiguates which Service row to use
--     when a service name exists under more than one company.
--   - password/switch/mac_address/building/price/balance/nationality now
--     write directly onto subscribers instead of import_metadata.
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
  v_region_name TEXT;
  v_region_id UUID;
  v_owner_name TEXT;
  v_owner_id UUID;
  v_subscriber_id UUID;
  v_created INTEGER := 0;
  v_updated INTEGER := 0;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_address := v_row->'address';
    v_region_id := NULL;
    IF v_address IS NOT NULL AND v_address <> 'null'::jsonb THEN
      v_region_name := NULLIF(trim(v_address->>'region'), '');
      IF v_region_name IS NOT NULL THEN
        SELECT id INTO v_region_id FROM regions WHERE name = v_region_name;
        IF v_region_id IS NULL THEN
          INSERT INTO regions (name) VALUES (v_region_name)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id INTO v_region_id;
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
        default_collector_id, address, region_id, building, password,
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
        v_region_id,
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
        region_id          = COALESCE(v_region_id, region_id),
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
