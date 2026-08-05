-- Client no longer wants per-company addresses (same "one line, no need for
-- details" simplification already applied to subscribers in
-- 0011_address_region_nationality.sql) -- drop company_addresses entirely.
-- Add two simple contact numbers directly on companies instead: no need
-- for a separate table for just two phone fields.
ALTER TABLE companies
  ADD COLUMN payment_phone TEXT,
  ADD COLUMN support_phone TEXT;

DROP TABLE company_addresses;
