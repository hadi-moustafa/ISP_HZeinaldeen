import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { listProductStockSummary } from '../../lib/api/products'
import { recordProductSale } from '../../lib/api/productPayments'
import { listSubscribersLite } from '../../lib/api/subscribers'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import type { ProductStockSummary } from '../../types/reference'
import { inputClass, primaryButtonClass, secondaryButtonClass, cardClass } from '../../lib/uiClasses'
import { X } from 'lucide-react'

type CustomerMode = 'subscriber' | 'walkin'

interface CartLine {
  key: string
  productId: string
  quantity: string // for cable: meters used; for bundle: fixed '1'; else: unit count
  totalAmount: string // the actual charge for this line -- see recordProductSale's totalAmount
  amountPaid: string
}

function emptyLine(): CartLine {
  return { key: crypto.randomUUID(), productId: '', quantity: '1', totalAmount: '', amountPaid: '' }
}

function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// The price a fresh line should default to for a product: its active
// (oldest, in-stock) lot's sell price, falling back to the product's own
// "next lot" default when nothing's in stock yet (display estimate only --
// an actual sale with no stock is rejected server-side).
function defaultUnitPrice(product: ProductStockSummary): number {
  return product.active_lot?.sell_price ?? product.sell_price
}

export function ProductSalePage() {
  const { staff } = useStaff()
  const [products, setProducts] = useState<ProductStockSummary[]>([])
  const [subscribers, setSubscribers] = useState<{ id: string; name: string }[]>([])

  const [customerMode, setCustomerMode] = useState<CustomerMode>('subscriber')
  const [subscriberSearch, setSubscriberSearch] = useState('')
  const [selectedSubscriber, setSelectedSubscriber] = useState<{ id: string; name: string } | null>(null)
  const [walkinName, setWalkinName] = useState('')
  const [walkinPhone, setWalkinPhone] = useState('')

  const [cart, setCart] = useState<CartLine[]>([emptyLine()])
  const [date, setDate] = useState(todayLocal())
  const [note, setNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function loadProducts() {
    listProductStockSummary()
      .then((rows) => setProducts(rows.filter((p) => p.is_active)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load products'))
  }

  useEffect(() => {
    loadProducts()
    listSubscribersLite()
      .then(setSubscribers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load subscribers'))
  }, [])

  const subscriberMatches = useMemo(() => {
    const term = subscriberSearch.trim().toLowerCase()
    if (!term) return []
    return subscribers.filter((s) => s.name.toLowerCase().includes(term)).slice(0, 20)
  }, [subscriberSearch, subscribers])

  function updateLine(key: string, patch: Partial<CartLine>) {
    setCart((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function selectProduct(key: string, productId: string) {
    const product = products.find((p) => p.id === productId)
    if (!product) {
      updateLine(key, { productId, quantity: '1', totalAmount: '', amountPaid: '' })
      return
    }
    const price = defaultUnitPrice(product)
    if (product.product_type === 'bundle') {
      updateLine(key, { productId, quantity: '1', totalAmount: String(price), amountPaid: String(price) })
    } else if (product.product_type === 'cable') {
      updateLine(key, { productId, quantity: '', totalAmount: String(price), amountPaid: '' })
    } else {
      updateLine(key, { productId, quantity: '1', totalAmount: String(price), amountPaid: String(price) })
    }
  }

  function updateQuantity(key: string, quantity: string) {
    const line = cart.find((l) => l.key === key)
    const product = line ? products.find((p) => p.id === line.productId) : undefined
    if (product && product.product_type === 'standard') {
      const price = defaultUnitPrice(product)
      const qty = Number(quantity) || 0
      const total = round2(price * qty)
      updateLine(key, { quantity, totalAmount: String(total), amountPaid: String(total) })
    } else {
      updateLine(key, { quantity })
    }
  }

  function round2(n: number) {
    return Math.round(n * 100) / 100
  }

  function addLine() {
    setCart((lines) => [...lines, emptyLine()])
  }

  function removeLine(key: string) {
    setCart((lines) => (lines.length > 1 ? lines.filter((l) => l.key !== key) : lines))
  }

  const cartTotal = cart.reduce((sum, l) => sum + (Number(l.totalAmount) || 0), 0)
  const cartPaid = cart.reduce((sum, l) => sum + (Number(l.amountPaid) || 0), 0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (customerMode === 'subscriber' && !selectedSubscriber) {
      setError('Pick a subscriber, or switch to "Walk-in customer".')
      return
    }
    if (customerMode === 'walkin' && !walkinName.trim()) {
      setError("Enter the walk-in customer's name.")
      return
    }
    const lines = cart.filter((l) => l.productId && (Number(l.quantity) > 0 || products.find((p) => p.id === l.productId)?.product_type === 'bundle'))
    if (lines.length === 0) {
      setError('Add at least one product with a quantity.')
      return
    }

    setSaving(true)
    let succeeded = 0
    try {
      for (const line of lines) {
        const product = products.find((p) => p.id === line.productId)
        await recordProductSale({
          productId: line.productId,
          subscriberId: customerMode === 'subscriber' ? (selectedSubscriber?.id ?? null) : null,
          outsideCustomerName:
            customerMode === 'walkin' ? [walkinName.trim(), walkinPhone.trim()].filter(Boolean).join(' · ') : null,
          staffId: staff?.id ?? null,
          quantity: product?.product_type === 'bundle' ? 1 : Number(line.quantity),
          totalAmount: line.totalAmount ? Number(line.totalAmount) : null,
          amountPaid: Number(line.amountPaid) || 0,
          movementDate: date,
          note: note || null,
        })
        succeeded += 1
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} sold ${product?.product_type === 'cable' ? `${line.quantity}m of` : line.quantity} ${product?.name ?? 'product'} to ${
            customerMode === 'subscriber' ? selectedSubscriber?.name : walkinName.trim()
          }`,
          'product_movement',
          line.productId,
        )
      }
      setSuccess(`Sale logged: ${succeeded} product${succeeded === 1 ? '' : 's'}.`)
      setCart([emptyLine()])
      setNote('')
      setSelectedSubscriber(null)
      setSubscriberSearch('')
      setWalkinName('')
      setWalkinPhone('')
      loadProducts()
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : 'Failed to log sale'} (${succeeded} of ${lines.length} product line${
          lines.length === 1 ? '' : 's'
        } already saved).`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="mb-4 text-sm text-emerald-600 dark:text-emerald-400">{success}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className={cardClass}>
          <p className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">Customer</p>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setCustomerMode('subscriber')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
                customerMode === 'subscriber'
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
              }`}
            >
              Subscriber
            </button>
            <button
              type="button"
              onClick={() => setCustomerMode('walkin')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
                customerMode === 'walkin'
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
              }`}
            >
              Walk-in customer
            </button>
          </div>

          {customerMode === 'subscriber' ? (
            selectedSubscriber ? (
              <div className="flex items-center justify-between rounded-md border border-neutral-300 px-3 py-2.5 dark:border-neutral-600">
                <span className="text-sm text-neutral-900 dark:text-neutral-100">{selectedSubscriber.name}</span>
                <button
                  type="button"
                  onClick={() => setSelectedSubscriber(null)}
                  className="text-neutral-400"
                  aria-label="Change subscriber"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={subscriberSearch}
                  onChange={(e) => setSubscriberSearch(e.target.value)}
                  placeholder="Search subscriber by name…"
                  className={inputClass}
                />
                {subscriberMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                    {subscriberMatches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedSubscriber(s)
                          setSubscriberSearch('')
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-700"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <input
                value={walkinName}
                onChange={(e) => setWalkinName(e.target.value)}
                placeholder="Customer name"
                className={inputClass}
              />
              <input
                value={walkinPhone}
                onChange={(e) => setWalkinPhone(e.target.value)}
                placeholder="Phone (optional)"
                className={inputClass}
              />
            </div>
          )}
        </div>

        <div className={cardClass}>
          <p className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">Products</p>
          <div className="space-y-3">
            {cart.map((line) => {
              const product = products.find((p) => p.id === line.productId)
              return (
                <div key={line.key} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      value={line.productId}
                      onChange={(e) => selectProduct(line.key, e.target.value)}
                      className={`${inputClass} flex-1`}
                    >
                      <option value="">Select a product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.product_type === 'bundle'
                            ? ' (bundle)'
                            : p.product_type === 'cable'
                              ? ` (${p.total_stock} m in stock)`
                              : ` (${p.total_stock} ${p.unit} in stock)`}
                        </option>
                      ))}
                    </select>
                    {cart.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        className="shrink-0 text-neutral-400"
                        aria-label="Remove line"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {product?.product_type === 'bundle' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.totalAmount}
                        onChange={(e) => updateLine(line.key, { totalAmount: e.target.value })}
                        placeholder="Bundle price"
                        className={inputClass}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.amountPaid}
                        onChange={(e) => updateLine(line.key, { amountPaid: e.target.value })}
                        placeholder="Amount paid"
                        className={inputClass}
                      />
                    </div>
                  ) : product?.product_type === 'cable' ? (
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) => updateQuantity(line.key, e.target.value)}
                        placeholder="Meters used"
                        className={inputClass}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.totalAmount}
                        onChange={(e) => updateLine(line.key, { totalAmount: e.target.value })}
                        placeholder="Charge"
                        className={inputClass}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.amountPaid}
                        onChange={(e) => updateLine(line.key, { amountPaid: e.target.value })}
                        placeholder="Amount paid"
                        className={inputClass}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => updateQuantity(line.key, e.target.value)}
                        placeholder="Qty"
                        className={inputClass}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.totalAmount}
                        onChange={(e) => updateLine(line.key, { totalAmount: e.target.value })}
                        placeholder="Line total"
                        className={inputClass}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.amountPaid}
                        onChange={(e) => updateLine(line.key, { amountPaid: e.target.value })}
                        placeholder="Amount paid"
                        className={inputClass}
                      />
                    </div>
                  )}

                  {product?.product_type === 'cable' && (
                    <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                      Billed as one {product.cable_unit_length ?? '?'}m unit at a flat price, regardless of exact meters used.
                    </p>
                  )}
                  {product && product.product_type !== 'bundle' && product.total_stock <= 0 && (
                    <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">No stock available for this product.</p>
                  )}
                </div>
              )
            })}
          </div>
          <button type="button" onClick={addLine} className={`${secondaryButtonClass} mt-3`}>
            + Add another product
          </button>

          <div className="mt-3 flex justify-between border-t border-neutral-200 pt-3 text-sm dark:border-neutral-700">
            <span className="text-neutral-500 dark:text-neutral-400">Total / Paid</span>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {cartTotal.toFixed(2)} / {cartPaid.toFixed(2)}
            </span>
          </div>
        </div>

        <div className={cardClass}>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              aria-label="Sale date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
              required
            />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inputClass} />
          </div>
        </div>

        <button type="submit" disabled={saving} className={primaryButtonClass}>
          {saving ? 'Saving…' : 'Log sale'}
        </button>
      </form>
    </div>
  )
}
