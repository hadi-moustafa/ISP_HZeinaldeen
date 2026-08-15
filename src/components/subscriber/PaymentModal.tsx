import { useEffect, useState, type FormEvent } from 'react'
import {
  createPayment,
  postponeInvoice,
  doubleNextMonthInvoice,
  createPeriodInvoice,
  computeInvoiceAmount,
} from '../../lib/api/invoices'
import { updateSubscriberFields } from '../../lib/api/subscribers'
import { listMonthlyLog } from '../../lib/api/reports'
import { logActivity } from '../../lib/api/activityLog'
import { openWhatsApp, paidMessage, postponedMessage, debtMessage } from '../../lib/whatsapp'
import { round2 } from '../../lib/money'
import { useStaff } from '../../context/StaffContext'
import { Modal } from '../Modal'
import { inputClass, secondaryButtonClass, primaryButtonClass } from '../../lib/uiClasses'
import type { SubscriberWithRelations } from '../../types/subscribers'
import type { MonthlyLogRow } from '../../types/reports'
import type { Collector, ServiceWithCompany } from '../../types/reference'

function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function nextPeriodMonth(period: string) {
  const [y, m] = period.split('-').map(Number)
  const nextM = m === 12 ? 1 : m + 1
  const nextY = m === 12 ? y + 1 : y
  return `${nextY}-${String(nextM).padStart(2, '0')}-01`
}

// The one Paid/Postponed/Debt "Update status" flow in the app -- shared by
// the subscriber list and the dashboard's search/expiring-soon results so
// there's exactly one implementation of payment logic, not two that can
// drift apart (this project has already hit that exact class of bug from
// duplicated logic before).
export function PaymentModal({
  subscriber,
  onClose,
  onChanged,
  services,
  collectors,
  monthlyLog,
}: {
  subscriber: SubscriberWithRelations | null
  onClose: () => void
  onChanged: () => void
  services: ServiceWithCompany[]
  collectors: Collector[]
  monthlyLog: MonthlyLogRow | undefined
}) {
  const { staff } = useStaff()
  const [activeSub, setActiveSub] = useState<SubscriberWithRelations | null>(null)
  const [paymentMode, setPaymentMode] = useState<'paid' | 'postponed' | 'debt'>('paid')
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    method: 'cash',
    collector_id: '',
    note: '',
  })
  const [postponeForm, setPostponeForm] = useState({ new_due_date: '', reason: '' })
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentSaving, setPaymentSaving] = useState(false)

  // Sending the WhatsApp confirmation is an explicit per-action choice --
  // two separate submit buttons (Save / Save & Notify) below decide it.
  // phoneDraft/serviceDraft let staff fill in data missing from the
  // subscriber record (no phone on file, or no service assigned yet,
  // which Debt mode needs) right here instead of leaving the modal to
  // edit the subscriber first.
  const [phoneDraft, setPhoneDraft] = useState('')
  const [serviceDraft, setServiceDraft] = useState('')
  // How much more the current invoice can take -- never lets a logged
  // payment push the total paid past what's actually owed.
  const [paymentRemaining, setPaymentRemaining] = useState(0)

  // Resets the form whenever a *different* subscriber is opened (keyed on
  // id, not the whole object, so the parent re-rendering with a fresh
  // object reference for the same subscriber doesn't clobber in-progress
  // edits). Nothing is written to the DB just from opening -- an invoice
  // only gets created (if missing) at actual submit time, so backing out
  // without confirming anything never leaves behind a real invoice or
  // turns the subscriber red/in-debt for an action that never happened.
  useEffect(() => {
    if (!subscriber) return
    setActiveSub(subscriber)
    setPaymentError(null)
    setPaymentMode('paid')

    const service = subscriber.service_id ? services.find((s) => s.id === subscriber.service_id) : undefined
    const estimate = round2(
      monthlyLog ? Math.max(monthlyLog.amount_due - monthlyLog.amount_paid, 0) : (service?.sell_price ?? 0),
    )
    setPaymentRemaining(estimate)
    // No invoice yet this period -- refine the estimate above (which
    // ignores any custom price/carried-forward shortfall) with the real
    // amount a submit would actually bill, once it resolves.
    if (!monthlyLog && subscriber.service_id) {
      computeInvoiceAmount(subscriber.id, currentPeriodMonth())
        .then((amountDue) => {
          setPaymentRemaining(amountDue)
          setPaymentForm((f) => (f.amount === String(estimate) ? { ...f, amount: String(amountDue) } : f))
        })
        .catch(() => {})
    }
    setPaymentForm({
      amount: estimate ? String(estimate) : '',
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'cash',
      collector_id: subscriber.default_collector_id ?? '',
      note: '',
    })
    setPostponeForm({ new_due_date: subscriber.expiry_date ?? '', reason: '' })
    setPhoneDraft(subscriber.phone ?? '')
    setServiceDraft(subscriber.service_id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriber?.id])

  // Debt amount is anchored to the subscriber's normal monthly rate
  // (services.sell_price), not the current invoice's amount_due, so it
  // stays correct even if this month's invoice was itself already adjusted.
  function debtDoubleAmount(sub: SubscriberWithRelations) {
    const base =
      sub.services?.sell_price ?? services.find((s) => s.id === sub.service_id)?.sell_price ?? monthlyLog?.amount_due ?? 0
    return base * 2
  }

  async function submitPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!activeSub) return
    // Which of the two submit buttons (Save / Save & Notify) triggered this
    // -- both are type="submit" so HTML5 required-field validation still
    // runs no matter which one is clicked, but only "Save & Notify" should
    // open WhatsApp afterward.
    const notify = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'notify'
    setPaymentSaving(true)
    setPaymentError(null)
    try {
      // Fill in whatever was missing and typed into the modal before acting
      // on it -- phone for the WhatsApp send, service for the Debt amount --
      // so the subscriber record itself gets fixed, not just this one action.
      let sub = activeSub
      const patch: { phone?: string | null; service_id?: string; company_id?: string | null } = {}
      const trimmedPhone = phoneDraft.trim()
      if (trimmedPhone !== (sub.phone ?? '')) patch.phone = trimmedPhone || null
      if (paymentMode === 'debt' && !sub.service_id && serviceDraft) {
        const chosen = services.find((s) => s.id === serviceDraft)
        patch.service_id = serviceDraft
        patch.company_id = chosen?.comp_id ?? null
      }
      if (Object.keys(patch).length > 0) {
        const updated = await updateSubscriberFields(sub.id, patch)
        sub = { ...sub, ...updated }
        setActiveSub(sub)
      }

      // The current period's invoice is only ever created here, at the
      // moment an action is actually being committed.
      let log = monthlyLog
      if (!log && (paymentMode === 'paid' || paymentMode === 'postponed') && sub.service_id) {
        const service = services.find((s) => s.id === sub.service_id)
        if (service) {
          const period = currentPeriodMonth()
          await createPeriodInvoice(sub.id, sub.service_id, period)
          const rows = await listMonthlyLog(period)
          log = rows.find((row) => row.subscriber_id === sub.id)
        }
      }

      if (paymentMode === 'paid') {
        // Re-derive from the freshly (re)fetched log rather than trusting
        // paymentRemaining from when the modal opened -- if an invoice was
        // just created above, its real amount_due (custom price +
        // carried-forward shortfall) can differ from that earlier estimate.
        const realRemaining = round2(log ? Math.max(log.amount_due - log.amount_paid, 0) : paymentRemaining)
        if (Number(paymentForm.amount) > realRemaining) {
          throw new Error(`Amount can't exceed what's left on this invoice (${realRemaining.toFixed(2)}).`)
        }
        await createPayment({
          invoice_id: log?.invoice_id ?? null,
          subscriber_id: sub.id,
          collector_id: paymentForm.collector_id || null,
          amount: Number(paymentForm.amount),
          payment_date: paymentForm.payment_date,
          method: paymentForm.method,
          note: paymentForm.note || null,
          staff_id: staff?.id ?? null,
        })
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} logged a payment of ${paymentForm.amount} for subscriber ${sub.name}`,
          'payment',
          sub.id,
        )
        if (notify) openWhatsApp(sub.phone, paidMessage(sub.name))
      } else if (paymentMode === 'postponed') {
        if (!log?.invoice_id) throw new Error('No invoice this period to postpone')
        await postponeInvoice(log.invoice_id, postponeForm.new_due_date, postponeForm.reason || null, staff?.id ?? null)
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} postponed the invoice for subscriber ${sub.name} to ${postponeForm.new_due_date}`,
          'invoice',
          log.invoice_id,
        )
        if (notify) openWhatsApp(sub.phone, postponedMessage(sub.name, postponeForm.new_due_date))
      } else {
        if (!sub.service_id) throw new Error('Subscriber has no service to base the debt amount on -- pick one above')
        const doubled = debtDoubleAmount(sub)
        await doubleNextMonthInvoice(sub.id, sub.service_id, nextPeriodMonth(currentPeriodMonth()), doubled)
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} marked subscriber ${sub.name} as in debt -- next month's payment doubled to ${doubled}`,
          'subscriber',
          sub.id,
        )
        if (notify) openWhatsApp(sub.phone, debtMessage(sub.name, doubled))
      }
      onClose()
      onChanged()
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Failed to update subscriber')
    } finally {
      setPaymentSaving(false)
    }
  }

  return (
    <Modal open={Boolean(subscriber)} onClose={onClose} title={`Update status · ${subscriber?.name ?? ''}`}>
      <form onSubmit={submitPayment}>
        {paymentError && <p className="mb-3 text-sm text-red-600">{paymentError}</p>}

        <div className="mb-4 flex gap-1 rounded-full bg-neutral-100 p-1">
          {(
            [
              { value: 'paid', label: 'Paid', active: 'bg-green-500 text-white' },
              { value: 'postponed', label: 'Postponed', active: 'bg-orange-500 text-white' },
              { value: 'debt', label: 'Debt', active: 'bg-red-500 text-white' },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setPaymentMode(m.value)}
              className={`flex-1 rounded-full py-1.5 text-sm font-medium ${
                paymentMode === m.value ? m.active : 'text-neutral-600'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {paymentMode === 'paid' && (
          <>
            <p className="mb-4 text-xs text-neutral-500">
              Logs the payment, turns this subscriber green, and pushes their expiry a month
              forward so next month is what gets collected next. Use "Save & Notify" below
              to also send a WhatsApp confirmation.
            </p>
            <input
              type="number"
              step="0.01"
              min="0"
              max={paymentRemaining}
              value={paymentForm.amount}
              onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder={`Amount (max ${paymentRemaining.toFixed(2)})`}
              className={`${inputClass} mb-4`}
              required
            />
            <input
              type="date"
              aria-label="Payment date"
              value={paymentForm.payment_date}
              onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))}
              className={`${inputClass} mb-4`}
              required
            />
            <input
              value={paymentForm.method}
              onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}
              placeholder="Method"
              className={`${inputClass} mb-4`}
            />
            <select
              value={paymentForm.collector_id}
              onChange={(e) => setPaymentForm((f) => ({ ...f, collector_id: e.target.value }))}
              className={`${inputClass} mb-4`}
            >
              <option value="">Collector who collected this</option>
              {collectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={paymentForm.note}
              onChange={(e) => setPaymentForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Note"
              className={`${inputClass} mb-4`}
            />
          </>
        )}

        {paymentMode === 'postponed' && (
          <>
            <p className="mb-4 text-xs text-neutral-500">
              Moves this subscriber's expiry to the new date and turns them orange. Use
              "Save & Notify" below to also send a WhatsApp message.
            </p>
            <input
              type="date"
              aria-label="New due date"
              value={postponeForm.new_due_date}
              onChange={(e) => setPostponeForm((f) => ({ ...f, new_due_date: e.target.value }))}
              className={`${inputClass} mb-4`}
              required
            />
            <input
              value={postponeForm.reason}
              onChange={(e) => setPostponeForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Reason"
              className={`${inputClass} mb-4`}
            />
          </>
        )}

        {paymentMode === 'debt' && (
          <>
            {activeSub && !activeSub.service_id ? (
              <>
                <p className="mb-3 text-xs text-amber-600">
                  This subscriber has no service assigned yet, so there's no rate to double.
                  Pick one to use for the debt penalty (saved to the subscriber).
                </p>
                <select
                  value={serviceDraft}
                  onChange={(e) => setServiceDraft(e.target.value)}
                  className={`${inputClass} mb-4`}
                  required
                >
                  <option value="">Select a service…</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="mb-4 text-xs text-neutral-500">
                Turns this subscriber red and sets next month's payment to double
                {activeSub ? ` (${debtDoubleAmount(activeSub)})` : ''} as a late-payment
                penalty. It reverts to the normal amount automatically once that doubled
                invoice is paid. Use "Save & Notify" below to also send a WhatsApp message.
              </p>
            )}
          </>
        )}

        {!activeSub?.phone && (
          <div className="mb-4 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-900">
            <input
              type="tel"
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder='Phone number (missing — add it to enable "Save & Notify")'
              className={inputClass}
            />
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="submit"
            name="intent"
            value="save"
            disabled={paymentSaving}
            className={secondaryButtonClass}
          >
            {paymentSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="submit"
            name="intent"
            value="notify"
            disabled={paymentSaving || (!phoneDraft.trim() && !activeSub?.phone)}
            className={primaryButtonClass}
          >
            {paymentSaving ? 'Saving…' : 'Save & Notify'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
