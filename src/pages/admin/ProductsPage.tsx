import { useEffect, useState, type FormEvent } from 'react'
import { listProducts, createProduct, updateProduct, deleteProduct } from '../../lib/api/products'
import type { Product } from '../../types/reference'
import { Modal } from '../../components/Modal'
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

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState(emptyForm)

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
      } else {
        await createProduct(input)
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
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete product')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Products
        </h1>
        <button onClick={openCreate} className={primaryButtonClass}>
          + New product
        </button>
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
              New products start at 0 stock. Add stock via a restock movement once inventory
              tracking is built (Phase 6).
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
    </div>
  )
}
