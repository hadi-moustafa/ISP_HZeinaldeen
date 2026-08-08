// Scheduled (via pg_cron, see supabase/ops/schedule_invoice_cron.sql) to run
// on the 1st of each month. Also callable manually (admin "Generate this
// month's invoices" button) -- safe to re-run since invoices has a
// UNIQUE(subscriber_id, period_month) constraint and duplicate inserts are
// simply skipped.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const now = new Date()
  const periodMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`

  const { data: subscribers, error: subsError } = await supabase
    .from('subscribers')
    .select('id, service_id')
    .eq('connection_status', 'active')
    .not('service_id', 'is', null)

  if (subsError) {
    return new Response(JSON.stringify({ error: subsError.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }

  const results = { created: 0, skipped: 0 }

  for (const sub of subscribers ?? []) {
    // create_period_invoice() (0017_billing_engine_fix.sql) is the single
    // source of truth for billing a period: computes the amount (custom
    // price override if set, else the service's sell_price, plus one
    // period's carried-forward shortfall if last period was left
    // unpaid/partial), closes out whatever invoice that shortfall came
    // from so it isn't double-counted as debt, and inserts the new invoice
    // -- all atomically. Both this cron and any on-demand invoice creation
    // in the app call the same function so the two can never drift apart.
    // Its own ON CONFLICT DO NOTHING makes a re-run for an existing
    // period a no-op, same as the old plain insert's 23505 handling did.
    const { data: invoiceId, error: rpcError } = await supabase.rpc('create_period_invoice', {
      p_subscriber_id: sub.id,
      p_service_id: sub.service_id,
      p_period_month: periodMonth,
    })

    if (rpcError || !invoiceId) {
      results.skipped++
      continue
    }

    results.created++
  }

  return new Response(JSON.stringify({ periodMonth, ...results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
