import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, CheckCircle2, CircleSlash, CircleDashed, PackagePlus } from 'lucide-react'
import { useStaff } from '../context/StaffContext'
import {
  listTechnicianOpenTasks,
  listTechnicianFinishedTasks,
  countTasks,
  setTaskStatus,
  saveTaskReport,
  addTaskOrder,
  deleteTaskOrder,
} from '../lib/api/tasks'
import { listProducts } from '../lib/api/products'
import { logActivity } from '../lib/api/activityLog'
import { compareTasks, formatDateTime, orderLabel, STATUS_LABEL } from '../lib/tasks'
import type { TaskProductOrder, TaskStatus, TaskWithRelations } from '../types/tasks'
import type { Product } from '../types/reference'
import { AppHeader } from '../components/AppHeader'
import { TaskBody, TaskHeading, TaskMeta, TaskOrders } from '../components/tasks/TaskDetails'
import { cardClass } from '../lib/uiClasses'

function TaskCard({
  task,
  products,
  onChanged,
}: {
  task: TaskWithRelations
  products: Product[]
  onChanged: () => void
}) {
  const { staff } = useStaff()
  const [report, setReport] = useState(task.report ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orderOpen, setOrderOpen] = useState(false)
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [orderNote, setOrderNote] = useState('')

  const cleanReport = report.trim() || null
  const reportDirty = cleanReport !== (task.report ?? null)

  async function run(fn: () => Promise<void>, failMsg: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : failMsg)
    } finally {
      setBusy(false)
    }
  }

  function changeStatus(status: TaskStatus) {
    if (!staff) return
    if (status === 'cant_do' && !cleanReport) {
      setError("Write in the report why it can't be done, so the admin knows.")
      return
    }
    if (!confirm(`Mark the task for ${task.subscriber_name} as "${STATUS_LABEL[status]}"?`)) return
    run(async () => {
      await setTaskStatus(task.id, status, cleanReport, staff.id)
      logActivity(
        staff.id,
        `${staff.username} marked the task for ${task.subscriber_name} as ${STATUS_LABEL[status]} on ${formatDateTime(
          new Date().toISOString(),
        )}${cleanReport ? ` -- report: ${cleanReport}` : ''}`,
        'task',
        task.id,
      )
    }, 'Failed to update the task')
  }

  function saveReport() {
    if (!staff) return
    run(async () => {
      await saveTaskReport(task.id, cleanReport)
      logActivity(
        staff.id,
        `${staff.username} wrote a report on the task for ${task.subscriber_name}: ${cleanReport ?? '(cleared)'}`,
        'task',
        task.id,
      )
    }, 'Failed to save the report')
  }

  function addOrder() {
    if (!staff) return
    const qty = Number(quantity)
    if (!productId) return setError('Pick a product.')
    if (!(qty > 0)) return setError('Enter a quantity.')
    const product = products.find((p) => p.id === productId)
    run(async () => {
      await addTaskOrder({ taskId: task.id, productId, quantity: qty, note: orderNote.trim() || null, staffId: staff.id })
      logActivity(
        staff.id,
        `${staff.username} ordered ${product?.name ?? 'a product'} × ${qty} for ${task.subscriber_name} (task)`,
        'task',
        task.id,
      )
      setProductId('')
      setQuantity('1')
      setOrderNote('')
      setOrderOpen(false)
    }, 'Failed to add the order')
  }

  function removeOrder(order: TaskProductOrder) {
    if (!staff || !confirm(`Remove the order ${orderLabel(order)}?`)) return
    run(async () => {
      await deleteTaskOrder(order.id)
      logActivity(
        staff.id,
        `${staff.username} removed the order ${orderLabel(order)} for ${task.subscriber_name} (task)`,
        'task',
        task.id,
      )
    }, 'Failed to remove the order')
  }

  return (
    <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
      <TaskHeading task={task} />
      <TaskBody task={{ ...task, report: null }} />
      <TaskOrders orders={task.task_product_orders} onDelete={removeOrder} />

      {orderOpen ? (
        <div className="space-y-1.5 rounded-lg bg-neutral-50 p-2">
          <div className="flex gap-1.5">
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm"
            >
              <option value="">Product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-20 rounded-md border border-neutral-300 px-2 py-2 text-sm"
              aria-label="Quantity"
            />
          </div>
          <input
            value={orderNote}
            onChange={(e) => setOrderNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setOrderOpen(false)} className="text-xs text-neutral-500">
              Cancel
            </button>
            <button
              onClick={addOrder}
              disabled={busy}
              className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Add order
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOrderOpen(true)}
          className="flex items-center gap-1 text-xs font-semibold text-blue-600"
        >
          <PackagePlus size={14} /> Order a product
        </button>
      )}

      <div>
        <textarea
          value={report}
          onChange={(e) => setReport(e.target.value)}
          rows={2}
          placeholder="Report to the admin (what you did, anything important)"
          className="w-full rounded-md border border-blue-200 bg-blue-50/40 px-3 py-2 text-sm"
        />
        {reportDirty && (
          <button onClick={saveReport} disabled={busy} className="text-xs font-semibold text-blue-600 disabled:opacity-50">
            Save report
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => changeStatus('done')}
          disabled={busy}
          className="flex items-center justify-center gap-1 rounded-full bg-emerald-500 px-2 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          <CheckCircle2 size={14} /> Done
        </button>
        <button
          onClick={() => changeStatus('half_done')}
          disabled={busy || task.status === 'half_done'}
          className="flex items-center justify-center gap-1 rounded-full bg-amber-400 px-2 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          <CircleDashed size={14} /> Half done
        </button>
        <button
          onClick={() => changeStatus('cant_do')}
          disabled={busy}
          className="flex items-center justify-center gap-1 rounded-full bg-red-500 px-2 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          <CircleSlash size={14} /> Can't be done
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <TaskMeta task={task} />
    </div>
  )
}

// The only page a technician account can open: their tasks (assigned to
// them, or to nobody), highest priority first.
export function MyTasksPage() {
  const { staff } = useStaff()
  const [open, setOpen] = useState<TaskWithRelations[]>([])
  const [finished, setFinished] = useState<TaskWithRelations[]>([])
  const [doneCount, setDoneCount] = useState(0)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [finishedOpen, setFinishedOpen] = useState(false)

  async function refresh() {
    if (!staff) return
    try {
      const [o, f, done] = await Promise.all([
        listTechnicianOpenTasks(staff.id),
        listTechnicianFinishedTasks(staff.id),
        countTasks(['done'], staff.id),
      ])
      setOpen(o)
      setFinished(f)
      setDoneCount(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    listProducts()
      .then((rows) => setProducts(rows.filter((p) => p.is_active)))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id])

  const sorted = useMemo(() => [...open].sort(compareTasks), [open])

  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader title="Tasks">
        <main className="p-3">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
              <p className="text-2xl font-bold tabular-nums text-neutral-900">{open.length}</p>
              <p className="text-xs text-neutral-500">Yet to be done</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
              <p className="text-2xl font-bold tabular-nums text-emerald-600">{doneCount}</p>
              <p className="text-xs text-neutral-500">Done</p>
            </div>
          </div>

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          {loading && <p className="text-sm text-neutral-500">Loading…</p>}
          {!loading && sorted.length === 0 && (
            <p className={`${cardClass} text-sm text-neutral-500`}>No tasks right now.</p>
          )}

          <div className="space-y-2">
            {sorted.map((task) => (
              // key includes updated_at so the card's local report text resets
              // to the saved value after each refresh.
              <TaskCard key={`${task.id}:${task.updated_at}`} task={task} products={products} onChanged={refresh} />
            ))}
          </div>

          {finished.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setFinishedOpen((v) => !v)}
                aria-expanded={finishedOpen}
                className="flex w-full items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800"
              >
                Finished by me ({finished.length}
                {finished.length === 50 ? ', latest' : ''})
                <ChevronDown size={16} className={`transition-transform duration-200 ${finishedOpen ? 'rotate-180' : ''}`} />
              </button>
              {finishedOpen && (
                <div className="mt-1.5 space-y-1.5">
                  {finished.map((task) => (
                    <div key={task.id} className="space-y-1.5 rounded-xl border border-neutral-200 bg-white p-3">
                      <TaskHeading task={task} />
                      <TaskBody task={task} />
                      <TaskOrders orders={task.task_product_orders} />
                      <TaskMeta task={task} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </AppHeader>
    </div>
  )
}
