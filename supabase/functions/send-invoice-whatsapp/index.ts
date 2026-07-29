// Manual (re)send of a single invoice's WhatsApp notice -- called from the
// app, e.g. after correcting a subscriber's phone number, or if the
// scheduled send failed.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendInvoiceWhatsAppMessage } from '../_shared/whatsapp.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const { invoiceId } = await req.json().catch(() => ({ invoiceId: null }))
  if (!invoiceId) {
    return new Response(JSON.stringify({ error: 'invoiceId is required' }), {
      status: 400,
      headers: corsHeaders,
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, amount_due, due_date, subscribers(name, phone)')
    .eq('id', invoiceId)
    .single()

  if (error || !invoice) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Invoice not found' }), {
      status: 404,
      headers: corsHeaders,
    })
  }

  const subscriber = invoice.subscribers as unknown as { name: string; phone: string | null }
  if (!subscriber?.phone) {
    return new Response(JSON.stringify({ error: 'Subscriber has no phone number on file' }), {
      status: 400,
      headers: corsHeaders,
    })
  }

  const { ok, error: sendError } = await sendInvoiceWhatsAppMessage(subscriber.phone, {
    subscriberName: subscriber.name,
    amountDue: String(invoice.amount_due),
    dueDate: invoice.due_date ?? '',
  })

  if (!ok) {
    return new Response(JSON.stringify({ error: sendError }), {
      status: 502,
      headers: corsHeaders,
    })
  }

  await supabase
    .from('invoices')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', invoiceId)

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
