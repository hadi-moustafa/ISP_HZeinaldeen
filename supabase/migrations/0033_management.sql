-- Management: an admin-only work list of subscribers someone is doing
-- hands-on work for (cable fix, switch fix, ...). Built from the subscriber
-- list's multiselect, same way as Dabdabeh, but:
--   - shared between admins (not a personal list per staff member);
--   - each entry has free-text notes and an optional fee collected
--     (management fee etc.) -- no fixed fields, client instruction;
--   - finishing an entry ("Done") keeps the row as history with done_at,
--     instead of deleting it.
-- The fee is informational only: it is not an invoice or payment and does
-- not touch billing / debt / dashboard totals.
-- Adding, saving, finishing and removing are all written to activity_log by
-- the app (application-level, like every other activity log entry).

CREATE TABLE management_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id   UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    notes           TEXT,
    fee             NUMERIC(12,2) CHECK (fee IS NULL OR fee >= 0),
    added_by        UUID REFERENCES staff(id) ON DELETE SET NULL,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    done_by         UUID REFERENCES staff(id) ON DELETE SET NULL,
    done_at         TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_management_items_updated_at BEFORE UPDATE ON management_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A subscriber can be on the open list only once at a time; once done, they
-- can be added again later as a new entry.
CREATE UNIQUE INDEX uq_management_items_open ON management_items(subscriber_id) WHERE done_at IS NULL;
CREATE INDEX idx_management_items_done_at ON management_items(done_at DESC);
