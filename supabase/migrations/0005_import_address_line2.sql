-- Fixes 0004's address mapping before any real import has run: the source
-- export's "Building" column is a building name/number, which maps onto
-- subscriber_addresses.line2 -- not "city" (the export has no city column at
-- all). Function-only change; subscriber_addresses.line2 already existed.
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
          line2      = COALESCE(NULLIF(v_address->>'line2', ''), line2),
          region     = COALESCE(NULLIF(v_address->>'region', ''), region),
          updated_at = now()
        WHERE subscriber_id = v_subscriber_id AND is_primary = true;
      ELSE
        INSERT INTO subscriber_addresses (subscriber_id, label, line1, line2, region, is_primary)
        VALUES (
          v_subscriber_id, 'home',
          NULLIF(v_address->>'line1', ''),
          NULLIF(v_address->>'line2', ''),
          NULLIF(v_address->>'region', ''),
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
