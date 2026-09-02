-- The Excel importer matched address names case-sensitively, so a file
-- spelling an area "se7a" created a SECOND address row alongside the
-- admin's existing "Se7a" -- splitting one real place across two entries in
-- the (new) two-tier Address/Region filter and in every address dropdown.
-- Seen live: 5 duplicate pairs (Taray/taray, Hawooz/hawooz, Se7a/se7a,
-- Jorn/jorn, Wa3r/wa3r), all created by one re-import.
--
-- Fixes it three ways: merge what's already duplicated, make the DB refuse
-- new case-duplicates, and match case-insensitively at import time.

-- 1. Merge existing case-duplicate addresses into the oldest row of each
--    name (the admin's own, properly-cased entry -- imports came later).
DO $$
DECLARE
  v_winner UUID;
  v_loser UUID;
BEGIN
  FOR v_winner, v_loser IN
    SELECT first_value(id) OVER w, id
    FROM addresses
    WINDOW w AS (PARTITION BY lower(trim(name)) ORDER BY created_at)
  LOOP
    CONTINUE WHEN v_winner = v_loser;

    -- A region under the loser moves to the winner, unless the winner
    -- already has one of that name -- then subscribers are repointed at the
    -- winner's region and the duplicate region is dropped.
    UPDATE subscribers s SET region_id = w.id
    FROM regions l
    JOIN regions w ON w.address_id = v_winner AND lower(trim(w.name)) = lower(trim(l.name))
    WHERE l.address_id = v_loser AND s.region_id = l.id;

    DELETE FROM regions l
    WHERE l.address_id = v_loser
      AND EXISTS (SELECT 1 FROM regions w WHERE w.address_id = v_winner AND lower(trim(w.name)) = lower(trim(l.name)));

    UPDATE regions SET address_id = v_winner WHERE address_id = v_loser;
    UPDATE subscribers SET address_id = v_winner WHERE address_id = v_loser;
    DELETE FROM addresses WHERE id = v_loser;
  END LOOP;
END $$;

-- 2. Refuse new case-duplicates at the DB level. Replaces the plain UNIQUE
--    on addresses.name (a case-insensitive index is strictly stronger).
ALTER TABLE addresses DROP CONSTRAINT IF EXISTS addresses_name_key;
CREATE UNIQUE INDEX idx_addresses_name_lower ON addresses (lower(trim(name)));

ALTER TABLE regions DROP CONSTRAINT IF EXISTS regions_address_id_name_key;
CREATE UNIQUE INDEX idx_regions_address_name_lower ON regions (address_id, lower(trim(name)));

-- 3. Import matches both tiers case-insensitively, and only creates a row
--    when no case-insensitive match exists. The ON CONFLICT clauses are
--    gone with the constraints they named -- the lookup above them is what
--    prevents duplicates now.
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
    v_address_id := NULL;
    IF v_address IS NOT NULL AND v_address <> 'null'::jsonb THEN
      v_address_name := NULLIF(trim(v_address->>'region'), '');
      IF v_address_name IS NOT NULL THEN
        SELECT id INTO v_address_id FROM addresses WHERE lower(trim(name)) = lower(v_address_name);
        IF v_address_id IS NULL THEN
          INSERT INTO addresses (name) VALUES (v_address_name) RETURNING id INTO v_address_id;
        END IF;
      END IF;
    END IF;

    v_region_id := NULL;
    v_region_name := NULLIF(trim(v_row->>'region_name'), '');
    IF v_region_name IS NOT NULL AND v_address_id IS NOT NULL THEN
      SELECT id INTO v_region_id FROM regions
      WHERE address_id = v_address_id AND lower(trim(name)) = lower(v_region_name);
      IF v_region_id IS NULL THEN
        INSERT INTO regions (address_id, name) VALUES (v_address_id, v_region_name) RETURNING id INTO v_region_id;
      END IF;
    END IF;

    v_owner_name := NULLIF(trim(v_row->>'owner_name'), '');
    v_owner_id := NULL;
    IF v_owner_name IS NOT NULL THEN
      SELECT id INTO v_owner_id FROM owners WHERE lower(trim(name)) = lower(v_owner_name);
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
        default_collector_id, address, address_id, region_id, building, password,
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
        address_id         = COALESCE(v_address_id, address_id),
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
