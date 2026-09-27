import { useEffect, useMemo, useRef, useState } from 'react'
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
import { GripVertical, Pencil, X, Banknote, ChevronDown, CheckCircle2 } from 'lucide-react'
import { useStaff } from '../context/StaffContext'
import {
  listCollectTrack,
  removeFromCollectTrack,
  reorderCollectTrack,
  clearCollectTrack,
  type CollectTrackEntry,
} from '../lib/api/collectTrack'
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

// "Collected" means exactly what the green dot means: this period's invoice
// is paid (or waived) and nothing is still owed from earlier periods.
function isCollected(log: MonthlyLogRow | undefined, debt: number): boolean {
  return statusDotColor(log, debt) === 'bg-emerald-500'
}

// How long a just-paid row stays in the pending list, highlighted green,
// before sliding into the Collected dropdown -- long enough to see that the
// payment actually went through.
const JUST_PAID_MS = 1500

function SortableRow({
  entry,
  log,
  draggable,
  justPaid,
  onRemove,
  onPay,
}: {
  entry: CollectTrackEntry
  log: MonthlyLogRow | undefined
  draggable: boolean
  justPaid: boolean
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
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors duration-300 ${
        justPaid ? 'border-emerald-300 bg-emerald-50' : 'border-neutral-200 bg-white'
      }`}
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
      {justPaid ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white">
          <CheckCircle2 size={14} />
          Paid
        </span>
      ) : (
        <button
          onClick={onPay}
          title="Log a payment"
          className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Banknote size={14} />
          Pay
        </button>
      )}
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
  const [justPaidIds, setJustPaidIds] = useState<Set<string>>(new Set())
  const [collectedOpen, setCollectedOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)
  // Which subscriber the payment modal was opened for -- a ref, since the
  // modal calls onClose() (clearing paymentSub) before onChanged().
  const payingSubIdRef = useRef<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Only the not-yet-collected subscribers are in the main list (plus any
  // just-paid row still showing its green confirmation); collected ones
  // move into the Collected dropdown below it.
  const pendingEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          justPaidIds.has(e.subscriber.id) ||
          !isCollected(monthlyLogBySubscriber[e.subscriber.id], e.subscriber.debt),
      ),
    [entries, monthlyLogBySubscriber, justPaidIds],
  )
  const collectedEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          !justPaidIds.has(e.subscriber.id) &&
          isCollected(monthlyLogBySubscriber[e.subscriber.id], e.subscriber.debt),
      ),
    [entries, monthlyLogBySubscriber, justPaidIds],
  )

  // Manual order is drag-reordered and persisted via reorderCollectTrack;
  // address mode is a client-side sort only, so dragging is disabled while
  // it's active (there's no "position" to save against).
  const sortedEntries = useMemo(() => {
    if (sortMode !== 'address') return pendingEntries
    return [...pendingEntries].sort((a, b) =>
      (a.subscriber.addresses?.name ?? '').localeCompare(b.subscriber.addresses?.name ?? ''),
    )
  }, [pendingEntries, sortMode])

  // Track rows (for each subscriber's live debt) and this period's billing
  // status are refetched together, so a payment's effect shows up at once.
  async function refresh(showLoading = true) {
    if (!staff) return
    if (showLoading) setLoading(true)
    try {
      const [track, log] = await Promise.all([listCollectTrack(staff.id), listMonthlyLog(currentPeriodMonth())])
      const logBySub = Object.fromEntries(log.map((row) => [row.subscriber_id, row]))
      setEntries(track)
      setMonthlyLogBySubscriber(logBySub)
      return { track, logBySub }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collect track')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    listServices().then(setServices).catch(() => {})
    listCollectors().then(setCollectors).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id])

  async function handlePaymentChanged() {
    const subId = payingSubIdRef.current
    payingSubIdRef.current = null
    const result = await refresh(false)
    if (!subId || !result) return
    const entry = result.track.find((e) => e.subscriber.id === subId)
    if (!entry || !isCollected(result.logBySub[subId], entry.subscriber.debt)) return
    setJustPaidIds((prev) => new Set(prev).add(subId))
    setTimeout(() => {
      setJustPaidIds((prev) => {
        const next = new Set(prev)
        next.delete(subId)
        return next
      })
    }, JUST_PAID_MS)
  }

  function openPayment(sub: SubscriberWithRelations) {
    payingSubIdRef.current = sub.id
    setPaymentSub(sub)
  }

  async function handleFinishList() {
    if (!staff) return
    const remaining = pendingEntries.length
    const msg =
      remaining > 0
        ? `${remaining} subscriber${remaining > 1 ? 's are' : ' is'} still not collected. Close this list anyway?`
        : 'Close this list? You can then pick a new group of subscribers.'
    if (!confirm(msg)) return
    setFinishing(true)
    try {
      await clearCollectTrack(staff.id)
      setEntries([])
      setCollectedOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close the list')
    } finally {
      setFinishing(false)
    }
  }

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
              {collectedEntries.length}/{entries.length} collected
            </span>
            {entries.length > 0 && (
              <button
                onClick={handleFinishList}
                disabled={finishing}
                className={`ml-auto shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  pendingEntries.length === 0 ? 'bg-emerald-500 text-white' : 'bg-neutral-200 text-neutral-700'
                }`}
              >
                {finishing ? 'Closing…' : 'Finish list'}
              </button>
            )}
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

          {entries.length > 0 && pendingEntries.length === 0 && (
            <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              Everyone on this list is collected. Tap <span className="font-semibold">Finish list</span> to close it and
              pick a new group from the Subscribers page.
            </p>
          )}

          {pendingEntries.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sortedEntries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {sortedEntries.map((entry) => (
                    <SortableRow
                      key={entry.id}
                      entry={entry}
                      log={monthlyLogBySubscriber[entry.subscriber.id]}
                      draggable={sortMode === 'manual' && !justPaidIds.has(entry.subscriber.id)}
                      justPaid={justPaidIds.has(entry.subscriber.id)}
                      onRemove={() => handleRemove(entry.subscriber.id)}
                      onPay={() => openPayment(entry.subscriber)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {collectedEntries.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setCollectedOpen((v) => !v)}
                aria-expanded={collectedOpen}
                className="flex w-full items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800"
              >
                Collected ({collectedEntries.length})
                <ChevronDown
                  size={16}
                  className={`transition-transform duration-200 ${collectedOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {collectedOpen && (
                <div className="mt-1.5 space-y-1.5">
                  {collectedEntries.map((entry) => {
                    const log = monthlyLogBySubscriber[entry.subscriber.id]
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-neutral-900">{entry.subscriber.name}</p>
                          <p className="truncate text-xs text-neutral-500">
                            {[entry.subscriber.addresses?.name, entry.subscriber.services?.companies?.name]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </p>
                        </div>
                        {log && (
                          <span className="shrink-0 text-xs font-semibold text-emerald-600 tabular-nums">
                            {log.amount_paid}/{log.amount_due}
                          </span>
                        )}
                        <button
                          onClick={() => handleRemove(entry.subscriber.id)}
                          title="Remove from collect track"
                          className="shrink-0 p-1 text-neutral-400"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </AppHeader>

      <PaymentModal
        subscriber={paymentSub}
        onClose={() => setPaymentSub(null)}
        onChanged={handlePaymentChanged}
        services={services}
        collectors={collectors}
        monthlyLog={paymentSub ? monthlyLogBySubscriber[paymentSub.id] : undefined}
      />
    </div>
  )
}
