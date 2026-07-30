-- Admin-facing "history of everything" log. Application-level (not DB
-- triggers): triggers can't identify which staff member performed an
-- action since this app uses a custom `staff` table, not Supabase Auth, so
-- there's no session identity available inside Postgres. Every mutating
-- lib/api/*.ts call site logs a plain-English summary here after success.
CREATE TABLE activity_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id    UUID REFERENCES staff(id) ON DELETE SET NULL,
    summary     TEXT NOT NULL, -- e.g. "Hadi logged a payment of $50 for subscriber Ahmad Khalil"
    entity_type TEXT,          -- e.g. 'subscriber', 'payment', 'invoice', 'company', ...
    entity_id   UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX idx_activity_log_entity ON activity_log(entity_type, entity_id);
