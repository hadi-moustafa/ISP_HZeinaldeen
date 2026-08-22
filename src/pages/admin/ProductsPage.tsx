import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  listProductStockSummary,
  createProduct,
  updateProduct,
  deleteProduct,
  listBundleItems,
  saveBundleItems,
} from '../../lib/api/products'
import {
  listMovementsForProduct,
  createMovement,
  updateMovementPaymentStatus,
  restockProductLot,
} from '../../lib/api/movements'
import { logActivity } from '../../lib/api/activityLog'
import type { Product, ProductStockSummary, ProductType, BundleItemWithProduct } from '../../types/reference'
import type { MovementPaymentStatus, MovementType, ProductMovementWithSubscriber } from '../../types/movements'
import { movementLineTotal } from '../../types/movements'
import { useStaff } from '../../context/StaffContext'
import { Modal } from '../../components/Modal'
import { exportToExcel } from '../../lib/exportExcel'
import { primaryButtonClass, secondaryButtonClass } from '../../lib/uiClasses'
import { Plus, X, Pencil, Trash2, Package2 } from 'lucide-react'

// Labeled field wrapper for the New/Edit product and Log movement forms --
// this app otherwise sticks to placeholder-only inputs, but these two
// forms have enough same-shaped number fields side by side (cost/sell,
// quantity/price) that a label is worth it for clarity, per explicit
// request for this page specifically.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-neutral-500 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  )
}

// Groups related fields under a small uppercase section heading -- used to
// break the New/Edit product and Log movement forms into visually distinct
// chunks (Pricing, Batch details, etc.) instead of one long flat list.
function FormSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-700 dark:bg-neutral-900/40">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</p>
      {children}
    </div>
  )
}

const modernInputClass =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100'

const emptyForm = {
  sku: '',
  name: '',
  category: '',
  cost_price: '',
  sell_price: '',
  reorder_level: '0',
  unit: 'pcs',
  is_active: true,
  product_type: 'standard' as ProductType,
  cable_unit_length: '',
}

const productTypeLabels: Record<ProductType, string> = {
  standard: 'Standard',
  cable: 'Cable',
  bundle: 'Bundle',
}

// Movement types loggable from this generic modal -- 'sale' is
// deliberately excluded: every sale (standard/cable/bundle) now goes
// through the FIFO-lot-aware log_product_sale() RPC via the dedicated
// Sell page, not a raw movement insert, so it isn't duplicated here.
const movementTypeLabels: Record<Exclude<MovementType, 'sale'>, string> = {
  restock: 'Restock (+)',
  return: 'Return (+)',
  adjustment: 'Adjustment (+/-)',
}

const emptyMovementForm = {
  movement_type: 'restock' as Exclude<MovementType, 'sale'>,
  quantity: '',
  cost_price: '',
  sell_price: '',
  lot_id: '',
  note: '',
  movement_date: new Date().toISOString().slice(0, 10),
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

interface BundleDraftLine {
  key: string
  productId: string
  productName: string
  quantity: string
}

export function ProductsPage() {
  const { staff } = useStaff()
  const [products, setProducts] = useState<ProductStockSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [bundleDraft, setBundleDraft] = useState<BundleDraftLine[]>([])
  const [bundlePickerOpen, setBundlePickerOpen] = useState(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [movements, setMovements] = useState<Record<string, ProductMovementWithSubscriber[]>>({})

  const [movementModalProduct, setMovementModalProduct] = useState<ProductStockSummary | null>(null)
  const [movementForm, setMovementForm] = useState(emptyMovementForm)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setProducts(await listProductStockSummary())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const standardAndCableProducts = useMemo(
    () => products.filter((p) => p.product_type !== 'bundle'),
    [products],
  )

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setBundleDraft([])
    setModalOpen(true)
  }

  async function openEdit(product: ProductStockSummary) {
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
      product_type: product.product_type,
      cable_unit_length: product.cable_unit_length != null ? String(product.cable_unit_length) : '',
    })
    setBundleDraft([])
    setModalOpen(true)
    if (product.product_type === 'bundle') {
      try {
        const items = await listBundleItems(product.id)
        setBundleDraft(
          items.map((i: BundleItemWithProduct) => ({
            key: i.id,
            productId: i.product_id,
            productName: i.products?.name ?? 'Product',
            quantity: String(i.quantity),
          })),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bundle components')
      }
    }
  }

  function addBundleComponent(product: ProductStockSummary) {
    setBundleDraft((prev) => [
      ...prev,
      { key: crypto.randomUUID(), productId: product.id, productName: product.name, quantity: '1' },
    ])
    setBundlePickerOpen(false)
  }

  function removeBundleComponent(key: string) {
    setBundleDraft((prev) => prev.filter((l) => l.key !== key))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = {
      sku: form.sku || null,
      name: form.name,
      category: form.category || null,
      cost_price: form.product_type === 'bundle' ? 0 : Number(form.cost_price),
      sell_price: Number(form.sell_price),
      reorder_level: form.product_type === 'bundle' ? 0 : Number(form.reorder_level),
      unit: form.product_type === 'cable' ? 'm' : form.product_type === 'bundle' ? 'bundle' : form.unit,
      is_active: form.is_active,
      product_type: form.product_type,
      cable_unit_length: form.product_type === 'cable' ? Number(form.cable_unit_length) || null : null,
    }
    if (form.product_type === 'bundle' && bundleDraft.some((l) => !l.productId || Number(l.quantity) <= 0)) {
      setError('Every bundle component needs a product and a quantity greater than 0.')
      return
    }
    try {
      let productId: string
      if (editing) {
        await updateProduct(editing.id, input)
        productId = editing.id
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited product ${input.name}`, 'product', editing.id)
      } else {
        const created = await createProduct(input)
        productId = created.id
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created product ${input.name}`, 'product', created.id)
      }
      if (form.product_type === 'bundle') {
        await saveBundleItems(
          productId,
          bundleDraft.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        )
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

  function openMovementModal(product: ProductStockSummary) {
    setMovementModalProduct(product)
    setMovementForm({
      ...emptyMovementForm,
      cost_price: String(product.cost_price),
      sell_price: String(product.sell_price),
    })
  }

  async function submitMovement(e: FormEvent) {
    e.preventDefault()
    if (!movementModalProduct) return

    try {
      if (movementForm.movement_type === 'restock') {
        await restockProductLot({
          productId: movementModalProduct.id,
          quantity: Math.abs(Number(movementForm.quantity)),
          costPrice: Number(movementForm.cost_price) || 0,
          sellPrice: Number(movementForm.sell_price) || 0,
          note: movementForm.note || null,
          receivedDate: movementForm.movement_date,
          staffId: staff?.id ?? null,
        })
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} restocked ${Math.abs(Number(movementForm.quantity))} of ${movementModalProduct.name} at cost ${movementForm.cost_price}, sell ${movementForm.sell_price}`,
          'product_movement',
          movementModalProduct.id,
        )
      } else {
        const magnitude = Math.abs(Number(movementForm.quantity))
        const signedQuantity = movementForm.movement_type === 'adjustment' ? Number(movementForm.quantity) : magnitude
        await createMovement({
          product_id: movementModalProduct.id,
          movement_type: movementForm.movement_type,
          quantity: signedQuantity,
          unit_price: movementForm.cost_price ? Number(movementForm.cost_price) : null,
          lot_id: movementForm.lot_id || null,
          subscriber_id: null,
          staff_id: staff?.id ?? null,
          note: movementForm.note || null,
          movement_date: movementForm.movement_date,
          payment_status: 'paid',
        })
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} logged a ${movementForm.movement_type} of ${Math.abs(signedQuantity)} for ${movementModalProduct.name}`,
          'product_movement',
          movementModalProduct.id,
        )
      }
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
        Type: productTypeLabels[p.product_type],
        'Cost Price': p.cost_price,
        'Sell Price': p.sell_price,
        'Quantity In Stock': p.total_stock,
        'Reorder Level': p.reorder_level,
        Unit: p.unit,
        Active: p.is_active ? 'Yes' : 'No',
      })),
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button onClick={handleExport} className={secondaryButtonClass}>
          Export to Excel
        </button>
        <button onClick={openCreate} className={primaryButtonClass}>
          + New product
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <div
            key={product.id}
            className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-neutral-700 dark:bg-neutral-800"
          >
            <div className="mb-1.5 flex items-start justify-between gap-1">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                <Package2 size={14} />
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => openEdit(product)}
                  aria-label="Edit product"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => remove(product)}
                  aria-label="Delete product"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{product.name}</p>
            <p className="mb-1.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
              {[product.sku, product.category].filter(Boolean).join(' · ') || '—'}
            </p>

            <div className="mb-2 flex flex-wrap gap-1">
              {product.product_type !== 'standard' && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                  {productTypeLabels[product.product_type]}
                </span>
              )}
              {!product.is_active && (
                <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                  inactive
                </span>
              )}
              {product.product_type !== 'bundle' && product.open_lot_count > 1 && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  {product.open_lot_count} batches
                </span>
              )}
              {product.product_type !== 'bundle' && product.total_stock <= product.reorder_level && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                  reorder
                </span>
              )}
            </div>

            {product.product_type === 'bundle' ? (
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{product.sell_price.toFixed(2)}</p>
            ) : (
              <div className="space-y-0.5 text-xs text-neutral-600 dark:text-neutral-300">
                <p>
                  Cost {product.active_lot?.cost_price ?? product.cost_price} · Sell{' '}
                  {product.active_lot?.sell_price ?? product.sell_price}
                </p>
                <p>
                  Stock: {product.total_stock} {product.unit}
                </p>
              </div>
            )}

            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-neutral-100 pt-2.5 dark:border-neutral-700">
              {product.product_type !== 'bundle' && (
                <button
                  onClick={() => openMovementModal(product)}
                  className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-700 dark:border-neutral-600 dark:text-neutral-100"
                >
                  Log movement
                </button>
              )}
              <button
                onClick={() => toggleExpand(product.id)}
                className="rounded-full px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400"
              >
                {expandedId === product.id ? 'Hide history' : 'History'}
              </button>
            </div>

            {expandedId === product.id && (
              <div className="mt-2.5 space-y-1.5 border-t border-neutral-100 pt-2.5 dark:border-neutral-700">
                {(movements[product.id] ?? []).map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg p-2 text-[11px] ${
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
                          className="shrink-0 rounded border-0 bg-white/60 text-[10px] font-medium dark:bg-black/20"
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
                      {m.movement_type === 'sale' ? `Total ${movementLineTotal(m).toFixed(2)}` : m.unit_price != null && `@ ${m.unit_price}`}
                      {m.subscribers?.name && ` · ${m.subscribers.name}`}
                      {m.note && ` · ${m.note}`}
                    </p>
                  </div>
                ))}
                {(movements[product.id] ?? []).length === 0 && (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">No stock movements yet.</p>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && products.length === 0 && (
          <p className="col-span-full text-neutral-500 dark:text-neutral-400">No products yet.</p>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit product' : 'New product'}
      >
        <form onSubmit={submit}>
          <div className="mb-4 flex gap-1 rounded-full bg-neutral-100 p-1 dark:bg-neutral-700">
            {(Object.keys(productTypeLabels) as ProductType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm((f) => ({ ...f, product_type: t }))}
                className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium ${
                  form.product_type === t
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                {productTypeLabels[t]}
              </button>
            ))}
          </div>

          <FormSection label="Basics">
            <div className="mb-3">
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={modernInputClass}
                  required
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU">
                <input
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  className={modernInputClass}
                />
              </Field>
              <Field label="Category">
                <input
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className={modernInputClass}
                />
              </Field>
            </div>
          </FormSection>

          {form.product_type === 'bundle' ? (
            <>
              <FormSection label="Pricing">
                <Field label="Bundle price (what the customer pays)">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.sell_price}
                    onChange={(e) => setForm((f) => ({ ...f, sell_price: e.target.value }))}
                    className={modernInputClass}
                    required
                  />
                </Field>
              </FormSection>

              <FormSection label="Components">
                <div className="relative">
                  <div className="mb-2 space-y-1.5">
                    {bundleDraft.map((l) => (
                      <div key={l.key} className="flex items-center gap-2">
                        <span className="flex-1 truncate text-sm text-neutral-700 dark:text-neutral-200">{l.productName}</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={l.quantity}
                          onChange={(e) =>
                            setBundleDraft((prev) => prev.map((p) => (p.key === l.key ? { ...p, quantity: e.target.value } : p)))
                          }
                          className="w-20 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm shadow-sm dark:border-neutral-600 dark:bg-neutral-800"
                        />
                        <button type="button" onClick={() => removeBundleComponent(l.key)} className="text-neutral-400">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    {bundleDraft.length === 0 && (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">No components added yet.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBundlePickerOpen((v) => !v)}
                    className="flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400"
                  >
                    <Plus size={14} /> Add a product
                  </button>
                  {bundlePickerOpen && (
                    <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                      {standardAndCableProducts.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addBundleComponent(p)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700"
                        >
                          <span className="text-neutral-800 dark:text-neutral-100">{p.name}</span>
                          <span className="text-neutral-500 dark:text-neutral-400">{p.total_stock} {p.unit}</span>
                        </button>
                      ))}
                      {standardAndCableProducts.length === 0 && (
                        <p className="p-3 text-sm text-neutral-500 dark:text-neutral-400">No products to add.</p>
                      )}
                    </div>
                  )}
                </div>
              </FormSection>
            </>
          ) : (
            <>
              <FormSection label="Pricing">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cost price">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.cost_price}
                      onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
                      className={modernInputClass}
                      required
                    />
                  </Field>
                  <Field label="Sell price">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.sell_price}
                      onChange={(e) => setForm((f) => ({ ...f, sell_price: e.target.value }))}
                      className={modernInputClass}
                      required
                    />
                  </Field>
                </div>
              </FormSection>

              {form.product_type === 'cable' ? (
                <FormSection label="Cable settings">
                  <Field label="Billable unit length (meters)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.cable_unit_length}
                      onChange={(e) => setForm((f) => ({ ...f, cable_unit_length: e.target.value }))}
                      placeholder="e.g. 70"
                      className={modernInputClass}
                      required
                    />
                  </Field>
                </FormSection>
              ) : (
                <FormSection label="Stock settings">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Unit">
                      <input
                        value={form.unit}
                        onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                        className={modernInputClass}
                        required
                      />
                    </Field>
                    <Field label="Reorder level">
                      <input
                        type="number"
                        min="0"
                        value={form.reorder_level}
                        onChange={(e) => setForm((f) => ({ ...f, reorder_level: e.target.value }))}
                        className={modernInputClass}
                        required
                      />
                    </Field>
                  </div>
                </FormSection>
              )}

              {!editing && (
                <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
                  New products start at 0 stock. Add stock with a restock movement after saving.
                </p>
              )}
            </>
          )}

          <label className="mb-4 flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Active</span>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 accent-blue-600"
            />
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
          <FormSection label="Movement">
            <div className="mb-3">
              <Field label="Type">
                <select
                  value={movementForm.movement_type}
                  onChange={(e) =>
                    setMovementForm((f) => ({
                      ...f,
                      movement_type: e.target.value as Exclude<MovementType, 'sale'>,
                    }))
                  }
                  className={modernInputClass}
                >
                  {(Object.keys(movementTypeLabels) as Exclude<MovementType, 'sale'>[]).map((type) => (
                    <option key={type} value={type}>
                      {movementTypeLabels[type]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label={
                movementForm.movement_type === 'adjustment'
                  ? 'Quantity change (+/-)'
                  : movementModalProduct?.product_type === 'cable'
                    ? 'Meters'
                    : 'Quantity'
              }
            >
              <input
                type="number"
                step="0.01"
                value={movementForm.quantity}
                onChange={(e) => setMovementForm((f) => ({ ...f, quantity: e.target.value }))}
                className={modernInputClass}
                required
              />
            </Field>
          </FormSection>

          {movementForm.movement_type === 'restock' ? (
            <FormSection label="Batch details">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cost price">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={movementForm.cost_price}
                    onChange={(e) => setMovementForm((f) => ({ ...f, cost_price: e.target.value }))}
                    className={modernInputClass}
                    required
                  />
                </Field>
                <Field label="Sell price">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={movementForm.sell_price}
                    onChange={(e) => setMovementForm((f) => ({ ...f, sell_price: e.target.value }))}
                    className={modernInputClass}
                    required
                  />
                </Field>
              </div>
            </FormSection>
          ) : (
            <FormSection label="Pricing">
              <Field label="Unit price (optional)">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={movementForm.cost_price}
                  onChange={(e) => setMovementForm((f) => ({ ...f, cost_price: e.target.value }))}
                  className={modernInputClass}
                />
              </Field>
            </FormSection>
          )}

          <FormSection label="Details">
            <div className="mb-3">
              <Field label="Date">
                <input
                  type="date"
                  value={movementForm.movement_date}
                  onChange={(e) => setMovementForm((f) => ({ ...f, movement_date: e.target.value }))}
                  className={modernInputClass}
                  required
                />
              </Field>
            </div>
            <Field label="Note (optional)">
              <input
                value={movementForm.note}
                onChange={(e) => setMovementForm((f) => ({ ...f, note: e.target.value }))}
                className={modernInputClass}
              />
            </Field>
          </FormSection>

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
