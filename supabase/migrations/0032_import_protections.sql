-- Import and data-quality protections, following the review of the Excel
-- import against live data.
--
-- 1. Re-importing the ISP panel's export no longer silently overwrites
--    what the app itself manages for an existing subscriber:
--      expiry_date        (moved by payments, forgiveness, postponement)
--      connection_status  (Deactivate in the app)
--      service/company    (changed in the app)
--      price              (the Pay modal's "new permanent price")
--    Each is only updated when the admin ticks it for that import
--    (p_options), and even then a blank expiry or a 0 price in the file
--    never wipes the stored value. New subscribers get everything.
-- 2. Usernames match regardless of case/surrounding spaces, enforced by a
--    unique index (live data had no such clashes).
-- 3. Phone numbers are stored in one international format (+961...) no
--    matter where they come from, so wa.me links always work; junk values
--    ("None", "0") become empty.
--
-- p_options is a new trailing argument with a default, so the previous
-- frontend's 5-argument call still works -- and now gets the protective
-- behaviour by default.

CREATE UNIQUE INDEX idx_subscribers_external_username_lower
  ON subscribers (lower(trim(external_username)))
  WHERE external_username IS NOT NULL;

-- Lebanese numbers: 8 digits with a leading 0 (03123456) or 7-8 digits
-- without (3123456 / 71123456) get the 961 prefix; 00-prefixed and
-- already-international numbers keep their country code. Fewer than 7
-- digits is not a phone number.
CREATE OR REPLACE FUNCTION normalize_phone(p_phone TEXT) RETURNS TEXT AS $$
DECLARE
  v TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  IF v LIKE '00%' THEN
    v := substr(v, 3);
  END IF;
  IF length(v) < 7 THEN
    RETURN NULL;
  END IF;
  IF length(v) = 8 AND v LIKE '0%' THEN
    RETURN '+961' || substr(v, 2);
  END IF;
  IF length(v) IN (7, 8) THEN
    RETURN '+961' || v;
  END IF;
  RETURN '+' || v;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION subscribers_normalize_phone() RETURNS TRIGGER AS $$
BEGIN
  NEW.phone := normalize_phone(NEW.phone);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscribers_normalize_phone
  BEFORE INSERT OR UPDATE OF phone ON subscribers
  FOR EACH ROW EXECUTE FUNCTION subscribers_normalize_phone();

UPDATE subscribers SET phone = phone WHERE phone IS DISTINCT FROM normalize_phone(phone);

DROP FUNCTION IF EXISTS import_subscribers_batch(JSONB, UUID, TEXT, INTEGER, JSONB);

CREATE FUNCTION import_subscribers_batch(
  p_rows JSONB,
  p_staff_id UUID,
  p_filename TEXT,
  p_rows_total INTEGER,
  p_skipped JSONB DEFAULT '[]'::jsonb,
  p_options JSONB DEFAULT '{}'::jsonb
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
  v_update_expiry BOOLEAN := COALESCE((p_options->>'update_expiry')::boolean, false);
  v_update_status BOOLEAN := COALESCE((p_options->>'update_status')::boolean, false);
  v_update_service BOOLEAN := COALESCE((p_options->>'update_service')::boolean, false);
  v_update_price BOOLEAN := COALESCE((p_options->>'update_price')::boolean, false);
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
    WHERE lower(trim(external_username)) = lower(trim(v_row->>'external_username'));

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
        NULLIF(NULLIF(v_row->>'price', '')::decimal, 0),
        NULLIF(v_row->>'balance', '')::decimal,
        NULLIF(v_row->>'nationality', '')
      );
      v_created := v_created + 1;
    ELSE
      UPDATE subscribers SET
        name               = v_row->>'name',
        phone              = COALESCE(NULLIF(v_row->>'phone', ''), phone),
        notes              = COALESCE(NULLIF(v_row->>'notes', ''), notes),
        connection_status  = CASE WHEN v_update_status THEN v_row->>'connection_status' ELSE connection_status END,
        expiry_date        = CASE WHEN v_update_expiry
                                  THEN COALESCE(NULLIF(v_row->>'expiry_date', '')::date, expiry_date)
                                  ELSE expiry_date END,
        connection_date    = COALESCE(NULLIF(v_row->>'connection_date', '')::date, connection_date),
        service_id         = CASE WHEN v_update_service THEN (v_row->>'service_id')::uuid ELSE service_id END,
        company_id         = CASE WHEN v_update_service
                                  THEN COALESCE(NULLIF(v_row->>'company_id', '')::uuid, company_id)
                                  ELSE company_id END,
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
        price              = CASE WHEN v_update_price
                                  THEN COALESCE(NULLIF(NULLIF(v_row->>'price', '')::decimal, 0), price)
                                  ELSE price END,
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
