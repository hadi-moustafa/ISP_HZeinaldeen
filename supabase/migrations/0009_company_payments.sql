-- Tracks what the ISP pays each upstream company (reseller), separate from
-- what subscribers pay the ISP (that's `payments`/`invoices`). "Total owed"
-- to a company is the sum of `services.paid_price` (what the ISP pays the
-- company per subscriber, distinct from sell_price which the subscriber
-- pays) across subscribers currently on that company's services.
--
-- Judgment call: only 'active' subscribers count toward what's owed, same
-- as invoice generation already skips suspended/cancelled subscribers --
-- the company shouldn't be owed for a connection the ISP isn't billing for.
CREATE TABLE company_payments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comp_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    amount        DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
    payment_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    note          TEXT,
    staff_id      UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_company_payments_comp_id ON company_payments(comp_id);
CREATE INDEX idx_company_payments_payment_date ON company_payments(payment_date);

CREATE OR REPLACE VIEW company_dues AS
SELECT
  c.id AS comp_id,
  c.name AS company_name,
  COALESCE(SUM(s.paid_price) FILTER (WHERE sub.connection_status = 'active'), 0) AS total_owed,
  COALESCE((SELECT SUM(cp.amount) FROM company_payments cp WHERE cp.comp_id = c.id), 0) AS total_paid
FROM companies c
LEFT JOIN services s ON s.comp_id = c.id
LEFT JOIN subscribers sub ON sub.service_id = s.id
GROUP BY c.id, c.name;
