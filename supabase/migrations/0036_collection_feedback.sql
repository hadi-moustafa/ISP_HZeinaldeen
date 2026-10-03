-- Collection feedback: a free-text note taken while collecting a payment
-- (in the Pay modal) -- what the subscriber said, a complaint, a problem
-- with the line -- kept for the admin to go through on its own page.
--
--   - Separate from payments.note (which is about the payment itself and
--     is spread across one row per paid line). One feedback per visit.
--   - Can be saved without a payment (subscriber refused / not home) or
--     alongside a postpone.
--   - subscriber_id is SET NULL with a subscriber_name snapshot, same as
--     tasks, so feedback survives a subscriber delete.
--   - reviewed_at / reviewed_by: NULL = still to review.

CREATE TABLE collection_feedback (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id  UUID REFERENCES subscribers(id) ON DELETE SET NULL,
    subscriber_name TEXT NOT NULL,
    feedback       TEXT NOT NULL CHECK (length(trim(feedback)) > 0),
    collector_id   UUID REFERENCES collectors(id) ON DELETE SET NULL,
    staff_id       UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at    TIMESTAMPTZ,
    reviewed_by    UUID REFERENCES staff(id) ON DELETE SET NULL
);
CREATE INDEX idx_collection_feedback_created_at ON collection_feedback(created_at DESC);
CREATE INDEX idx_collection_feedback_subscriber_id ON collection_feedback(subscriber_id);
