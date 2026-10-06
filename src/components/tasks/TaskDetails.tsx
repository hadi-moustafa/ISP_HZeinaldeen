import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Phone, Check, X } from 'lucide-react'
import type { TaskProductOrder, TaskWithRelations } from '../../types/tasks'
import {
  effectivePriority,
  isOverdueTask,
  isUnfinishedTask,
  formatDateTime,
  orderLabel,
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
} from '../../lib/tasks'

// Header of a task card: subscriber, priority (with the auto-bump for a
// task left from a previous day) and status.
export function TaskHeading({ task, linkSubscriber }: { task: TaskWithRelations; linkSubscriber?: boolean }) {
  const priority = effectivePriority(task)
  const bumped = priority !== task.priority
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {linkSubscriber && task.subscriber_id ? (
        <Link to={`/subscribers/${task.subscriber_id}`} className="font-semibold text-neutral-900 underline-offset-2 hover:underline">
          {task.subscriber_name}
        </Link>
      ) : (
        <span className="font-semibold text-neutral-900">{task.subscriber_name}</span>
      )}
      {isUnfinishedTask(task) && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_CLASS[priority]}`}
          title={bumped ? 'Raised automatically: waiting since a previous day' : undefined}
        >
          {PRIORITY_LABEL[priority]}
          {bumped ? ' · waiting' : ''}
        </span>
      )}
      {task.status !== 'open' && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[task.status]}`}>
          {STATUS_LABEL[task.status]}
        </span>
      )}
    </div>
  )
}

function Block({ label, text, tone = 'neutral' }: { label: string; text: string | null; tone?: 'neutral' | 'blue' }) {
  if (!text) return null
  return (
    <div className={`rounded-lg px-3 py-2 ${tone === 'blue' ? 'bg-blue-50' : 'bg-neutral-50'}`}>
      <p className={`text-xs font-semibold ${tone === 'blue' ? 'text-blue-700' : 'text-neutral-500'}`}>{label}</p>
      <p className="whitespace-pre-wrap text-sm text-neutral-800">{text}</p>
    </div>
  )
}

// The admin-written body of a task plus the technician's report.
// hideContact: the address/phone line is already shown elsewhere (the
// admin's collapsed task row).
export function TaskBody({ task, hideContact }: { task: TaskWithRelations; hideContact?: boolean }) {
  return (
    <div className="space-y-1.5">
      {!hideContact && (task.address || task.phone) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-700">
          {task.address && (
            <span className="flex items-center gap-1">
              <MapPin size={14} className="text-neutral-400" />
              {task.address}
            </span>
          )}
          {task.phone && (
            <a href={`tel:${task.phone}`} className="flex items-center gap-1 text-blue-600">
              <Phone size={14} />
              {task.phone}
            </a>
          )}
        </div>
      )}
      <Block label="Problem" text={task.problem} />
      <Block label="Possible fixes" text={task.possible_fixes} />
      <Block label="Notes" text={task.notes} />
      <Block label="Technician report" text={task.report} tone="blue" />
    </div>
  )
}

export function TaskMeta({ task }: { task: TaskWithRelations }) {
  return (
    <p className="text-xs text-neutral-400">
      Added {formatDateTime(task.created_at)}
      {task.assigned_staff ? ` · for ${task.assigned_staff.username}` : ' · any technician'}
      {isOverdueTask(task) ? ' · waiting since a previous day' : ''}
      {task.status !== 'open' && task.status_changed_at
        ? ` · ${STATUS_LABEL[task.status]} ${formatDateTime(task.status_changed_at)}${
            task.status_changed_staff ? ` by ${task.status_changed_staff.username}` : ''
          }`
        : ''}
    </p>
  )
}

const ORDER_STATUS_CLASS = {
  requested: 'bg-amber-100 text-amber-700',
  sold: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-neutral-200 text-neutral-500 line-through',
}
const ORDER_STATUS_LABEL = { requested: 'Waiting for admin', sold: 'Confirmed', rejected: 'Rejected' }


// Admin's confirm form for one pending order: price (blank = normal price,
// bundles need one) and cash taken now (0 = goes on the subscriber's
// account, collected through Pay; for a non-subscriber it's just an unpaid
// sale on the products page).
function ConfirmOrderRow({
  order,
  forSubscriber,
  onConfirm,
  onReject,
}: {
  order: TaskProductOrder
  forSubscriber: boolean
  onConfirm: (totalAmount: number | null, amountPaid: number) => Promise<void>
  onReject: () => Promise<void>
}) {
  const isBundle = order.products?.product_type === 'bundle'
  const [open, setOpen] = useState(false)
  const [price, setPrice] = useState(isBundle ? String(order.products?.sell_price ?? '') : '')
  const [paid, setPaid] = useState('0')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="flex w-full justify-end gap-1.5">
        <button
          onClick={() => setOpen(true)}
          disabled={busy}
          className="flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white"
        >
          <Check size={12} /> Confirm
        </button>
        <button
          onClick={() => run(onReject)}
          disabled={busy}
          className="flex items-center gap-1 rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-700"
        >
          <X size={12} /> Reject
        </button>
      </div>
    )
  }

  return (
    <div className="mt-1.5 flex w-full flex-wrap items-center gap-1.5">
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Normal price"
        className="w-28 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        title="Total charge -- leave blank for the normal price"
      />
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={paid}
        onChange={(e) => setPaid(e.target.value)}
        className="w-24 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        title={forSubscriber ? "Paid now (0 = add to the subscriber's account)" : 'Paid now (0 = unpaid)'}
      />
      <button
        disabled={busy || (isBundle && price.trim() === '')}
        onClick={() => run(() => onConfirm(price.trim() === '' ? null : Number(price), Number(paid) || 0))}
        className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Sell'}
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-neutral-500">
        Cancel
      </button>
      <p className="w-full text-xs text-neutral-400">
        Price (blank = normal) · paid now (0 = {forSubscriber ? 'add to their account' : 'unpaid'})
      </p>
    </div>
  )
}

export function TaskOrders({
  orders,
  forSubscriber = true,
  onDelete,
  onConfirm,
  onReject,
}: {
  orders: TaskProductOrder[]
  // false = the task isn't for a subscriber (no account to charge).
  forSubscriber?: boolean
  // Technician: withdraw a pending request.
  onDelete?: (order: TaskProductOrder) => void
  // Admin: turn a pending request into a real sale, or reject it.
  onConfirm?: (order: TaskProductOrder, totalAmount: number | null, amountPaid: number) => Promise<void>
  onReject?: (order: TaskProductOrder) => Promise<void>
}) {
  if (orders.length === 0) return null
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2">
      <p className="mb-1 text-xs font-semibold text-neutral-500">Product orders</p>
      <div className="space-y-1.5">
        {orders.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className={`min-w-0 flex-1 text-neutral-800 ${o.status === 'rejected' ? 'line-through opacity-60' : ''}`}>
              {orderLabel(o)}
              {o.note ? <span className="text-neutral-500"> -- {o.note}</span> : null}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_CLASS[o.status]}`}>
              {ORDER_STATUS_LABEL[o.status]}
            </span>
            {o.status === 'requested' && onDelete && (
              <button onClick={() => onDelete(o)} title="Remove request" className="p-1 text-neutral-400">
                <X size={14} />
              </button>
            )}
            {o.status === 'requested' && onConfirm && onReject && (
              <ConfirmOrderRow
                order={o}
                forSubscriber={forSubscriber}
                onConfirm={(total, paid) => onConfirm(o, total, paid)}
                onReject={() => onReject(o)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
