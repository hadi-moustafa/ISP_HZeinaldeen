import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  createPayment,
  postponeInvoice,
  createPeriodInvoice,
  computeInvoiceAmount,
  payDebtFifo,
  applyNextPeriodCredit,
  waiveInvoice,
  setInvoiceAmountDue,
} from '../../lib/api/invoices'
import {
  listOpenSaleMovementsForSubscriber,
  recordProductSalePayment,
  waiveProductMovement,
  applyProductOverpaymentCredit,
  type OpenProductMovement,
} from '../../lib/api/productPayments'
import { listProducts } from '../../lib/api/products'
import { updateSubscriberFields } from '../../lib/api/subscribers'
import { listMonthlyLog } from '../../lib/api/reports'
import { logActivity } from '../../lib/api/activityLog'
import { openWhatsApp, paymentSummaryMessage, useMessageTemplates } from '../../lib/whatsapp'
import { round2 } from '../../lib/money'
import { useStaff } from '../../context/StaffContext'
import { Modal } from '../Modal'
import { inputClass, secondaryButtonClass, primaryButtonClass, dangerButtonClass } from '../../lib/uiClasses'
import { Clock, Plus, X } from 'lucide-react'
import type { SubscriberWithRelations } from '../../types/subscribers'
import type { MonthlyLogRow } from '../../types/reports'
import type { Collector, ServiceWithCompany, Product } from '../../types/reference'

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

function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

type LineKey = 'service' | 'debt' | 'products'
type OverUnderChoice = 'rollover' | 'msama7' | 'skip'

interface NewProductLine {
  key: string
  productId: string
  productName: string
  price: string
}

interface FlaggedLine {
  line: 'service' | 'products'
  kind: 'under' | 'over'
  expected: number
  entered: number
}

const linePaleClass: Record<LineKey, string> = {
  service: 'bg-emerald-200 text-emerald-800',
  debt: 'bg-red-200 text-red-800',
  products: 'bg-amber-200 text-amber-800',
}
const lineVibrantClass: Record<LineKey, string> = {
  service: 'bg-emerald-500 text-white',
  debt: 'bg-red-500 text-white',
  products: 'bg-amber-500 text-white',
}

// The one combined Pay flow in the app -- Service (this period's bill),
// Debt (older unpaid/partial invoices, paid off oldest-first), and
// Products (this subscriber's outstanding product sales, plus newly
// picked ones) can each be independently selected and are all processed
// together on Save. Shared by SubscribersListPage/DashboardPage/
// DabdabehPage so there's exactly one implementation of payment logic.
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
  const templates = useMessageTemplates()
  const [activeSub, setActiveSub] = useState<SubscriberWithRelations | null>(null)

  const [selectedLines, setSelectedLines] = useState<Set<LineKey>>(new Set())

  const [serviceAmount, setServiceAmount] = useState('')
  const [serviceExpected, setServiceExpected] = useState(0)
  const [servicePriceToggle, setServicePriceToggle] = useState(false)

  const [debtAmount, setDebtAmount] = useState('')

  const [openProducts, setOpenProducts] = useState<OpenProductMovement[]>([])
  const [newProductLines, setNewProductLines] = useState<NewProductLine[]>([])
  const [productsAmount, setProductsAmount] = useState('')
  const [productsTouched, setProductsTouched] = useState(false)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const [date, setDate] = useState(todayLocal())
  const [notes, setNotes] = useState('')
  const [method, setMethod] = useState<'cash' | 'whish'>('cash')
  const [collectorId, setCollectorId] = useState('')

  const [postponeOpen, setPostponeOpen] = useState(false)
  const [postponeDays, setPostponeDays] = useState('')
  const [postponing, setPostponing] = useState(false)

  const [phoneDraft, setPhoneDraft] = useState('')

  const [flaggedLines, setFlaggedLines] = useState<FlaggedLine[] | null>(null)
  const [flagChoices, setFlagChoices] = useState<Record<string, OverUnderChoice>>({})

  const [lineDone, setLineDone] = useState<Set<LineKey>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existingProductsTotal = useMemo(
    () => round2(openProducts.reduce((sum, m) => sum + ((m.unit_price ?? 0) * Math.abs(m.quantity) - m.amount_paid), 0)),
    [openProducts],
  )
  const newProductsTotal = useMemo(
    () => round2(newProductLines.reduce((sum, l) => sum + (Number(l.price) || 0), 0)),
    [newProductLines],
  )
  const productsExpected = round2(existingProductsTotal + newProductsTotal)

  // Reset the whole form whenever a *different* subscriber is opened, and
  // load everything this modal needs to know about them fresh -- nothing
  // is written to the DB just from opening.
  useEffect(() => {
    if (!subscriber) return
    setActiveSub(subscriber)
    setError(null)
    setSelectedLines(new Set())
    setLineDone(new Set())
    setFlaggedLines(null)
    setFlagChoices({})
    setServicePriceToggle(false)
    setDate(todayLocal())
    setNotes('')
    setMethod('cash')
    setCollectorId(subscriber.default_collector_id ?? '')
    setPostponeOpen(false)
    setPostponeDays('')
    setPickerOpen(false)
    setPhoneDraft(subscriber.phone ?? '')
    setNewProductLines([])
    setProductsTouched(false)
    setDebtAmount(subscriber.debt ? String(round2(subscriber.debt)) : '')

    const service = subscriber.service_id ? services.find((s) => s.id === subscriber.service_id) : undefined
    const estimate = round2(
      monthlyLog ? Math.max(monthlyLog.amount_due - monthlyLog.amount_paid, 0) : (service?.sell_price ?? 0),
    )
    setServiceExpected(estimate)
    setServiceAmount(estimate ? String(estimate) : '')
    if (!monthlyLog && subscriber.service_id) {
      computeInvoiceAmount(subscriber.id, currentPeriodMonth())
        .then((amountDue) => {
          setServiceExpected(amountDue)
          setServiceAmount((prev) => (prev === String(estimate) ? String(amountDue) : prev))
        })
        .catch(() => {})
    }

    listOpenSaleMovementsForSubscriber(subscriber.id)
      .then(setOpenProducts)
      .catch(() => setOpenProducts([]))
    listProducts()
      .then((rows) => setAllProducts(rows.filter((p) => p.is_active)))
      .catch(() => setAllProducts([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriber?.id])

  // Keep the Products aggregate in sync with existing+newly-picked lines
  // unless the staff has manually typed into it -- same "touched" pattern
  // used elsewhere in this app for a value that auto-follows another until
  // it's deliberately overridden.
  useEffect(() => {
    if (!productsTouched) setProductsAmount(productsExpected ? String(productsExpected) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingProductsTotal, newProductsTotal])

  function toggleLine(line: LineKey) {
    setSelectedLines((prev) => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  function addProduct(product: Product) {
    setNewProductLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), productId: product.id, productName: product.name, price: String(product.sell_price) },
    ])
    setPickerOpen(false)
    setSelectedLines((prev) => new Set(prev).add('products'))
  }

  function removeNewProductLine(key: string) {
    setNewProductLines((prev) => prev.filter((l) => l.key !== key))
  }

  // Days-from-now postpone, independent of whichever Service/Debt/Products
  // lines are (or aren't) selected -- mirrors DashboardPage's
  // handleQuickPostpone day-arithmetic (local getters only, never
  // toISOString, to avoid rolling the date back a day east of UTC).
  async function handlePostpone() {
    if (!activeSub) return
    const days = Number(postponeDays)
    if (!Number.isFinite(days) || days <= 0) {
      setError('Enter a whole number of days greater than 0 to postpone.')
      return
    }
    setPostponing(true)
    setError(null)
    try {
      let log = monthlyLog
      if (!log && activeSub.service_id) {
        const period = currentPeriodMonth()
        await createPeriodInvoice(activeSub.id, activeSub.service_id, period)
        const rows = await listMonthlyLog(period)
        log = rows.find((row) => row.subscriber_id === activeSub.id)
      }
      if (!log?.invoice_id) {
        setError('This subscriber has no billable invoice to postpone.')
        return
      }
      const base = log.due_date ? new Date(`${log.due_date}T00:00:00`) : new Date()
      base.setDate(base.getDate() + days)
      const y = base.getFullYear()
      const m = String(base.getMonth() + 1).padStart(2, '0')
      const d = String(base.getDate()).padStart(2, '0')
      const newDueDate = `${y}-${m}-${d}`
      await postponeInvoice(log.invoice_id, newDueDate, `Postponed ${days} day(s) from the Pay modal`, staff?.id ?? null)
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} postponed subscriber ${activeSub.name}'s payment by ${days} day(s)`,
        'invoice',
        log.invoice_id,
      )
      onClose()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to postpone')
    } finally {
      setPostponing(false)
    }
  }

  function buildFlags(): FlaggedLine[] {
    const flags: FlaggedLine[] = []
    // Setting a new permanent price re-bases this period's bill to the
    // entered amount instead of comparing it against the old price, so
    // there's no under/over-payment to reconcile -- see processServiceLine.
    if (selectedLines.has('service') && !servicePriceToggle) {
      const entered = round2(Number(serviceAmount) || 0)
      if (entered < serviceExpected) flags.push({ line: 'service', kind: 'under', expected: serviceExpected, entered })
      else if (entered > serviceExpected) flags.push({ line: 'service', kind: 'over', expected: serviceExpected, entered })
    }
    if (selectedLines.has('products') && (existingProductsTotal > 0 || newProductLines.length > 0)) {
      const entered = round2(Number(productsAmount) || 0)
      if (entered < productsExpected) flags.push({ line: 'products', kind: 'under', expected: productsExpected, entered })
      else if (entered > productsExpected)
        flags.push({ line: 'products', kind: 'over', expected: productsExpected, entered })
    }
    return flags
  }

  function handleSaveClick(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (selectedLines.size === 0) {
      setError('Select at least one of Service, Debt, or Products to pay.')
      return
    }
    const notify = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'notify'
    if (!flaggedLines) {
      const flags = buildFlags()
      if (flags.length > 0) {
        setFlaggedLines(flags)
        setFlagChoices(Object.fromEntries(flags.map((f) => [f.line, f.kind === 'under' ? 'rollover' : 'skip'])))
        return
      }
    }
    void runSave(notify)
  }

  async function runSave(notify: boolean) {
    if (!activeSub) return
    setSaving(true)
    setError(null)
    const summaryLines: string[] = []
    const succeeded = new Set<LineKey>()
    let firstError: string | null = null

    try {
      let sub = activeSub
      const trimmedPhone = phoneDraft.trim()
      if (trimmedPhone !== (sub.phone ?? '')) {
        const updated = await updateSubscriberFields(sub.id, { phone: trimmedPhone || null })
        sub = { ...sub, ...updated }
        setActiveSub(sub)
      }

      if (selectedLines.has('service') && !lineDone.has('service')) {
        try {
          await processServiceLine(sub)
          succeeded.add('service')
          summaryLines.push(`Service: ${serviceAmount}`)
        } catch (err) {
          firstError = err instanceof Error ? err.message : 'Failed to process the Service payment'
        }
      }

      if (selectedLines.has('debt') && !lineDone.has('debt')) {
        try {
          const applied = await payDebtFifo({
            subscriberId: sub.id,
            amount: round2(Number(debtAmount) || 0),
            paymentDate: date,
            method,
            note: notes || null,
            collectorId: collectorId || null,
            staffId: staff?.id ?? null,
          })
          logActivity(
            staff?.id ?? null,
            `${staff?.username ?? 'Someone'} paid ${applied} of subscriber ${sub.name}'s debt`,
            'payment',
            sub.id,
          )
          summaryLines.push(`Debt: ${applied}`)
          succeeded.add('debt')
        } catch (err) {
          firstError = firstError ?? (err instanceof Error ? err.message : 'Failed to process the Debt payment')
        }
      }

      if (selectedLines.has('products') && !lineDone.has('products')) {
        try {
          await processProductsLine(sub)
          succeeded.add('products')
          const names = newProductLines.map((l) => l.productName)
          summaryLines.push(`Products${names.length ? ` (${names.join(', ')})` : ''}: ${productsAmount}`)
        } catch (err) {
          firstError = firstError ?? (err instanceof Error ? err.message : 'Failed to process the Products payment')
        }
      }

      const newDone = new Set([...lineDone, ...succeeded])
      setLineDone(newDone)

      if (firstError) {
        setSelectedLines(new Set([...selectedLines].filter((l) => !succeeded.has(l))))
        setFlaggedLines(null)
        setError(`${firstError} -- lines already saved won't be repeated; fix and retry the rest.`)
        onChanged()
        return
      }

      if (notify && summaryLines.length > 0) {
        openWhatsApp(sub.phone, paymentSummaryMessage(sub.name, summaryLines, templates.payment_summary))
      }
      onClose()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subscriber')
    } finally {
      setSaving(false)
    }
  }

  async function processServiceLine(sub: SubscriberWithRelations) {
    if (!sub.service_id) throw new Error('This subscriber has no service assigned to bill against.')
    const period = currentPeriodMonth()
    const invoiceId = await createPeriodInvoice(sub.id, sub.service_id, period)
    let realInvoiceId = invoiceId
    if (!realInvoiceId) {
      const rows = await listMonthlyLog(period)
      realInvoiceId = rows.find((r) => r.subscriber_id === sub.id)?.invoice_id ?? null
    }
    if (!realInvoiceId) throw new Error('Could not resolve this period\'s invoice')

    const entered = round2(Number(serviceAmount) || 0)

    if (servicePriceToggle) {
      // The entered amount becomes this period's whole bill, full stop --
      // no comparison against the old price, no shortfall, no debt, no
      // rollover to next month. Re-base amount_due first so paying
      // `entered` in full lands the invoice on 'paid', not 'partial'.
      await setInvoiceAmountDue(realInvoiceId, entered)
      if (entered > 0) {
        await createPayment({
          invoice_id: realInvoiceId,
          subscriber_id: sub.id,
          collector_id: collectorId || null,
          amount: entered,
          payment_date: date,
          method,
          note: notes || null,
          staff_id: staff?.id ?? null,
        })
      }
      await updateSubscriberFields(sub.id, { price: entered })
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} logged a service payment of ${entered} for subscriber ${sub.name} and set it as their permanent price`,
        'payment',
        sub.id,
      )
      return
    }

    const choice = flagChoices.service
    const capped = Math.min(entered, serviceExpected)

    if (entered > serviceExpected && choice === 'skip') {
      // Overpay declined -- don't process this line at all.
      return
    }

    if (capped > 0) {
      await createPayment({
        invoice_id: realInvoiceId,
        subscriber_id: sub.id,
        collector_id: collectorId || null,
        amount: capped,
        payment_date: date,
        method,
        note: notes || null,
        staff_id: staff?.id ?? null,
      })
    }

    if (entered < serviceExpected && choice === 'msama7') {
      await waiveInvoice(realInvoiceId)
    } else if (entered > serviceExpected && choice === 'rollover') {
      const excess = round2(entered - serviceExpected)
      const nextPeriod = nextPeriodMonth(period)
      await applyNextPeriodCredit(sub.id, sub.service_id, nextPeriod, excess)
    }

    logActivity(
      staff?.id ?? null,
      `${staff?.username ?? 'Someone'} logged a service payment of ${entered} for subscriber ${sub.name}`,
      'payment',
      sub.id,
    )
  }

  async function processProductsLine(sub: SubscriberWithRelations) {
    const entered = round2(Number(productsAmount) || 0)
    const choice = flagChoices.products

    if (entered > productsExpected && choice === 'skip') {
      return
    }

    // Log any newly-picked products first, each at its own edited price --
    // the price entered on a fresh pick already IS the (possibly
    // discounted) amount, no separate confirmation needed for those.
    for (const line of newProductLines) {
      const price = round2(Number(line.price) || 0)
      await recordProductSalePayment({
        productId: line.productId,
        subscriberId: sub.id,
        staffId: staff?.id ?? null,
        unitPrice: price,
        amountPaid: price,
        movementDate: date,
        note: notes || null,
      })
    }

    // Apply whatever was actually entered across the *existing* outstanding
    // lines (oldest first) -- capped at what's really owed, deficit/excess
    // handled by the flagged choice.
    const capped = Math.min(entered, existingProductsTotal)
    if (capped > 0) {
      await applyProductOverpaymentCredit(sub.id, capped)
      // applyProductOverpaymentCredit is FIFO-generic (also used for
      // excess credit below), reused here to settle existing balances --
      // it only ever increases amount_paid, never overshoots a line.
    }

    if (existingProductsTotal > 0 && entered < existingProductsTotal && choice === 'msama7') {
      for (const m of openProducts) {
        await waiveProductMovement(m.id)
      }
    } else if (entered > productsExpected && choice === 'rollover') {
      const excess = round2(entered - productsExpected)
      await applyProductOverpaymentCredit(sub.id, excess)
    }

    logActivity(
      staff?.id ?? null,
      `${staff?.username ?? 'Someone'} logged a products payment of ${entered} for subscriber ${sub.name}`,
      'payment',
      sub.id,
    )
  }

  const canNotify = Boolean(phoneDraft.trim() || activeSub?.phone)

  return (
    <Modal open={Boolean(subscriber)} onClose={onClose} title={`Pay · ${subscriber?.name ?? ''}`}>
      {pickerOpen ? (
        <div>
          <div className="mb-3 max-h-96 space-y-1 overflow-y-auto">
            {allProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p)}
                className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm hover:bg-neutral-50"
              >
                <span className="text-neutral-800">{p.name}</span>
                <span className="text-neutral-500">{p.sell_price.toFixed(2)}</span>
              </button>
            ))}
            {allProducts.length === 0 && <p className="p-3 text-sm text-neutral-500">No products found.</p>}
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => setPickerOpen(false)} className={secondaryButtonClass}>
              Back
            </button>
          </div>
        </div>
      ) : flaggedLines ? (
        <div>
          <p className="mb-4 text-sm text-neutral-600">
            Some amounts don't match what's normally owed -- choose how to handle each before saving.
          </p>
          <div className="mb-4 space-y-4">
            {flaggedLines.map((f) => (
              <div key={f.line} className="rounded-xl bg-neutral-50 p-3">
                <p className="mb-2 text-sm font-medium text-neutral-800">
                  {f.line === 'service' ? 'Service' : 'Products'}: entered {f.entered.toFixed(2)}, normally{' '}
                  {f.expected.toFixed(2)} ({f.kind === 'under' ? 'short' : 'over'} by{' '}
                  {Math.abs(round2(f.entered - f.expected)).toFixed(2)})
                </p>
                <div className="flex flex-wrap gap-2">
                  {f.kind === 'under' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setFlagChoices((c) => ({ ...c, [f.line]: 'rollover' }))}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          flagChoices[f.line] === 'rollover' ? 'bg-blue-500 text-white' : 'bg-white text-neutral-700'
                        }`}
                      >
                        Add rest to next month
                      </button>
                      <button
                        type="button"
                        onClick={() => setFlagChoices((c) => ({ ...c, [f.line]: 'msama7' }))}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          flagChoices[f.line] === 'msama7' ? 'bg-blue-500 text-white' : 'bg-white text-neutral-700'
                        }`}
                      >
                        Msama7 (forgive)
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setFlagChoices((c) => ({ ...c, [f.line]: 'rollover' }))}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          flagChoices[f.line] === 'rollover' ? 'bg-blue-500 text-white' : 'bg-white text-neutral-700'
                        }`}
                      >
                        Deduct excess from next month
                      </button>
                      <button
                        type="button"
                        onClick={() => setFlagChoices((c) => ({ ...c, [f.line]: 'skip' }))}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          flagChoices[f.line] === 'skip' ? 'bg-blue-500 text-white' : 'bg-white text-neutral-700'
                        }`}
                      >
                        Don't process
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setFlaggedLines(null)} className={secondaryButtonClass}>
              Back
            </button>
            <button type="button" onClick={() => void runSave(false)} className={primaryButtonClass} disabled={saving}>
              {saving ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveClick}>
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          {/* Service */}
          <div className="mb-3 flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm font-medium text-neutral-700">Service</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={serviceAmount}
              onChange={(e) => setServiceAmount(e.target.value)}
              placeholder="Amount"
              disabled={!activeSub?.service_id || lineDone.has('service')}
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => toggleLine('service')}
              disabled={!activeSub?.service_id || lineDone.has('service')}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                selectedLines.has('service') ? lineVibrantClass.service : linePaleClass.service
              }`}
            >
              {lineDone.has('service') ? '✓' : 'Pay'}
            </button>
          </div>
          <label className="mb-4 flex items-center gap-2 pl-16 text-xs text-neutral-500">
            <input
              type="checkbox"
              checked={servicePriceToggle}
              onChange={(e) => setServicePriceToggle(e.target.checked)}
              disabled={!activeSub?.service_id}
            />
            Make this this subscriber's new permanent price for this service
          </label>
          {!activeSub?.service_id && (
            <p className="-mt-3 mb-4 pl-16 text-xs text-amber-600">No service assigned -- edit the subscriber first.</p>
          )}

          {/* Debt */}
          <div className="mb-4 flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm font-medium text-neutral-700">Debt</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={debtAmount}
              onChange={(e) => setDebtAmount(e.target.value)}
              placeholder="Amount"
              disabled={!activeSub?.debt || lineDone.has('debt')}
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => toggleLine('debt')}
              disabled={!activeSub?.debt || lineDone.has('debt')}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                selectedLines.has('debt') ? lineVibrantClass.debt : linePaleClass.debt
              }`}
            >
              {lineDone.has('debt') ? '✓' : 'Pay'}
            </button>
          </div>

          {/* Products */}
          <div className="mb-2 flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm font-medium text-neutral-700">Products</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={productsAmount}
              onChange={(e) => {
                setProductsTouched(true)
                setProductsAmount(e.target.value)
              }}
              placeholder="Amount"
              disabled={lineDone.has('products')}
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => toggleLine('products')}
              disabled={(existingProductsTotal <= 0 && newProductLines.length === 0) || lineDone.has('products')}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                selectedLines.has('products') ? lineVibrantClass.products : linePaleClass.products
              }`}
            >
              {lineDone.has('products') ? '✓' : 'Pay'}
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              title="Add a product"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600"
            >
              <Plus size={16} />
            </button>
          </div>

          {(openProducts.length > 0 || newProductLines.length > 0) && (
            <div className="mb-4 space-y-1.5 pl-16">
              {openProducts.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-xs text-neutral-500">
                  <span className="truncate">{m.products?.name ?? 'Product'} (outstanding)</span>
                  <span>{((m.unit_price ?? 0) * Math.abs(m.quantity) - m.amount_paid).toFixed(2)}</span>
                </div>
              ))}
              {newProductLines.map((l) => (
                <div key={l.key} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate text-neutral-600">{l.productName}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.price}
                    onChange={(e) =>
                      setNewProductLines((prev) =>
                        prev.map((p) => (p.key === l.key ? { ...p, price: e.target.value } : p)),
                      )
                    }
                    className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  />
                  <button type="button" onClick={() => removeNewProductLine(l.key)} className="text-neutral-400">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <input
            type="date"
            aria-label="Payment date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${inputClass} mb-4`}
            required
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className={`${inputClass} mb-4`}
          />
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as 'cash' | 'whish')}
            className={`${inputClass} mb-4`}
          >
            <option value="cash">Cash</option>
            <option value="whish">Whish</option>
          </select>
          <select
            value={collectorId}
            onChange={(e) => setCollectorId(e.target.value)}
            className={`${inputClass} mb-4`}
          >
            <option value="">Collector who collected this</option>
            {collectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {!activeSub?.phone && (
            <div className="mb-4 rounded-xl bg-neutral-50 p-3">
              <input
                type="tel"
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder='Phone number (missing — add it to enable "Save & Notify")'
                className={inputClass}
              />
            </div>
          )}

          <div className="mb-4 rounded-xl bg-neutral-50 p-3">
            <button
              type="button"
              onClick={() => setPostponeOpen((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-neutral-700"
            >
              <Clock size={16} />
              Postpone this payment
            </button>
            {postponeOpen && (
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  min="1"
                  value={postponeDays}
                  onChange={(e) => setPostponeDays(e.target.value)}
                  placeholder="Days"
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  onClick={handlePostpone}
                  disabled={postponing}
                  className={dangerButtonClass}
                >
                  {postponing ? 'Postponing…' : 'Postpone'}
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" name="intent" value="save" disabled={saving} className={secondaryButtonClass}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="submit"
              name="intent"
              value="notify"
              disabled={saving || !canNotify}
              className={primaryButtonClass}
            >
              {saving ? 'Saving…' : 'Save & Notify'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
