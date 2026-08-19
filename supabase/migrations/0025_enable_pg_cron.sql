-- Prerequisite for scheduling generate-monthly-invoices automatically
-- (supabase/ops/schedule_invoice_cron.sql). Just the extensions -- no
-- secrets here, so this can be a normal committed migration. The actual
-- cron.schedule(...) call still has to be run manually in the SQL Editor
-- with the project's service role key, which must never be committed.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
