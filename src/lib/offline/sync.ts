import { supabase } from '../supabase'
import { offlineDB, type CachedInvoice, type CachedSubscriber } from './db'

const CACHE_MONTHS_BACK = 6

function monthsAgoISO(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// Pulls this collector's assigned subscribers + their recent invoices into
// the local IndexedDB mirror. Call whenever online (login, reconnect, or a
// manual refresh) -- never assume it ran, since the app must still work if
// the very first load happens offline.
export async function downloadAssignedData(collectorId: string) {
  const { data: subscribers, error: subsError } = await supabase
    .from('subscribers')
    .select(
      'id, name, phone, connection_status, expiry_date, default_collector_id, services(name, companies(name))',
    )
    .eq('default_collector_id', collectorId)
  if (subsError) throw subsError

  const cachedSubscribers: CachedSubscriber[] = (subscribers ?? []).map((s) => {
    const service = s.services as unknown as {
      name: string
      companies: { name: string } | null
    } | null
    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      connection_status: s.connection_status,
      expiry_date: s.expiry_date,
      service_name: service?.name ?? null,
      company_name: service?.companies?.name ?? null,
      default_collector_id: s.default_collector_id,
    }
  })

  const subscriberIds = cachedSubscribers.map((s) => s.id)
  let cachedInvoices: CachedInvoice[] = []

  if (subscriberIds.length > 0) {
    const { data: invoices, error: invError } = await supabase
      .from('invoices')
      .select('id, subscriber_id, period_month, amount_due, status, due_date, postponed_to')
      .in('subscriber_id', subscriberIds)
      .gte('period_month', monthsAgoISO(CACHE_MONTHS_BACK))
    if (invError) throw invError

    const invoiceIds = (invoices ?? []).map((i) => i.id)
    const { data: payments } = invoiceIds.length
      ? await supabase.from('payments').select('invoice_id, amount').in('invoice_id', invoiceIds)
      : { data: [] as { invoice_id: string; amount: number }[] }

    const paidByInvoice = new Map<string, number>()
    for (const p of payments ?? []) {
      paidByInvoice.set(p.invoice_id!, (paidByInvoice.get(p.invoice_id!) ?? 0) + p.amount)
    }

    cachedInvoices = (invoices ?? []).map((i) => ({
      id: i.id,
      subscriber_id: i.subscriber_id,
      period_month: i.period_month,
      amount_due: i.amount_due,
      amount_paid: paidByInvoice.get(i.id) ?? 0,
      status: i.status,
      due_date: i.due_date,
      postponed_to: i.postponed_to,
    }))
  }

  await offlineDB.transaction('rw', offlineDB.subscribers, offlineDB.invoices, async () => {
    await offlineDB.subscribers.where('default_collector_id').equals(collectorId).delete()
    await offlineDB.subscribers.bulkPut(cachedSubscribers)
    if (cachedInvoices.length > 0) {
      await offlineDB.invoices.bulkPut(cachedInvoices)
    }
  })
}

export interface PaymentPayload {
  id: string
  invoice_id: string | null
  subscriber_id: string
  collector_id: string | null
  amount: number
  payment_date: string
  method: string
  note: string | null
  staff_id: string | null
}

async function applyPaymentToCache(payload: PaymentPayload) {
  if (!payload.invoice_id) return
  const invoice = await offlineDB.invoices.get(payload.invoice_id)
  if (!invoice) return
  const amountPaid = invoice.amount_paid + payload.amount
  await offlineDB.invoices.put({
    ...invoice,
    amount_paid: amountPaid,
    status: amountPaid >= invoice.amount_due ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid',
  })
}

// Writes straight to Supabase when online; queues for later sync when not.
// Either way the local cache is updated optimistically so the field view
// reflects it immediately -- the next downloadAssignedData() reconciles
// with the server's real (trigger-computed) status.
export async function logPayment(payload: PaymentPayload, online: boolean) {
  if (online) {
    const { error } = await supabase.from('payments').insert(payload)
    if (error) throw error
  } else {
    await offlineDB.queue.add({
      type: 'payment',
      payload: payload as unknown as Record<string, unknown>,
      created_at: new Date().toISOString(),
    })
  }
  await applyPaymentToCache(payload)
}

export interface PostponementPayload {
  p_invoice_id: string
  p_new_due_date: string
  p_reason: string | null
  p_staff_id: string | null
}

async function applyPostponementToCache(payload: PostponementPayload) {
  const invoice = await offlineDB.invoices.get(payload.p_invoice_id)
  if (!invoice) return
  await offlineDB.invoices.put({
    ...invoice,
    postponed_to: payload.p_new_due_date,
    status: 'postponed',
  })
  const subscriber = await offlineDB.subscribers.get(invoice.subscriber_id)
  if (subscriber) {
    await offlineDB.subscribers.put({ ...subscriber, expiry_date: payload.p_new_due_date })
  }
}

export async function postponeInvoiceOffline(payload: PostponementPayload, online: boolean) {
  if (online) {
    const { error } = await supabase.rpc('postpone_invoice', payload)
    if (error) throw error
  } else {
    await offlineDB.queue.add({
      type: 'postponement',
      payload: payload as unknown as Record<string, unknown>,
      created_at: new Date().toISOString(),
    })
  }
  await applyPostponementToCache(payload)
}

export async function pendingSyncCount() {
  return offlineDB.queue.count()
}

// Processes the queue in insertion order and stops at the first failure so
// a later item never lands before an earlier one it might depend on.
export async function flushQueue(): Promise<{ synced: number; remaining: number }> {
  const items = await offlineDB.queue.orderBy('id').toArray()
  let synced = 0

  for (const item of items) {
    try {
      if (item.type === 'payment') {
        const { error } = await supabase
          .from('payments')
          .upsert(item.payload, { onConflict: 'id' })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('postpone_invoice', item.payload)
        if (error) throw error
      }
      await offlineDB.queue.delete(item.id!)
      synced++
    } catch {
      break
    }
  }

  return { synced, remaining: await offlineDB.queue.count() }
}
