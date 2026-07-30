import { useEffect, useState, type FormEvent } from 'react'
import { listProducts, createProduct, updateProduct, deleteProduct } from '../../lib/api/products'
import {
  listMovementsForProduct,
  createMovement,
  updateMovementPaymentStatus,
} from '../../lib/api/movements'
import { listSubscribersLite } from '../../lib/api/subscribers'
import { logActivity } from '../../lib/api/activityLog'
import type { Product } from '../../types/reference'
import type { MovementPaymentStatus, MovementType, ProductMovementWithSubscriber } from '../../types/movements'
import { useStaff } from '../../context/StaffContext'
import { Modal } from '../../components/Modal'
import { exportToExcel } from '../../lib/exportExcel'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
  cardClass,
} from '../../lib/uiClasses'

const emptyForm = {
  sku: '',
  name: '',
  category: '',
  cost_price: '',
  sell_price: '',
  reorder_level: '0',
  unit: 'pcs',
  is_active: true,
}

const movementTypeLabels: Record<MovementType, string> = {
  restock: 'Restock (+)',
  sale: 'Sale (-)',
  return: 'Return (+)',
  adjustment: 'Adjustment (+/-)',
}

const emptyMovementForm = {
  movement_type: 'restock' as MovementType,
  quantity: '',
  unit_price: '',
  subscriber_id: '',
  note: '',
  movement_date: new Date().toISOString().slice(0, 10),
  payment_status: 'unpaid' as MovementPaymentStatus,
}

const paymentStatusClass: Record<MovementPaymentStatus, string> = {
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  partial: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}

const paymentStatusLabel: Record<MovementPaymentStatus, string> = {
  paid: 'Paid',
  partial: 'Partial',
  unpaid: 'Unpaid',
}

export function ProductsPage() {
  const { staff } = useStaff()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState(emptyForm)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [movements, setMovements] = useState<Record<string, ProductMovementWithSubscriber[]>>({})
  const [subscribers, setSubscribers] = useState<{ id: string; name: string }[]>([])

  const [movementModalProduct, setMovementModalProduct] = useState<Product | null>(null)
  const [movementForm, setMovementForm] = useState(emptyMovementForm)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setProducts(await listProducts())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    listSubscribersLite()
      .then(setSubscribers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load subscribers'))
  }, [])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(product: Product) {
    setEditing(product)
    setForm({
      sku: product.sku ?? '',
      name: product.name,
      category: product.category ?? '',
      cost_price: String(product.cost_price),
      sell_price: String(product.sell_price),
      reorder_level: String(product.reorder_level),
      unit: product.unit,
      is_active: product.is_active,
    })
    setModalOpen(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = {
      sku: form.sku || null,
      name: form.name,
      category: form.category || null,
      cost_price: Number(form.cost_price),
      sell_price: Number(form.sell_price),
      reorder_level: Number(form.reorder_level),
      unit: form.unit,
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await updateProduct(editing.id, input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited product ${input.name}`, 'product', editing.id)
      } else {
        const created = await createProduct(input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created product ${input.name}`, 'product', created.id)
      }
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product')
    }
  }

  async function remove(product: Product) {
    if (!confirm(`Delete product "${product.name}"? This fails if it has stock movements.`))
      return
    try {
      await deleteProduct(product.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted product ${product.name}`, 'product', product.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete product')
    }
  }

  async function toggleExpand(productId: string) {
    if (expandedId === productId) {
      setExpandedId(null)
      return
    }
    setExpandedId(productId)
    if (!movements[productId]) {
      try {
        const rows = await listMovementsForProduct(productId)
        setMovements((prev) => ({ ...prev, [productId]: rows }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load movements')
      }
    }
  }

  async function changePaymentStatus(productId: string, movement: ProductMovementWithSubscriber, status: MovementPaymentStatus) {
    try {
      await updateMovementPaymentStatus(movement.id, status)
      setMovements((prev) => ({
        ...prev,
        [productId]: (prev[productId] ?? []).map((m) => (m.id === movement.id ? { ...m, payment_status: status } : m)),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update payment status')
    }
  }

  function openMovementModal(product: Product) {
    setMovementModalProduct(product)
    setMovementForm({
      ...emptyMovementForm,
      unit_price: String(product.cost_price),
    })
  }

  async function submitMovement(e: FormEvent) {
    e.preventDefault()
    if (!movementModalProduct) return
    const magnitude = Math.abs(Number(movementForm.quantity))
    const signedQuantity =
      movementForm.movement_type === 'sale'
        ? -magnitude
        : movementForm.movement_type === 'adjustment'
          ? Number(movementForm.quantity)
          : magnitude

    try {
      await createMovement({
        product_id: movementModalProduct.id,
        movement_type: movementForm.movement_type,
        quantity: signedQuantity,
        unit_price: movementForm.unit_price ? Number(movementForm.unit_price) : null,
        subscriber_id: movementForm.subscriber_id || null,
        staff_id: staff?.id ?? null,
        note: movementForm.note || null,
        movement_date: movementForm.movement_date,
        payment_status: movementForm.movement_type === 'sale' ? movementForm.payment_status : 'paid',
      })
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} logged a ${movementForm.movement_type} of ${Math.abs(signedQuantity)} for ${movementModalProduct.name}`,
        'product_movement',
        movementModalProduct.id,
      )
      setMovementModalProduct(null)
      await refresh()
      const rows = await listMovementsForProduct(movementModalProduct.id)
      setMovements((prev) => ({ ...prev, [movementModalProduct.id]: rows }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log movement')
    }
  }

  function handleExport() {
    exportToExcel(
      'products',
      products.map((p) => ({
        Name: p.name,
        SKU: p.sku ?? '',
        Category: p.category ?? '',
        'Cost Price': p.cost_price,
        'Sell Price': p.sell_price,
        'Quantity In Stock': p.quantity_in_stock,
        'Reorder Level': p.reorder_level,
        Unit: p.unit,
        Active: p.is_active ? 'Yes' : 'No',
      })),
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Products
        </h1>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleExport} className={secondaryButtonClass}>
            Export to Excel
          </button>
          <button onClick={openCreate} className={primaryButtonClass}>
            + New product
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {products.map((product) => (
          <div key={product.id} className={cardClass}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {product.name}
                  {!product.is_active && (
                    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                      inactive
                    </span>
                  )}
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {[product.sku, product.category].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Cost {product.cost_price} · Sell {product.sell_price}
                </p>
                <p className="text-sm">
                  Stock: {product.quantity_in_stock} {product.unit}
                  {product.quantity_in_stock <= product.reorder_level && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                      reorder
                    </span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(product)} className={secondaryButtonClass}>
                  Edit
                </button>
                <button onClick={() => remove(product)} className={dangerButtonClass}>
                  Delete
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => openMovementModal(product)} className={secondaryButtonClass}>
                Log movement
              </button>
              <button
                onClick={() => toggleExpand(product.id)}
                className="px-2 py-2.5 text-sm text-blue-600 dark:text-blue-400"
              >
                {expandedId === product.id ? 'Hide history' : 'Show history'}
              </button>
            </div>

            {expandedId === product.id && (
              <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
                {(movements[product.id] ?? []).map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-md p-2 text-sm ${
                      m.movement_type === 'sale' ? paymentStatusClass[m.payment_status] : 'bg-neutral-50 dark:bg-neutral-700/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p>
                        {m.movement_type} · {m.quantity > 0 ? '+' : ''}
                        {m.quantity} on {m.movement_date}
                      </p>
                      {m.movement_type === 'sale' && (
                        <select
                          value={m.payment_status}
                          onChange={(e) => changePaymentStatus(product.id, m, e.target.value as MovementPaymentStatus)}
                          className="shrink-0 rounded border-0 bg-white/60 text-xs font-medium dark:bg-black/20"
                        >
                          {(Object.keys(paymentStatusLabel) as MovementPaymentStatus[]).map((s) => (
                            <option key={s} value={s}>
                              {paymentStatusLabel[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <p className="opacity-80">
                      {m.unit_price != null && `@ ${m.unit_price}`}
                      {m.subscribers?.name && ` · ${m.subscribers.name}`}
                      {m.note && ` · ${m.note}`}
                    </p>
                  </div>
                ))}
                {(movements[product.id] ?? []).length === 0 && (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No stock movements yet.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && products.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No products yet.</p>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit product' : 'New product'}
      >
        <form onSubmit={submit}>
          <label className={labelClass}>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>SKU</label>
              <input
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Cost price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.cost_price}
                onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Sell price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.sell_price}
                onChange={(e) => setForm((f) => ({ ...f, sell_price: e.target.value }))}
                className={inputClass}
                required
              />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Unit</label>
              <input
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Reorder level</label>
              <input
                type="number"
                min="0"
                value={form.reorder_level}
                onChange={(e) => setForm((f) => ({ ...f, reorder_level: e.target.value }))}
                className={inputClass}
                required
              />
            </div>
          </div>

          {!editing && (
            <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
              New products start at 0 stock. Add stock with a restock movement after saving.
            </p>
          )}

          <label className="mb-4 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Active
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass}>
              Save
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(movementModalProduct)}
        onClose={() => setMovementModalProduct(null)}
        title={`Log movement · ${movementModalProduct?.name ?? ''}`}
      >
        <form onSubmit={submitMovement}>
          <label className={labelClass}>Type</label>
          <select
            value={movementForm.movement_type}
            onChange={(e) =>
              setMovementForm((f) => ({
                ...f,
                movement_type: e.target.value as MovementType,
              }))
            }
            className={`${inputClass} mb-4`}
          >
            {(Object.keys(movementTypeLabels) as MovementType[]).map((type) => (
              <option key={type} value={type}>
                {movementTypeLabels[type]}
              </option>
            ))}
          </select>

          <label className={labelClass}>
            {movementForm.movement_type === 'adjustment' ? 'Quantity change (+/-)' : 'Quantity'}
          </label>
          <input
            type="number"
            step="1"
            value={movementForm.quantity}
            onChange={(e) => setMovementForm((f) => ({ ...f, quantity: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />

          <label className={labelClass}>Unit price</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={movementForm.unit_price}
            onChange={(e) => setMovementForm((f) => ({ ...f, unit_price: e.target.value }))}
            className={`${inputClass} mb-4`}
          />

          <label className={labelClass}>Movement date</label>
          <input
            type="date"
            value={movementForm.movement_date}
            onChange={(e) => setMovementForm((f) => ({ ...f, movement_date: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />

          {movementForm.movement_type === 'sale' && (
            <>
              <label className={labelClass}>Payment status</label>
              <select
                value={movementForm.payment_status}
                onChange={(e) =>
                  setMovementForm((f) => ({ ...f, payment_status: e.target.value as MovementPaymentStatus }))
                }
                className={`${inputClass} mb-4`}
              >
                {(Object.keys(paymentStatusLabel) as MovementPaymentStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {paymentStatusLabel[s]}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className={labelClass}>Subscriber (if sold/installed for one)</label>
          <select
            value={movementForm.subscriber_id}
            onChange={(e) => setMovementForm((f) => ({ ...f, subscriber_id: e.target.value }))}
            className={`${inputClass} mb-4`}
          >
            <option value="">None</option>
            {subscribers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <label className={labelClass}>Note</label>
          <input
            value={movementForm.note}
            onChange={(e) => setMovementForm((f) => ({ ...f, note: e.target.value }))}
            className={`${inputClass} mb-4`}
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMovementModalProduct(null)}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass}>
              Save
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
