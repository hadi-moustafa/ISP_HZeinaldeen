-- Tasks: an optional map link (e.g. a Google Maps share link) for where
-- the job is. Set by the admin; the technician opens it from a pin button.
-- Additive only.

ALTER TABLE tasks ADD COLUMN location_url TEXT;
