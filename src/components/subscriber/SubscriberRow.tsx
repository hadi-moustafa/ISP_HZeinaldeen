import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, Pencil, Clock, Loader2 } from 'lucide-react'
import { statusDotColor, expiryDay } from '../../lib/subscriberRowHelpers'
import type { SubscriberWithRelations } from '../../types/subscribers'
import type { MonthlyLogRow } from '../../types/reports'

// How long to wait for a second tap before treating it as a single tap.
const DOUBLE_TAP_MS = 300

// One tap opens the popup, two taps pay straight away. Counts clicks itself
// rather than using onDoubleClick, since a single tap has to wait to see
// whether a second one follows (otherwise the popup would cover the button).
function QuickPayButton({
  name,
  busy,
  onSingleTap,
  onDoubleTap,
}: {
  name: string
  busy: boolean
  onSingleTap: () => void
  onDoubleTap: () => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function handleClick() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      onDoubleTap()
      return
    }
    timer.current = setTimeout(() => {
      timer.current = null
      onSingleTap()
    }, DOUBLE_TAP_MS)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title="Tap to open Pay. Tap twice to pay this month's bill right away (cash)."
      aria-label={`Pay ${name}`}
      style={{ touchAction: 'manipulation' }}
      className="shrink-0 rounded-full bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : 'Pay'}
    </button>
  )
}

// Compact subscriber row shared by the dashboard's search results and the
// subscriber list, so both look and behave the same. Module-level (not
// nested inside a page component) so a parent re-render never remounts
// every row and resets the list's scroll position.
export function SubscriberRow({
  sub,
  log,
  onPay,
  onQuickPay,
  quickPaying = false,
  onPostpone,
  postponing = false,
  selected,
  onToggleSelect,
  showBuilding = false,
}: {
  sub: SubscriberWithRelations
  log: MonthlyLogRow | undefined
  onPay: (sub: SubscriberWithRelations) => void
  // Adds the left-side Pay button (subscriber list only).
  onQuickPay?: (sub: SubscriberWithRelations) => void
  quickPaying?: boolean
  onPostpone?: (sub: SubscriberWithRelations) => void
  postponing?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  // Building order: show each row's building, so the order is visible.
  showBuilding?: boolean
}) {
  const day = expiryDay(sub.expiry_date)
  // Two Pay buttons leave little width on a phone: wrap instead of cutting
  // off the name and expiry day, and shrink the right one to its icon.
  const textFit = onQuickPay ? 'line-clamp-2 break-words' : 'truncate'
  return (
    <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
      {onQuickPay && (
        <QuickPayButton
          name={sub.name}
          busy={quickPaying}
          onSingleTap={() => onPay(sub)}
          onDoubleTap={() => onQuickPay(sub)}
        />
      )}
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect(sub.id)}
          aria-label={`Select ${sub.name}`}
          className="h-4 w-4 shrink-0 rounded border-neutral-300 text-indigo-600"
        />
      )}
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(log, sub.debt)}`} />
      <Link to={`/subscribers/${sub.id}`} className="min-w-0 flex-1">
        <p className={`${textFit} text-sm font-semibold text-neutral-900`}>
          {sub.name}
          {sub.connection_status !== 'active' && (
            <span className="ml-1.5 rounded bg-neutral-200 px-1 py-0.5 text-[9px] font-medium uppercase text-neutral-600">
              {sub.connection_status}
            </span>
          )}
        </p>
        <p className={`${textFit} text-xs text-neutral-500`}>
          {showBuilding && <span className="font-medium text-neutral-700">{sub.building?.trim() || 'No building'} · </span>}
          {sub.services?.companies?.name ?? '—'}
          {day !== null ? ` · exp ${day}` : ''}
        </p>
      </Link>
      <Link
        to={`/subscribers/${sub.id}/edit`}
        title="Edit subscriber"
        className="flex shrink-0 items-center justify-center rounded-full bg-neutral-100 p-2 text-neutral-600"
      >
        <Pencil size={14} />
      </Link>
      {onPostpone && (
        <button
          onClick={() => onPostpone(sub)}
          disabled={postponing}
          title="Postpone payment"
          className="flex shrink-0 items-center justify-center rounded-full bg-amber-100 p-2 text-amber-700 disabled:opacity-50"
        >
          <Clock size={14} />
        </button>
      )}
      <button
        onClick={() => onPay(sub)}
        title="Log a payment"
        aria-label="Log a payment"
        className={`flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 text-xs font-semibold text-white ${
          onQuickPay ? 'p-2' : 'px-3 py-1.5'
        }`}
      >
        <Banknote size={14} />
        {!onQuickPay && 'Pay'}
      </button>
    </div>
  )
}
