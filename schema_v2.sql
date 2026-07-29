-- ============================================================
-- ISP Management App — Postgres/Supabase schema (v2)
-- Supersedes schema_v1.sql. Key changes:
--   - All PKs switched to UUID (gen_random_uuid()) for offline-first support:
--     client can generate a record's final ID while offline; syncing later
--     is a simple idempotent upsert with no ID-collision risk.
--   - Added: subscriber_addresses, company_addresses (dynamic addresses)
--   - Added: products, product_movements (inventory/stock ledger)
--   - Added: invoices (monthly billing per subscriber), postponements (audit log)
--   - Added: staff (hardcoded-style admin/collector login accounts)
--   - "user" -> "subscribers" (kept from v1, reserved word + more semantic)
--   - subscribers now has default_collector_id; actual collector per payment
--     is recorded on payments.collector_id (can differ per instance)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid() + password hashing

-- ============================================================
-- STAFF / AUTH
-- ============================================================
-- Simple custom login table (not Supabase Auth users) per client's request:
-- hardcoded-style admin + collector logins, admin can create/edit collector
-- credentials at any time. Passwords are hashed with pgcrypto's crypt(),
-- never stored or compared in plaintext.
CREATE TABLE staff (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN ('admin', 'collector')),
    collector_id   UUID, -- set when role = 'collector', links login to the business entity below (FK added after collectors table exists)
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper to set/reset a password without ever handling plaintext outside this function
CREATE OR REPLACE FUNCTION set_staff_password(p_staff_id UUID, p_new_password TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE staff
  SET password_hash = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = p_staff_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Login check — call via RPC from the app. Returns staff row (no hash) on success, nothing on failure.
CREATE OR REPLACE FUNCTION login_staff(p_username TEXT, p_password TEXT)
RETURNS TABLE(id UUID, username TEXT, role TEXT, collector_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.username, s.role, s.collector_id
  FROM staff s
  WHERE s.username = p_username
    AND s.is_active = true
    AND s.password_hash = crypt(p_password, s.password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- COMPANIES (network operators/providers the ISP resells)
-- ============================================================
CREATE TABLE companies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_addresses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comp_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    label       TEXT DEFAULT 'main', -- e.g. 'main office', 'warehouse'
    line1       TEXT,
    line2       TEXT,
    city        TEXT,
    region      TEXT,
    country     TEXT,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_company_addresses_comp_id ON company_addresses(comp_id);

-- ============================================================
-- SERVICES (plans offered per company)
-- ============================================================
CREATE TABLE services (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comp_id     UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL,
    sell_price  DECIMAL(10,2) NOT NULL CHECK (sell_price >= 0),
    paid_price  DECIMAL(10,2) NOT NULL CHECK (paid_price >= 0), -- what the ISP pays the company
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_services_comp_id ON services(comp_id);

-- ============================================================
-- PRODUCTS / INVENTORY (routers, cables, etc. sold/installed)
-- ============================================================
CREATE TABLE products (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku              TEXT UNIQUE,
    name             TEXT NOT NULL,
    category         TEXT,
    cost_price       DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    sell_price       DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
    quantity_in_stock INTEGER NOT NULL DEFAULT 0,
    reorder_level    INTEGER NOT NULL DEFAULT 0,
    unit             TEXT NOT NULL DEFAULT 'pcs',
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_category ON products(category);

-- Stock ledger — every change in stock is a row here. quantity_in_stock on
-- `products` is a cached total, kept in sync via trigger below.
CREATE TABLE product_movements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    movement_type  TEXT NOT NULL CHECK (movement_type IN ('restock', 'sale', 'adjustment', 'return')),
    quantity       INTEGER NOT NULL, -- positive = stock in, negative = stock out
    unit_price     DECIMAL(10,2), -- price at time of movement (cost for restock, sell for sale)
    subscriber_id  UUID, -- set if sold/installed for a specific subscriber (FK added after subscribers exists)
    staff_id       UUID REFERENCES staff(id) ON DELETE SET NULL,
    note           TEXT,
    movement_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_movements_product_id ON product_movements(product_id);
CREATE INDEX idx_product_movements_date ON product_movements(movement_date);

CREATE OR REPLACE FUNCTION apply_product_movement()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET quantity_in_stock = quantity_in_stock + NEW.quantity,
      updated_at = now()
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_product_movement_insert
  AFTER INSERT ON product_movements
  FOR EACH ROW EXECUTE FUNCTION apply_product_movement();

-- ============================================================
-- COLLECTORS & OWNERS (business entities — distinct from staff logins)
-- ============================================================
CREATE TABLE collectors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    phone       TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE staff ADD CONSTRAINT fk_staff_collector
  FOREIGN KEY (collector_id) REFERENCES collectors(id) ON DELETE SET NULL;

CREATE TABLE owners (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    phone       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SUBSCRIBERS (the ISP's end customers — was "user" in v1)
-- ============================================================
CREATE TABLE subscribers (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 TEXT NOT NULL,
    phone                TEXT,
    national_id          TEXT,
    service_id           UUID REFERENCES services(id) ON DELETE RESTRICT,
    owner_id             UUID REFERENCES owners(id) ON DELETE SET NULL,     -- whose customer this is (one owner -> many subscribers)
    default_collector_id UUID REFERENCES collectors(id) ON DELETE SET NULL, -- usual collector; can be overridden per-payment
    connection_status    TEXT NOT NULL DEFAULT 'active'
                           CHECK (connection_status IN ('active', 'suspended', 'cancelled')),
    expiry_date          DATE,
    connection_date      DATE,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscribers_service_id ON subscribers(service_id);
CREATE INDEX idx_subscribers_owner_id ON subscribers(owner_id);
CREATE INDEX idx_subscribers_default_collector_id ON subscribers(default_collector_id);
CREATE INDEX idx_subscribers_connection_status ON subscribers(connection_status);
CREATE INDEX idx_subscribers_expiry_date ON subscribers(expiry_date);
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- enables fast partial-text search on subscriber name/phone
CREATE INDEX idx_subscribers_name_trgm ON subscribers USING gin (name gin_trgm_ops);

ALTER TABLE product_movements ADD CONSTRAINT fk_product_movements_subscriber
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL;

CREATE TABLE subscriber_addresses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    label       TEXT DEFAULT 'home', -- 'home', 'work', 'installation', etc.
    line1       TEXT,
    line2       TEXT,
    city        TEXT,
    region      TEXT,
    country     TEXT,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriber_addresses_subscriber_id ON subscriber_addresses(subscriber_id);

-- ============================================================
-- INVOICES (one row per subscriber per billing month — powers the monthly log)
-- ============================================================
CREATE TABLE invoices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    service_id    UUID REFERENCES services(id) ON DELETE SET NULL, -- snapshot in case service/price changes later
    period_month  DATE NOT NULL, -- always the 1st of the billing month, e.g. 2026-07-01
    amount_due    DECIMAL(10,2) NOT NULL CHECK (amount_due >= 0),
    due_date      DATE,
    postponed_to  DATE,
    status        TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (status IN ('unpaid', 'partial', 'paid', 'postponed', 'waived')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (subscriber_id, period_month)
);
CREATE INDEX idx_invoices_period_month ON invoices(period_month);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_subscriber_id ON invoices(subscriber_id);

-- Audit trail of postpone actions (separate from invoices.postponed_to so
-- history isn't lost if postponed again)
CREATE TABLE postponements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id     UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    old_due_date   DATE,
    new_due_date   DATE NOT NULL,
    reason         TEXT,
    requested_by   UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_postponements_invoice_id ON postponements(invoice_id);

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

-- ============================================================
-- PAYMENTS (cash collected in person, only ever *logged* here — no gateway)
-- ============================================================
CREATE TABLE payments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id    UUID REFERENCES invoices(id) ON DELETE SET NULL, -- which month this settles; nullable for ad-hoc/unreconciled entries
    subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    collector_id  UUID REFERENCES collectors(id) ON DELETE SET NULL, -- ACTUAL collector this time (may differ from subscriber's default)
    amount        DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
    payment_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    method        TEXT NOT NULL DEFAULT 'cash',
    note          TEXT,
    staff_id      UUID REFERENCES staff(id) ON DELETE SET NULL, -- who logged it in the app
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_subscriber_id ON payments(subscriber_id);
CREATE INDEX idx_payments_collector_id ON payments(collector_id);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_payment_date ON payments(payment_date);

-- Keep invoice.status in sync with total payments received against it
CREATE OR REPLACE FUNCTION sync_invoice_status()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id UUID;
  v_total_paid DECIMAL(10,2);
  v_amount_due DECIMAL(10,2);
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid FROM payments WHERE invoice_id = v_invoice_id;
  SELECT amount_due INTO v_amount_due FROM invoices WHERE id = v_invoice_id;

  UPDATE invoices
  SET status = CASE
        WHEN v_total_paid <= 0 THEN 'unpaid'
        WHEN v_total_paid < v_amount_due THEN 'partial'
        ELSE 'paid'
      END,
      updated_at = now()
  WHERE id = v_invoice_id
    AND status NOT IN ('waived'); -- don't override a manually waived invoice

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_sync_invoice
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION sync_invoice_status();

-- ============================================================
-- updated_at auto-touch trigger, applied to all tables that have the column
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_company_addresses_updated_at BEFORE UPDATE ON company_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_collectors_updated_at BEFORE UPDATE ON collectors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_owners_updated_at BEFORE UPDATE ON owners FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_subscribers_updated_at BEFORE UPDATE ON subscribers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_subscriber_addresses_updated_at BEFORE UPDATE ON subscriber_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- Monthly log page feeds off this directly
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
  i.postponed_to
FROM invoices i
JOIN subscribers s ON i.subscriber_id = s.id
LEFT JOIN owners o ON s.owner_id = o.id
LEFT JOIN collectors col ON s.default_collector_id = col.id;

-- General financial page (admin-only in the app layer): services revenue + product revenue by month
CREATE OR REPLACE VIEW monthly_financials AS
SELECT
  date_trunc('month', p.payment_date)::date AS period_month,
  'services' AS revenue_type,
  SUM(p.amount) AS total
FROM payments p
GROUP BY 1
UNION ALL
SELECT
  date_trunc('month', pm.movement_date)::date AS period_month,
  'products' AS revenue_type,
  SUM(pm.quantity * pm.unit_price * -1) AS total -- sale movements are negative quantity
FROM product_movements pm
WHERE pm.movement_type = 'sale'
GROUP BY 1;

-- ============================================================
-- NOTE ON ROW LEVEL SECURITY
-- ============================================================
-- RLS is intentionally left OPEN for v1 per client instruction ("collector
-- access stays open for now, restrict later"). Before going to production
-- with real restrictions, enable RLS on every table and write policies keyed
-- off a custom JWT claim (staff_id/role/collector_id) minted at login —
-- see the accompanying prompt doc for the recommended approach.
