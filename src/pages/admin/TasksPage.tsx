import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, RotateCcw } from 'lucide-react'
import { useStaff } from '../../context/StaffContext'
import {
  listUnfinishedTasks,
  listFinishedTasks,
  countTasks,
  createTask,
  updateTask,
  deleteTask,
  setTaskStatus,
  confirmTaskOrder,
  rejectTaskOrder,
  listTaskSubscriberOptions,
  type TaskSubscriberOption,
} from '../../lib/api/tasks'
import { listTechnicians, type TechnicianStaff } from '../../lib/api/staff'
import { logActivity } from '../../lib/api/activityLog'
import { compareTasks, orderLabel, formatDateTime, STATUS_LABEL } from '../../lib/tasks'
import type { TaskInput, TaskPriority, TaskProductOrder, TaskWithRelations } from '../../types/tasks'
import { Modal } from '../../components/Modal'
import { TaskBody, TaskHeading, TaskMeta, TaskOrders } from '../../components/tasks/TaskDetails'
import { inputClass, primaryButtonClass, secondaryButtonClass, cardClass } from '../../lib/uiClasses'

type Tab = 'todo' | 'finished'
type FinishedFilter = 'all' | 'done' | 'cant_do'

interface FormState {
  subscriberId: string | null
  subscriberName: string
  address: string
  phone: string
  problem: string
  possibleFixes: string
  notes: string
  priority: TaskPriority
  assignedTo: string
}

const emptyForm: FormState = {
  subscriberId: null,
  subscriberName: '',
  address: '',
  phone: '',
  problem: '',
  possibleFixes: '',
  notes: '',
  priority: 'normal',
  assignedTo: '',
}

// Area, address line, building -- skipping repeats (the address line is
// often just the area name again).
function subscriberAddress(s: TaskSubscriberOption) {
  const parts: string[] = []
  for (const part of [s.addresses?.name, s.address, s.building]) {
    const p = part?.trim()
    if (p && !parts.some((x) => x.toLowerCase() === p.toLowerCase())) parts.push(p)
  }
  return parts.join(', ')
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  )
}

export function TasksPage() {
  const { staff } = useStaff()
  const [tab, setTab] = useState<Tab>('todo')
  const [finishedFilter, setFinishedFilter] = useState<FinishedFilter>('all')
  const [unfinished, setUnfinished] = useState<TaskWithRelations[]>([])
  const [finished, setFinished] = useState<TaskWithRelations[]>([])
  const [totals, setTotals] = useState({ done: 0, cantDo: 0 })
  const [technicians, setTechnicians] = useState<TechnicianStaff[]>([])
  const [subscribers, setSubscribers] = useState<TaskSubscriberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TaskWithRelations | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [subscriberSearch, setSubscriberSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function refresh() {
    try {
      const [u, f, done, cantDo] = await Promise.all([
        listUnfinishedTasks(),
        listFinishedTasks(),
        countTasks(['done']),
        countTasks(['cant_do']),
      ])
      setUnfinished(u)
      setFinished(f)
      setTotals({ done, cantDo })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    listTechnicians().then(setTechnicians).catch(() => {})
    listTaskSubscriberOptions().then(setSubscribers).catch(() => {})
  }, [])

  const sortedUnfinished = useMemo(() => [...unfinished].sort(compareTasks), [unfinished])
  const visibleFinished = useMemo(
    () => (finishedFilter === 'all' ? finished : finished.filter((t) => t.status === finishedFilter)),
    [finished, finishedFilter],
  )

  const metrics = useMemo(() => {
    const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' }).slice(0, 7)
    const inMonth = (iso: string | null) =>
      iso != null && new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' }).slice(0, 7) === month
    const doneThisMonth = finished.filter((t) => t.status === 'done' && inMonth(t.finished_at)).length
    const pendingOrders = [...unfinished, ...finished].reduce(
      (n, t) => n + t.task_product_orders.filter((o) => o.status === 'requested').length,
      0,
    )
    return { doneThisMonth, pendingOrders }
  }, [finished, unfinished])

  const subscriberMatches = useMemo(() => {
    const term = subscriberSearch.trim().toLowerCase()
    if (!term) return []
    return subscribers
      .filter((s) => s.name.toLowerCase().includes(term) || (s.phone ?? '').includes(term))
      .slice(0, 20)
  }, [subscriberSearch, subscribers])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setSubscriberSearch('')
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(task: TaskWithRelations) {
    setEditing(task)
    setForm({
      subscriberId: task.subscriber_id,
      subscriberName: task.subscriber_name,
      address: task.address ?? '',
      phone: task.phone ?? '',
      problem: task.problem,
      possibleFixes: task.possible_fixes ?? '',
      notes: task.notes ?? '',
      priority: task.priority,
      assignedTo: task.assigned_to ?? '',
    })
    setSubscriberSearch('')
    setFormError(null)
    setFormOpen(true)
  }

  // Picking a subscriber fills address and phone from their record; both
  // stay editable for this task only.
  function pickSubscriber(s: TaskSubscriberOption) {
    setForm((f) => ({
      ...f,
      subscriberId: s.id,
      subscriberName: s.name,
      address: subscriberAddress(s),
      phone: s.phone ?? '',
    }))
    setSubscriberSearch('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!staff) return
    if (!form.subscriberId && !editing) return setFormError('Pick a subscriber.')
    if (!form.problem.trim()) return setFormError('Describe the problem.')
    const input: TaskInput = {
      subscriber_id: form.subscriberId,
      subscriber_name: form.subscriberName,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      problem: form.problem.trim(),
      possible_fixes: form.possibleFixes.trim() || null,
      notes: form.notes.trim() || null,
      priority: form.priority,
      assigned_to: form.assignedTo || null,
    }
    const techName = technicians.find((t) => t.id === input.assigned_to)?.username
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await updateTask(editing.id, input)
        logActivity(staff.id, `${staff.username} edited the task for ${input.subscriber_name}`, 'task', editing.id)
      } else {
        const id = await createTask(input, staff.id)
        logActivity(
          staff.id,
          `${staff.username} created a task for ${input.subscriber_name} (${input.priority} priority, ${
            techName ? `assigned to ${techName}` : 'any technician'
          }): ${input.problem}`,
          'task',
          id,
        )
      }
      setFormOpen(false)
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save task')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(task: TaskWithRelations) {
    if (!staff || !confirm(`Delete the task for ${task.subscriber_name}?`)) return
    try {
      await deleteTask(task.id)
      logActivity(staff.id, `${staff.username} deleted the task for ${task.subscriber_name}: ${task.problem}`, 'task', task.id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task')
    }
  }

  async function handleReopen(task: TaskWithRelations) {
    if (!staff || !confirm(`Reopen the task for ${task.subscriber_name}? It goes back on the technician's list.`)) return
    try {
      await setTaskStatus(task.id, 'open', task.report, staff.id)
      logActivity(
        staff.id,
        `${staff.username} reopened the task for ${task.subscriber_name} (was ${STATUS_LABEL[task.status]})`,
        'task',
        task.id,
      )
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen task')
    }
  }

  async function handleConfirmOrder(task: TaskWithRelations, order: TaskProductOrder, total: number | null, paid: number) {
    if (!staff) return
    try {
      await confirmTaskOrder(order.id, staff.id, total, paid)
      logActivity(
        staff.id,
        `${staff.username} confirmed ${orderLabel(order)} for ${task.subscriber_name} (task order${
          total != null ? `, price ${total}` : ''
        }, paid ${paid})`,
        'task',
        task.id,
      )
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm order')
    }
  }

  async function handleRejectOrder(task: TaskWithRelations, order: TaskProductOrder) {
    if (!staff || !confirm(`Reject ${orderLabel(order)}?`)) return
    try {
      await rejectTaskOrder(order.id, staff.id)
      logActivity(staff.id, `${staff.username} rejected ${orderLabel(order)} for ${task.subscriber_name} (task order)`, 'task', task.id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject order')
    }
  }

  function renderTask(task: TaskWithRelations) {
    const finishedTask = task.status === 'done' || task.status === 'cant_do'
    return (
      <div key={task.id} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <TaskHeading task={task} linkSubscriber />
          </div>
          {finishedTask ? (
            <button onClick={() => handleReopen(task)} title="Reopen" className="rounded-full bg-neutral-100 p-2 text-neutral-600">
              <RotateCcw size={14} />
            </button>
          ) : (
            <button onClick={() => openEdit(task)} title="Edit" className="rounded-full bg-neutral-100 p-2 text-neutral-600">
              <Pencil size={14} />
            </button>
          )}
          <button onClick={() => handleDelete(task)} title="Delete" className="rounded-full bg-red-50 p-2 text-red-600">
            <Trash2 size={14} />
          </button>
        </div>
        <TaskBody task={task} />
        <TaskOrders
          orders={task.task_product_orders}
          onConfirm={(o, total, paid) => handleConfirmOrder(task, o, total, paid)}
          onReject={(o) => handleRejectOrder(task, o)}
        />
        <TaskMeta task={task} />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-semibold text-neutral-900">Tasks</h1>
        <button
          onClick={openCreate}
          className="ml-auto flex items-center gap-1 rounded-full bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} /> New task
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Metric label="To do" value={unfinished.length} tone="text-neutral-900" />
        <Metric label="Done this month" value={metrics.doneThisMonth} tone="text-emerald-600" />
        <Metric label="Done in total" value={totals.done} tone="text-emerald-700" />
        <Metric label="Can't be done" value={totals.cantDo} tone="text-red-600" />
        <Metric label="Orders to confirm" value={metrics.pendingOrders} tone="text-amber-600" />
      </div>

      <div className="mb-3 flex gap-1 rounded-full bg-neutral-100 p-1">
        {(
          [
            ['todo', `To do (${unfinished.length})`],
            ['finished', `Finished (${finished.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
              tab === key ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      {tab === 'todo' && (
        <div className="space-y-2">
          {!loading && sortedUnfinished.length === 0 && (
            <p className={`${cardClass} text-sm text-neutral-500`}>No open tasks. Tap "New task" to add one.</p>
          )}
          {sortedUnfinished.map(renderTask)}
        </div>
      )}

      {tab === 'finished' && (
        <>
          <div className="mb-2 flex gap-1.5">
            {(
              [
                ['all', 'All'],
                ['done', 'Done'],
                ['cant_do', "Can't be done"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFinishedFilter(key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  finishedFilter === key ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {!loading && visibleFinished.length === 0 && (
              <p className={`${cardClass} text-sm text-neutral-500`}>Nothing finished yet.</p>
            )}
            {visibleFinished.map(renderTask)}
          </div>
          {finished.length >= 200 && (
            <p className="mt-2 text-xs text-neutral-400">Showing the latest 200 finished tasks.</p>
          )}
        </>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit task' : 'New task'}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">Subscriber</label>
            {form.subscriberName && (
              <p className="mb-1.5 text-sm font-semibold text-neutral-900">
                {form.subscriberName}
                {!form.subscriberId && editing ? ' (deleted subscriber)' : ''}
              </p>
            )}
            <div>
              <input
                value={subscriberSearch}
                onChange={(e) => setSubscriberSearch(e.target.value)}
                placeholder={form.subscriberName ? 'Search to change subscriber…' : 'Search by name or phone…'}
                className={inputClass}
              />
              {subscriberMatches.length > 0 && (
                <div className="mt-1 max-h-60 overflow-y-auto rounded-md border border-neutral-200 bg-white">
                  {subscriberMatches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => pickSubscriber(s)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                    >
                      <span className="text-neutral-900">{s.name}</span>
                      <span className="text-neutral-500"> {[s.phone, subscriberAddress(s)].filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                inputMode="tel"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">The problem</label>
            <textarea
              value={form.problem}
              onChange={(e) => setForm((f) => ({ ...f, problem: e.target.value }))}
              rows={3}
              required
              placeholder="Explain the problem to be solved"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">Possible ways to fix it</label>
            <textarea
              value={form.possibleFixes}
              onChange={(e) => setForm((f) => ({ ...f, possibleFixes: e.target.value }))}
              rows={2}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}
                className={inputClass}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">Technician</label>
              <select
                value={form.assignedTo}
                onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}
                className={inputClass}
              >
                <option value="">Any technician</option>
                {technicians
                  .filter((t) => t.is_active || t.id === form.assignedTo)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.username}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-neutral-400">
            A task still not done from a previous day is shown as High automatically.
            {editing ? ` Created ${formatDateTime(editing.created_at)}.` : ''}
          </p>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setFormOpen(false)} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={primaryButtonClass}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Create task'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
