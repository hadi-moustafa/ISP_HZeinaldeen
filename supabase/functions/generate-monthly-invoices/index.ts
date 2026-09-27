// Kept for anything still invoking it over HTTP. Billing itself now runs
// inside Postgres -- generate_period_invoices() (0030_billing_integrity.sql),
// scheduled nightly by the `billing-daily` pg_cron job and called directly
// by the dashboard's "Generate" button -- so this function just calls that
// same function and can never compute anything differently.
//
// It used to loop over every subscriber here, one RPC each, behind a pg_net
// call with a 5s timeout; that timed out on its first real run.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data, error } = await supabase.rpc('generate_period_invoices', {
    p_period_month: null,
    p_source: 'edge-function',
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
