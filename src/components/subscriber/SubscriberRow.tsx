import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, Pencil, Clock, Loader2 } from 'lucide-react'
import { statusDotColor, expiryDay } from '../../lib/subscriberRowHelpers'
import type { SubscriberWithRelations } from '../../types/subscribers'
import type { MonthlyLogRow } from '../../types/reports'

// How long the left Pay button has to be held before it pays.
const HOLD_MS = 700

// Press and hold pays straight away; a quick tap only says how it works, so
// it can't take money by accident. Scrolling a phone cancels the press
// (pointercancel), and so does sliding off the button.
function HoldToPayButton({
  name,
  busy,
  onTap,
  onHold,
}: {
  name: string
  busy: boolean
  onTap: () => void
  onHold: () => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The click that follows a completed hold mustn't count as a tap.
  const held = useRef(false)
  const [pressing, setPressing] = useState(false)

  function stopTimer() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stopTimer, [])

  function startPress() {
    stopTimer()
    held.current = false
    setPressing(true)
    timer.current = setTimeout(() => {
      timer.current = null
      held.current = true
      setPressing(false)
      onHold()
    }, HOLD_MS)
  }

  function cancelPress() {
    stopTimer()
    setPressing(false)
  }

  const isActivationKey = (key: string) => key === 'Enter' || key === ' '

  return (
    <button
      type="button"
      disabled={busy}
      onPointerDown={(e) => {
        if (e.button === 0) startPress()
      }}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onKeyDown={(e) => {
        if (!isActivationKey(e.key)) return
        e.preventDefault()
        if (!e.repeat) startPress()
      }}
      onKeyUp={(e) => {
        if (!isActivationKey(e.key)) return
        e.preventDefault()
        const wasTap = timer.current !== null
        cancelPress()
        if (wasTap) onTap()
      }}
      onBlur={cancelPress}
      onClick={() => {
        if (!held.current) onTap()
        held.current = false
      }}
      // A long press on a phone would otherwise open the browser's own menu.
      onContextMenu={(e) => e.preventDefault()}
      title="Press and hold to pay this month's bill (cash)"
      aria-label={`Press and hold to pay ${name}`}
      style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
      className="relative shrink-0 select-none overflow-hidden rounded-full bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
    >
      {/* Fills while held, so it's clear the press is counting. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-emerald-800"
        style={{ width: pressing ? '100%' : 0, transition: pressing ? `width ${HOLD_MS}ms linear` : 'none' }}
      />
      <span className="relative">{busy ? <Loader2 size={14} className="animate-spin" /> : 'Pay'}</span>
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
  onHoldPay,
  onHoldPayTap,
  holdPaying = false,
  onPostpone,
  postponing = false,
  selected,
  onToggleSelect,
  showBuilding = false,
  showAddress = false,
}: {
  sub: SubscriberWithRelations
  log: MonthlyLogRow | undefined
  onPay: (sub: SubscriberWithRelations) => void
  // Adds the left-side hold-to-pay button (subscriber list only).
  onHoldPay?: (sub: SubscriberWithRelations) => void
  onHoldPayTap?: (sub: SubscriberWithRelations) => void
  holdPaying?: boolean
  onPostpone?: (sub: SubscriberWithRelations) => void
  postponing?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  // Building order: show each row's building, so the order is visible.
  showBuilding?: boolean
  // Address order: same, for the address.
  showAddress?: boolean
}) {
  const day = expiryDay(sub.expiry_date)
  // Two Pay buttons leave little width on a phone: wrap instead of cutting
  // off the name and expiry day, and shrink the right one to its icon.
  const textFit = onHoldPay ? 'line-clamp-2 break-words' : 'truncate'
  const statusBadge = (margin: string) =>
    sub.connection_status !== 'active' && (
      <span className={`${margin} rounded bg-neutral-200 px-1 py-0.5 text-[9px] font-medium uppercase text-neutral-600`}>
        {sub.connection_status}
      </span>
    )
  return (
    <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
      {onHoldPay && (
        <HoldToPayButton
          name={sub.name}
          busy={holdPaying}
          onTap={() => onHoldPayTap?.(sub)}
          onHold={() => onHoldPay(sub)}
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
          {!onHoldPay && statusBadge('ml-1.5')}
        </p>
        {/* Its own line, so it doesn't push the expiry day out of view. */}
        {showAddress && (
          <p className="truncate text-xs font-medium text-neutral-700">
            {[sub.addresses?.name, sub.building?.trim()].filter(Boolean).join(', ') || 'No address'}
          </p>
        )}
        <p className={`${textFit} text-xs text-neutral-500`}>
          {/* Here, not after the name, where wrapping could clip it. */}
          {onHoldPay && statusBadge('mr-1.5')}
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
          onHoldPay ? 'p-2' : 'px-3 py-1.5'
        }`}
      >
        <Banknote size={14} />
        {!onHoldPay && 'Pay'}
      </button>
    </div>
  )
}
