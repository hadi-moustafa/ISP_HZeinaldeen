import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, RotateCcw, Search, ChevronDown } from 'lucide-react'
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
import { compareTasks, effectivePriority, orderLabel, formatDateTime, STATUS_LABEL, PRIORITY_LABEL } from '../../lib/tasks'
import type { TaskInput, TaskPriority, TaskProductOrder, TaskWithRelations } from '../../types/tasks'
import { Modal } from '../../components/Modal'
import { TaskBody, TaskHeading, TaskMeta, TaskOrders } from '../../components/tasks/TaskDetails'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../../lib/uiClasses'

type Tab = 'todo' | 'done' | 'cant_do'

interface FormState {
  // false = a job for someone who isn't a subscriber: name typed by hand,
  // no subscriber link (and product orders aren't charged to an account).
  forSubscriber: boolean
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
  forSubscriber: true,
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

// Same compact row as the subscriber list: a status dot, name + problem,
// and the actions. Tap the text to open the full task. Module-level so a
// page re-render never resets which rows are open.
function TaskRow({
  task,
  onEdit,
  onReopen,
  onDelete,
  onConfirmOrder,
  onRejectOrder,
}: {
  task: TaskWithRelations
  onEdit: (t: TaskWithRelations) => void
  onReopen: (t: TaskWithRelations) => void
  onDelete: (t: TaskWithRelations) => void
  onConfirmOrder: (t: TaskWithRelations, o: TaskProductOrder, total: number | null, paid: number) => Promise<void>
  onRejectOrder: (t: TaskWithRelations, o: TaskProductOrder) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const finishedTask = task.status === 'done' || task.status === 'cant_do'
  const priority = effectivePriority(task)
  const pendingOrders = task.task_product_orders.filter((o) => o.status === 'requested').length
  const dot = finishedTask
    ? task.status === 'done'
      ? 'bg-green-500'
      : 'bg-red-500'
    : priority === 'urgent'
      ? 'bg-red-500'
      : priority === 'high'
        ? 'bg-orange-500'
        : 'bg-neutral-300'

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} title={finishedTask ? STATUS_LABEL[task.status] : PRIORITY_LABEL[priority]} />
        <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {task.subscriber_name}
            {task.status === 'half_done' && (
              <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium uppercase text-amber-700">half done</span>
            )}
            {pendingOrders > 0 && (
              <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium uppercase text-amber-700">
                {pendingOrders} order{pendingOrders > 1 ? 's' : ''}
              </span>
            )}
          </p>
          <p className="truncate text-xs text-neutral-500">
            {task.problem} · {task.assigned_staff?.username ?? 'any technician'}
          </p>
        </button>
        <ChevronDown size={14} className={`shrink-0 text-neutral-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        {finishedTask ? (
          <button onClick={() => onReopen(task)} title="Reopen" className="shrink-0 rounded-full bg-neutral-100 p-2 text-neutral-600">
            <RotateCcw size={14} />
          </button>
        ) : (
          <button onClick={() => onEdit(task)} title="Edit" className="shrink-0 rounded-full bg-neutral-100 p-2 text-neutral-600">
            <Pencil size={14} />
          </button>
        )}
        <button onClick={() => onDelete(task)} title="Delete" className="shrink-0 rounded-full bg-red-50 p-2 text-red-600">
          <Trash2 size={14} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-neutral-100 pt-2">
          <TaskHeading task={task} linkSubscriber />
          <TaskBody task={task} />
          <TaskOrders
            orders={task.task_product_orders}
            forSubscriber={task.subscriber_id != null}
            onConfirm={(o, total, paid) => onConfirmOrder(task, o, total, paid)}
            onReject={(o) => onRejectOrder(task, o)}
          />
          <TaskMeta task={task} />
        </div>
      )}
    </div>
  )
}

export function TasksPage() {
  const { staff } = useStaff()
  const [tab, setTab] = useState<Tab>('todo')
  const [search, setSearch] = useState('')
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

  // Search by name, phone, address or problem, within the selected chip.
  const visible = useMemo(() => {
    const rows = tab === 'todo' ? [...unfinished].sort(compareTasks) : finished.filter((t) => t.status === tab)
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((t) =>
      [t.subscriber_name, t.phone, t.address, t.problem].some((v) => (v ?? '').toLowerCase().includes(term)),
    )
  }, [tab, unfinished, finished, search])

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
      forSubscriber: task.subscriber_id != null,
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
    if (form.forSubscriber && !form.subscriberId) return setFormError('Pick a subscriber.')
    if (!form.subscriberName.trim()) return setFormError('Enter a name.')
    if (!form.problem.trim()) return setFormError('Describe the problem.')
    const input: TaskInput = {
      subscriber_id: form.forSubscriber ? form.subscriberId : null,
      subscriber_name: form.subscriberName.trim(),
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

  const chips: [Tab, string, number][] = [
    ['todo', 'To do', unfinished.length],
    ['done', 'Done', totals.done],
    ['cant_do', "Can't do", totals.cantDo],
  ]

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-indigo-500" />
          <h1 className="text-lg font-bold text-neutral-900">Tasks</h1>
        </div>
        <button
          onClick={openCreate}
          title="New task"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white shadow-sm active:bg-indigo-600"
        >
          <Plus size={18} strokeWidth={2.5} />
        </button>
      </div>

      <div className="mb-3 flex items-center rounded-full bg-white px-3 shadow-sm">
        <Search size={16} className="mr-2 shrink-0 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, address, problem…"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-neutral-900 outline-none"
        />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {chips.map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium shadow-sm ${
              tab === key ? 'bg-indigo-500 text-white' : 'bg-white text-neutral-700'
            }`}
          >
            {label} {count}
          </button>
        ))}
        {metrics.pendingOrders > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-700">
            {metrics.pendingOrders} order{metrics.pendingOrders > 1 ? 's' : ''} to confirm
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-500">{metrics.doneThisMonth} done this month</p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      <div className="space-y-1.5">
        {visible.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onEdit={openEdit}
            onReopen={handleReopen}
            onDelete={handleDelete}
            onConfirmOrder={handleConfirmOrder}
            onRejectOrder={handleRejectOrder}
          />
        ))}
        {!loading && visible.length === 0 && (
          <p className="text-sm text-neutral-500">
            {search.trim() ? 'No tasks match this search.' : tab === 'todo' ? 'No open tasks. Tap + to add one.' : 'Nothing here yet.'}
          </p>
        )}
      </div>
      {tab !== 'todo' && finished.length >= 200 && (
        <p className="mt-2 text-xs text-neutral-400">Showing the latest 200 finished tasks.</p>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit task' : 'New task'}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-1 rounded-full bg-neutral-100 p-1">
            {(
              [
                [true, 'Subscriber'],
                [false, 'Not a subscriber'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() =>
                  setForm((f) =>
                    f.forSubscriber === value
                      ? f
                      : { ...f, forSubscriber: value, subscriberId: null, subscriberName: '', address: '', phone: '' },
                  )
                }
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  form.forSubscriber === value ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {form.forSubscriber ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">Subscriber</label>
              {form.subscriberName && (
                <p className="mb-1.5 text-sm font-semibold text-neutral-900">{form.subscriberName}</p>
              )}
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
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">Name</label>
              <input
                value={form.subscriberName}
                onChange={(e) => setForm((f) => ({ ...f, subscriberName: e.target.value }))}
                placeholder="Who the job is for"
                required
                className={inputClass}
              />
            </div>
          )}

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
