-- Two-tier location filter, per client request: "select an address... then
-- select a region... this will show us the users of the selected address
-- whose region is of the selected region." Region is scoped UNDER an
-- address (not a standalone flat list like the old, dropped `regions`
-- table from 0011/0020) -- e.g. address "Jorn" can have its own regions
-- "Street 1", "Block A" that only make sense within Jorn.
--
-- This also finally gives the Excel import's Region column a real home:
-- since 0020 replaced free-typed regions with the addresses dropdown, the
-- importer's `region` key was repurposed to feed address_id (fixed to read
-- the Address column instead in the prior commit) and the file's actual
-- Region column data had nowhere to go. It now feeds this new table,
-- scoped under whichever address the row resolved to.
CREATE TABLE regions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id  UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (address_id, name)
);
CREATE INDEX idx_regions_address_id ON regions(address_id);
CREATE TRIGGER trg_regions_updated_at BEFORE UPDATE ON regions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE subscribers ADD COLUMN region_id UUID REFERENCES regions(id) ON DELETE SET NULL;
CREATE INDEX idx_subscribers_region_id ON subscribers(region_id);

-- Excel import RPC: resolves/creates a region scoped to the row's resolved
-- address_id from the file's Region column, same auto-create-by-name
-- treatment as addresses/owners -- an unresolved region isn't worth
-- blocking an import over. A region can't exist without a parent address,
-- so a row with no resolvable address gets no region either.
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
        SELECT id INTO v_address_id FROM addresses WHERE name = v_address_name;
        IF v_address_id IS NULL THEN
          INSERT INTO addresses (name) VALUES (v_address_name)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id INTO v_address_id;
        END IF;
      END IF;
    END IF;

    v_region_id := NULL;
    v_region_name := NULLIF(trim(v_row->>'region_name'), '');
    IF v_region_name IS NOT NULL AND v_address_id IS NOT NULL THEN
      SELECT id INTO v_region_id FROM regions WHERE address_id = v_address_id AND name = v_region_name;
      IF v_region_id IS NULL THEN
        INSERT INTO regions (address_id, name) VALUES (v_address_id, v_region_name)
        ON CONFLICT (address_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_region_id;
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
