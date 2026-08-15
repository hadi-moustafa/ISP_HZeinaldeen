import { useEffect, useState, type FormEvent } from 'react'
import {
  listCompanyDues,
  listCompanyPayments,
  createCompanyPayment,
  updateCompanyPayment,
  deleteCompanyPayment,
} from '../../lib/api/companyPayments'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import type { CompanyDue, CompanyPayment } from '../../types/companyPayments'
import { Modal } from '../../components/Modal'
import { inputClass, primaryButtonClass, secondaryButtonClass, cardClass } from '../../lib/uiClasses'

export function CompanyPaymentsPage() {
  const { staff } = useStaff()
  const [dues, setDues] = useState<CompanyDue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [payments, setPayments] = useState<Record<string, CompanyPayment[]>>({})

  const [payingCompany, setPayingCompany] = useState<CompanyDue | null>(null)
  const [form, setForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    note: '',
  })

  const [editingPayment, setEditingPayment] = useState<CompanyPayment | null>(null)
  const [editForm, setEditForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    note: '',
  })

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setDues(await listCompanyDues())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company dues')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function toggleExpand(compId: string) {
    if (expandedId === compId) {
      setExpandedId(null)
      return
    }
    setExpandedId(compId)
    if (!payments[compId]) {
      try {
        const rows = await listCompanyPayments(compId)
        setPayments((prev) => ({ ...prev, [compId]: rows }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payments')
      }
    }
  }

  function openPayModal(due: CompanyDue) {
    setPayingCompany(due)
    setForm({
      amount: String(Math.max(due.total_owed - due.total_paid, 0)),
      payment_date: new Date().toISOString().slice(0, 10),
      note: '',
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!payingCompany) return
    try {
      await createCompanyPayment({
        comp_id: payingCompany.comp_id,
        amount: Number(form.amount),
        payment_date: form.payment_date,
        note: form.note || null,
        staff_id: staff?.id ?? null,
      })
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} logged a payment of ${form.amount} to company ${payingCompany.company_name}`,
        'company_payment',
        payingCompany.comp_id,
      )
      setPayingCompany(null)
      await refresh()
      const rows = await listCompanyPayments(payingCompany.comp_id)
      setPayments((prev) => ({ ...prev, [payingCompany.comp_id]: rows }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log payment')
    }
  }

  function openEditModal(payment: CompanyPayment) {
    setEditingPayment(payment)
    setEditForm({
      amount: String(payment.amount),
      payment_date: payment.payment_date,
      note: payment.note ?? '',
    })
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingPayment) return
    try {
      await updateCompanyPayment(editingPayment.id, {
        amount: Number(editForm.amount),
        payment_date: editForm.payment_date,
        note: editForm.note || null,
      })
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} edited a company payment (now ${editForm.amount})`,
        'company_payment',
        editingPayment.comp_id,
      )
      setEditingPayment(null)
      await refresh()
      const rows = await listCompanyPayments(editingPayment.comp_id)
      setPayments((prev) => ({ ...prev, [editingPayment.comp_id]: rows }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update payment')
    }
  }

  async function handleDeletePayment(payment: CompanyPayment) {
    if (!confirm(`Delete this payment of ${payment.amount}?`)) return
    try {
      await deleteCompanyPayment(payment.id)
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} deleted a company payment of ${payment.amount}`,
        'company_payment',
        payment.comp_id,
      )
      await refresh()
      const rows = await listCompanyPayments(payment.comp_id)
      setPayments((prev) => ({ ...prev, [payment.comp_id]: rows }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete payment')
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Company payments</h1>
      <p className="mb-4 text-sm text-neutral-500">
        What the ISP owes each reseller -- the sum of each active subscriber's service paid-price --
        against what's actually been paid.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-neutral-500">Loading…</p>}

      <div className="space-y-3">
        {dues.map((due) => {
          const balance = due.total_owed - due.total_paid
          return (
            <div key={due.comp_id} className={cardClass}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-neutral-900">{due.company_name}</p>
                  <p className="text-sm text-neutral-500">
                    Owed {due.total_owed.toFixed(2)} · Paid {due.total_paid.toFixed(2)}
                  </p>
                  <p className={`text-sm font-semibold ${balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    Balance {balance.toFixed(2)}
                  </p>
                </div>
                <button onClick={() => openPayModal(due)} className={primaryButtonClass}>
                  Log payment
                </button>
              </div>

              <button
                onClick={() => toggleExpand(due.comp_id)}
                className="mt-3 text-sm text-blue-600"
              >
                {expandedId === due.comp_id ? 'Hide payment history' : 'Show payment history'}
              </button>

              {expandedId === due.comp_id && (
                <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3">
                  {(payments[due.comp_id] ?? []).map((p) => (
                    <div key={p.id} className="flex items-start justify-between gap-2 rounded-md bg-neutral-50 p-2 text-sm">
                      <div className="min-w-0">
                        <p className="text-neutral-800">
                          {p.amount} on {p.payment_date}
                        </p>
                        {p.note && <p className="text-neutral-500">{p.note}</p>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => openEditModal(p)}
                          className="text-xs font-medium text-blue-600"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeletePayment(p)}
                          className="text-xs font-medium text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  {(payments[due.comp_id] ?? []).length === 0 && (
                    <p className="text-sm text-neutral-500">No payments logged yet.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!loading && dues.length === 0 && <p className="text-neutral-500">No companies yet.</p>}
      </div>

      <Modal
        open={Boolean(payingCompany)}
        onClose={() => setPayingCompany(null)}
        title={`Log payment · ${payingCompany?.company_name ?? ''}`}
      >
        <form onSubmit={submit}>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Amount"
            className={`${inputClass} mb-4`}
            required
          />
          <input
            type="date"
            aria-label="Payment date"
            value={form.payment_date}
            onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Note"
            className={`${inputClass} mb-4`}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPayingCompany(null)} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass}>
              Save
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editingPayment)}
        onClose={() => setEditingPayment(null)}
        title="Edit payment"
      >
        <form onSubmit={submitEdit}>
          <input
            type="number"
            step="0.01"
            min="0"
            value={editForm.amount}
            onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Amount"
            className={`${inputClass} mb-4`}
            required
          />
          <input
            type="date"
            aria-label="Payment date"
            value={editForm.payment_date}
            onChange={(e) => setEditForm((f) => ({ ...f, payment_date: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />
          <input
            value={editForm.note}
            onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Note"
            className={`${inputClass} mb-4`}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditingPayment(null)} className={secondaryButtonClass}>
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
