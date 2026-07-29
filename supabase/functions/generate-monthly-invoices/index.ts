// Scheduled (via pg_cron, see supabase/migrations for the schedule) to run
// on the 1st of each month. Also callable manually (admin "Generate this
// month's invoices" button) -- safe to re-run since invoices has a
// UNIQUE(subscriber_id, period_month) constraint and we upsert on conflict.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendInvoiceWhatsAppMessage } from '../_shared/whatsapp.ts'

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
    .select('id, name, phone, service_id, services(sell_price)')
    .eq('connection_status', 'active')
    .not('service_id', 'is', null)

  if (subsError) {
    return new Response(JSON.stringify({ error: subsError.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }

  const results = { created: 0, skipped: 0, whatsappSent: 0, whatsappFailed: 0 }

  for (const sub of subscribers ?? []) {
    const service = sub.services as unknown as { sell_price: number } | null
    if (!service) {
      results.skipped++
      continue
    }

    const { data: invoice, error: insertError } = await supabase
      .from('invoices')
      .insert({
        subscriber_id: sub.id,
        service_id: sub.service_id,
        period_month: periodMonth,
        amount_due: service.sell_price,
        due_date: periodMonth,
      })
      .select()
      .single()

    if (insertError) {
      // Unique violation means this subscriber's invoice for this month
      // already exists -- expected on a re-run, not a failure.
      if (insertError.code === '23505') {
        results.skipped++
        continue
      }
      results.skipped++
      continue
    }

    results.created++

    if (sub.phone) {
      const { ok } = await sendInvoiceWhatsAppMessage(sub.phone, {
        subscriberName: sub.name,
        amountDue: String(service.sell_price),
        dueDate: periodMonth,
      })
      if (ok) {
        results.whatsappSent++
        await supabase
          .from('invoices')
          .update({ whatsapp_sent_at: new Date().toISOString() })
          .eq('id', invoice.id)
      } else {
        results.whatsappFailed++
      }
    }
  }

  return new Response(JSON.stringify({ periodMonth, ...results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
