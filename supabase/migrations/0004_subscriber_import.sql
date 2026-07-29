-- Phase: Excel import (Excel -> Supabase, one-way, run periodically by admin).
--
-- external_username is the dedupe key across re-imports of the ISP panel's
-- export -- it's the only stable identifier the export gives us. Nullable +
-- unique so manually-created subscribers (no Excel origin) are unaffected.
ALTER TABLE subscribers ADD COLUMN external_username TEXT UNIQUE;

-- Network metadata from the export (password, switch, mac address) plus
-- low-priority fields with no natural column (nationality) that aren't worth
-- a dedicated schema change. Not billing-relevant, never read by invoicing.
ALTER TABLE subscribers ADD COLUMN import_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_subscribers_external_username ON subscribers(external_username)
  WHERE external_username IS NOT NULL;

CREATE TABLE import_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id      UUID REFERENCES staff(id) ON DELETE SET NULL,
    filename      TEXT NOT NULL,
    rows_total    INTEGER NOT NULL,
    rows_created  INTEGER NOT NULL,
    rows_updated  INTEGER NOT NULL,
    rows_skipped  INTEGER NOT NULL,
    skipped       JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ row, username, reason }]
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_import_logs_created_at ON import_logs(created_at);

-- One transaction for the whole batch: the client has already parsed the
-- file, resolved every service/company/collector reference to a real id,
-- and excluded/flagged anything invalid -- by the time this runs, every row
-- is expected to apply cleanly. If any row fails (bad FK, bad cast), the
-- whole function aborts and nothing commits, so a mid-import failure never
-- leaves partial data.
--
-- Never touches invoices/payments -- those are owned by the app's own
-- billing flow from the moment a subscriber exists, not by the Excel file.
--
-- Row shape (each element of p_rows):
-- {
--   external_username, name, phone, notes,       -- text, nullable except username/name
--   connection_status,                             -- 'active' | 'suspended'
--   expiry_date, connection_date,                   -- 'YYYY-MM-DD' or null
--   service_id,                                     -- uuid, required, pre-resolved
--   has_collector, default_collector_id,            -- has_collector=false -> leave existing collector untouched
--   address: { line1, region, city } | null,        -- null -> leave existing address untouched
--   import_metadata: { password, switch, mac_address, nationality }
-- }
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
  v_subscriber_id UUID;
  v_created INTEGER := 0;
  v_updated INTEGER := 0;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    SELECT id INTO v_subscriber_id
    FROM subscribers
    WHERE external_username = v_row->>'external_username';

    IF v_subscriber_id IS NULL THEN
      v_subscriber_id := gen_random_uuid();
      INSERT INTO subscribers (
        id, external_username, name, phone, notes, connection_status,
        expiry_date, connection_date, service_id, default_collector_id,
        import_metadata
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
        import_metadata    = COALESCE(v_row->'import_metadata', import_metadata),
        updated_at         = now()
      WHERE id = v_subscriber_id;
      v_updated := v_updated + 1;
    END IF;

    v_address := v_row->'address';
    IF v_address IS NOT NULL AND v_address <> 'null'::jsonb THEN
      IF EXISTS (
        SELECT 1 FROM subscriber_addresses
        WHERE subscriber_id = v_subscriber_id AND is_primary = true
      ) THEN
        UPDATE subscriber_addresses SET
          line1      = COALESCE(NULLIF(v_address->>'line1', ''), line1),
          region     = COALESCE(NULLIF(v_address->>'region', ''), region),
          city       = COALESCE(NULLIF(v_address->>'city', ''), city),
          updated_at = now()
        WHERE subscriber_id = v_subscriber_id AND is_primary = true;
      ELSE
        INSERT INTO subscriber_addresses (subscriber_id, label, line1, region, city, is_primary)
        VALUES (
          v_subscriber_id, 'home',
          NULLIF(v_address->>'line1', ''),
          NULLIF(v_address->>'region', ''),
          NULLIF(v_address->>'city', ''),
          true
        );
      END IF;
    END IF;
  END LOOP;

  INSERT INTO import_logs (staff_id, filename, rows_total, rows_created, rows_updated, rows_skipped, skipped)
  VALUES (p_staff_id, p_filename, p_rows_total, v_created, v_updated, jsonb_array_length(p_skipped), p_skipped);

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', jsonb_array_length(p_skipped));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
