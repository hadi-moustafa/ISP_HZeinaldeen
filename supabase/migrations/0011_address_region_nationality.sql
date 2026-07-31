-- Simplifies subscriber addressing and nationality per client request:
--   - Addresses: subscribers previously had a whole subscriber_addresses
--     table (multiple labeled addresses, each with line1/line2/city/region/
--     country) with a dedicated CRUD modal. Client wants exactly one address
--     line per subscriber, with the region/area picked from a short
--     admin-managed list instead of freely typed -- so region becomes a
--     dropdown backed by a new `regions` reference table, same pattern as
--     collectors/owners.
--   - Nationality: national_id was a free-text field. Client wants it
--     replaced outright by a Lebanese/Syrian selector (not a separate
--     nationality field alongside a kept ID number) -- renamed to
--     `nationality` with a CHECK constraint. Any existing value that isn't
--     literally 'Lebanese' or 'Syrian' (e.g. real ID numbers typed into the
--     old free-text field) can't satisfy the new constraint and is dropped
--     to NULL -- accepted data loss, since the old field's data doesn't map
--     onto the new one's meaning anyway.

CREATE TABLE regions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_regions_updated_at BEFORE UPDATE ON regions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE subscribers ADD COLUMN address TEXT;
ALTER TABLE subscribers ADD COLUMN region_id UUID REFERENCES regions(id) ON DELETE SET NULL;
CREATE INDEX idx_subscribers_region_id ON subscribers(region_id);

-- Backfill from the old subscriber_addresses table (primary address if set,
-- else the first one) before that table is dropped below.
INSERT INTO regions (name)
SELECT DISTINCT trim(region)
FROM subscriber_addresses
WHERE region IS NOT NULL AND trim(region) <> ''
ON CONFLICT (name) DO NOTHING;

WITH picked AS (
  SELECT DISTINCT ON (subscriber_id) subscriber_id, line1, region
  FROM subscriber_addresses
  ORDER BY subscriber_id, is_primary DESC, created_at ASC
)
UPDATE subscribers s
SET address = picked.line1,
    region_id = r.id
FROM picked
LEFT JOIN regions r ON r.name = trim(picked.region)
WHERE s.id = picked.subscriber_id;

DROP TABLE subscriber_addresses;

ALTER TABLE subscribers RENAME COLUMN national_id TO nationality;
UPDATE subscribers SET nationality = NULL WHERE nationality NOT IN ('Lebanese', 'Syrian');
ALTER TABLE subscribers ADD CONSTRAINT chk_subscribers_nationality
  CHECK (nationality IS NULL OR nationality IN ('Lebanese', 'Syrian'));

-- Excel import RPC: address now writes straight onto subscribers.address /
-- region_id instead of upserting a subscriber_addresses row. Region is
-- matched by name (case-sensitive exact, same as every other reference
-- match in this importer) and auto-created if it doesn't exist yet -- unlike
-- Reseller/Service, an unresolved region isn't worth blocking an import over.
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

    SELECT id INTO v_subscriber_id
    FROM subscribers
    WHERE external_username = v_row->>'external_username';

    IF v_subscriber_id IS NULL THEN
      v_subscriber_id := gen_random_uuid();
      INSERT INTO subscribers (
        id, external_username, name, phone, notes, connection_status,
        expiry_date, connection_date, service_id, default_collector_id,
        address, region_id, import_metadata
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
        CASE WHEN (v_row->>'has_collector')::boolean
             THEN (v_row->>'default_collector_id')::uuid END,
        CASE WHEN v_address IS NOT NULL AND v_address <> 'null'::jsonb
             THEN NULLIF(v_address->>'line1', '') END,
        v_region_id,
        COALESCE(v_row->'import_metadata', '{}'::jsonb)
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
        default_collector_id = CASE WHEN (v_row->>'has_collector')::boolean
                                     THEN (v_row->>'default_collector_id')::uuid
                                     ELSE default_collector_id END,
        address            = CASE WHEN v_address IS NOT NULL AND v_address <> 'null'::jsonb
                                   THEN COALESCE(NULLIF(v_address->>'line1', ''), address)
                                   ELSE address END,
        region_id          = COALESCE(v_region_id, region_id),
        import_metadata    = COALESCE(v_row->'import_metadata', import_metadata),
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
