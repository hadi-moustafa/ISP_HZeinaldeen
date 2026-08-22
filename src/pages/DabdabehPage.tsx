import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, X, Banknote } from 'lucide-react'
import { useStaff } from '../context/StaffContext'
import { listCollectTrack, removeFromCollectTrack, reorderCollectTrack, type CollectTrackEntry } from '../lib/api/collectTrack'
import { listServices } from '../lib/api/services'
import { listCollectors } from '../lib/api/collectors'
import { listMonthlyLog } from '../lib/api/reports'
import type { SubscriberWithRelations } from '../types/subscribers'
import type { ServiceWithCompany, Collector } from '../types/reference'
import type { MonthlyLogRow } from '../types/reports'
import { AppHeader } from '../components/AppHeader'
import { PaymentModal } from '../components/subscriber/PaymentModal'
import { cardClass } from '../lib/uiClasses'

function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function statusDotColor(log: MonthlyLogRow | undefined, debt: number): string {
  if (log?.status === 'partial') return 'bg-orange-500'
  if (debt > 0) return 'bg-red-500'
  if (log?.status === 'paid' || log?.status === 'waived') return 'bg-emerald-500'
  if (log?.status === 'postponed') return 'bg-orange-500'
  return 'bg-neutral-300'
}

function SortableRow({
  entry,
  log,
  draggable,
  onRemove,
  onPay,
}: {
  entry: CollectTrackEntry
  log: MonthlyLogRow | undefined
  draggable: boolean
  onRemove: () => void
  onPay: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
    disabled: !draggable,
  })
  const sub = entry.subscriber

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2"
    >
      {draggable && (
        <button {...attributes} {...listeners} className="shrink-0 touch-none text-neutral-300" aria-label="Drag to reorder">
          <GripVertical size={16} />
        </button>
      )}
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(log, sub.debt)}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-neutral-900">{sub.name}</p>
        <p className="truncate text-xs text-neutral-500">
          {[sub.addresses?.name, sub.services?.companies?.name].filter(Boolean).join(' · ') || '—'}
          {sub.expiry_date ? ` · exp ${new Date(sub.expiry_date + 'T00:00:00').getUTCDate()}` : ''}
        </p>
      </div>
      <Link
        to={`/subscribers/${sub.id}/edit`}
        title="Edit subscriber"
        className="flex shrink-0 items-center justify-center rounded-full bg-neutral-100 p-2 text-neutral-600"
      >
        <Pencil size={14} />
      </Link>
      <button
        onClick={onPay}
        title="Log a payment"
        className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
      >
        <Banknote size={14} />
        Pay
      </button>
      <button onClick={onRemove} title="Remove from collect track" className="shrink-0 p-1 text-neutral-400">
        <X size={16} />
      </button>
    </div>
  )
}

export function DabdabehPage() {
  const { staff } = useStaff()
  const [entries, setEntries] = useState<CollectTrackEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [monthlyLogBySubscriber, setMonthlyLogBySubscriber] = useState<Record<string, MonthlyLogRow>>({})
  const [paymentSub, setPaymentSub] = useState<SubscriberWithRelations | null>(null)
  const [sortMode, setSortMode] = useState<'manual' | 'address'>('manual')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Manual order is drag-reordered and persisted via reorderCollectTrack;
  // address mode is a client-side sort only, so dragging is disabled while
  // it's active (there's no "position" to save against).
  const sortedEntries = useMemo(() => {
    if (sortMode !== 'address') return entries
    return [...entries].sort((a, b) =>
      (a.subscriber.addresses?.name ?? '').localeCompare(b.subscriber.addresses?.name ?? ''),
    )
  }, [entries, sortMode])

  function refresh() {
    if (!staff) return
    setLoading(true)
    listCollectTrack(staff.id)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load collect track'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    listServices().then(setServices).catch(() => {})
    listCollectors().then(setCollectors).catch(() => {})
    listMonthlyLog(currentPeriodMonth())
      .then((rows) => setMonthlyLogBySubscriber(Object.fromEntries(rows.map((row) => [row.subscriber_id, row]))))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id])

  async function handleRemove(subscriberId: string) {
    if (!staff) return
    setEntries((prev) => prev.filter((e) => e.subscriber.id !== subscriberId))
    try {
      await removeFromCollectTrack(staff.id, subscriberId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from collect track')
      refresh()
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!staff || !over || active.id === over.id || sortMode !== 'manual') return
    const oldIndex = entries.findIndex((e) => e.id === active.id)
    const newIndex = entries.findIndex((e) => e.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = [...entries]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    setEntries(reordered)
    try {
      await reorderCollectTrack(
        staff.id,
        reordered.map((e) => e.id),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save new order')
      refresh()
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader>
        <main className="p-3">
          <div className="mb-0.5 flex items-center gap-2">
            <h1 className="text-lg font-semibold text-neutral-900">Dabdabeh</h1>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
              {entries.length}
            </span>
          </div>
          <p className="mb-3 text-sm text-neutral-500">
            Your personal collect track
            {sortMode === 'manual' ? ' -- drag to reorder.' : ', sorted by address.'}
          </p>

          {entries.length > 0 && (
            <div className="mb-3 flex gap-1 rounded-full bg-neutral-100 p-1">
              <button
                type="button"
                onClick={() => setSortMode('manual')}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  sortMode === 'manual' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
                }`}
              >
                Manual order
              </button>
              <button
                type="button"
                onClick={() => setSortMode('address')}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  sortMode === 'address' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
                }`}
              >
                Sort by address
              </button>
            </div>
          )}

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          {loading && <p className="text-sm text-neutral-500">Loading…</p>}

          {!loading && entries.length === 0 && (
            <p className={`${cardClass} text-sm text-neutral-500`}>
              Nothing here yet -- select subscribers on the Subscribers page and use "Add to collect
              track".
            </p>
          )}

          {entries.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sortedEntries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {sortedEntries.map((entry) => (
                    <SortableRow
                      key={entry.id}
                      entry={entry}
                      log={monthlyLogBySubscriber[entry.subscriber.id]}
                      draggable={sortMode === 'manual'}
                      onRemove={() => handleRemove(entry.subscriber.id)}
                      onPay={() => setPaymentSub(entry.subscriber)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </main>
      </AppHeader>

      <PaymentModal
        subscriber={paymentSub}
        onClose={() => setPaymentSub(null)}
        onChanged={refresh}
        services={services}
        collectors={collectors}
        monthlyLog={paymentSub ? monthlyLogBySubscriber[paymentSub.id] : undefined}
      />
    </div>
  )
}
