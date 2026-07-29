-- One-time setup, run manually in the SQL Editor after the
-- generate-monthly-invoices Edge Function is deployed. Not an auto-applied
-- migration because it embeds your service role key, which must never be
-- committed to the repo -- copy it from Project Settings > API first.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'generate-monthly-invoices',
  '0 3 1 * *', -- 03:00 UTC on the 1st of every month
  $$
  SELECT net.http_post(
    url := 'https://keivdjxabhvdaagrcbtg.supabase.co/functions/v1/generate-monthly-invoices',
    headers := jsonb_build_object(
      'Authorization', 'Bearer REPLACE_WITH_YOUR_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check it's registered:
-- SELECT * FROM cron.job;
-- To remove it later:
-- SELECT cron.unschedule('generate-monthly-invoices');
