import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, CheckCircle2, Pencil, X } from 'lucide-react'
import { useStaff } from '../../context/StaffContext'
import {
  listOpenManagement,
  listDoneManagement,
  updateManagementEntry,
  finishManagementEntry,
  removeManagementEntry,
  formatDateTime,
  type ManagementEntry,
} from '../../lib/api/management'
import { logActivity } from '../../lib/api/activityLog'
import { cardClass } from '../../lib/uiClasses'

function parseFee(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

function describe(notes: string | null, fee: number | null): string {
  const parts = []
  if (notes) parts.push(`notes: "${notes}"`)
  if (fee != null) parts.push(`fee collected: $${fee}`)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

function OpenCard({
  entry,
  onSaved,
  onDone,
  onRemove,
}: {
  entry: ManagementEntry
  onSaved: (entry: ManagementEntry) => void
  onDone: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { staff } = useStaff()
  const sub = entry.subscriber
  const [notes, setNotes] = useState(entry.notes ?? '')
  const [feeText, setFeeText] = useState(entry.fee != null ? String(entry.fee) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cleanNotes = notes.trim() || null
  const fee = parseFee(feeText)
  const dirty = cleanNotes !== (entry.notes ?? null) || fee !== entry.fee

  async function handleSave() {
    if (!staff) return
    if (Number.isNaN(fee)) return setError('Fee must be a number')
    setBusy(true)
    setError(null)
    try {
      await updateManagementEntry(entry.id, { notes: cleanNotes, fee })
      logActivity(
        staff.id,
        `${staff.username} updated management details for ${sub.name}${describe(cleanNotes, fee) || ' (cleared)'}`,
        'management',
        entry.id,
      )
      onSaved({ ...entry, notes: cleanNotes, fee })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  async function handleDone() {
    if (!staff) return
    if (Number.isNaN(fee)) return setError('Fee must be a number')
    if (!confirm(`Mark ${sub.name} as done?`)) return
    setBusy(true)
    setError(null)
    try {
      const doneAt = await finishManagementEntry(entry.id, staff.id, { notes: cleanNotes, fee })
      logActivity(
        staff.id,
        `${staff.username} marked ${sub.name} as done in Management on ${formatDateTime(doneAt)}` +
          ` (added ${formatDateTime(entry.added_at)})${describe(cleanNotes, fee)}`,
        'management',
        entry.id,
      )
      onDone(entry.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as done')
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!staff) return
    if (!confirm(`Remove ${sub.name} from Management without marking it done?`)) return
    setBusy(true)
    try {
      await removeManagementEntry(entry.id)
      logActivity(
        staff.id,
        `${staff.username} removed ${sub.name} from Management (not done)${describe(entry.notes, entry.fee)}`,
        'management',
        entry.id,
      )
      onRemove(entry.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-white p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">{sub.name}</p>
          <p className="truncate text-xs text-neutral-500">
            {[sub.addresses?.name, sub.services?.companies?.name, sub.phone].filter(Boolean).join(' · ') || '—'}
          </p>
          <p className="text-xs text-neutral-400">
            Added {formatDateTime(entry.added_at)}
            {entry.added_by_staff ? ` by ${entry.added_by_staff.username}` : ''}
          </p>
        </div>
        <Link
          to={`/subscribers/${sub.id}`}
          title="Open subscriber"
          className="flex shrink-0 items-center justify-center rounded-full bg-neutral-100 p-2 text-neutral-600"
        >
          <Pencil size={14} />
        </Link>
        <button onClick={handleRemove} disabled={busy} title="Remove" className="shrink-0 p-1 text-neutral-400">
          <X size={16} />
        </button>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes (optional) -- what was done: cable fix, switch fix, ..."
        className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={feeText}
          onChange={(e) => setFeeText(e.target.value)}
          placeholder="Fee collected (optional)"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        {dirty && (
          <button
            onClick={handleSave}
            disabled={busy}
            className="shrink-0 rounded-full bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50"
          >
            Save
          </button>
        )}
        <button
          onClick={handleDone}
          disabled={busy}
          className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          <CheckCircle2 size={14} />
          Done
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function ManagementPage() {
  const [open, setOpen] = useState<ManagementEntry[]>([])
  const [done, setDone] = useState<ManagementEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [doneOpen, setDoneOpen] = useState(false)

  async function refresh() {
    try {
      const [o, d] = await Promise.all([listOpenManagement(), listDoneManagement()])
      setOpen(o)
      setDone(d)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load management list')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <div>
      <div className="mb-0.5 flex items-center gap-2">
        <h1 className="text-lg font-semibold text-blue-700">Management</h1>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
          {open.length} open
        </span>
      </div>
      <p className="mb-3 text-sm text-neutral-500">
        Subscribers being worked on. Add notes and any fee collected, then tap Done. Everything is saved in the
        Activity Log.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      {!loading && open.length === 0 && (
        <p className={`${cardClass} text-sm text-neutral-500`}>
          Nothing open -- select subscribers on the Subscribers page and use "Add to management".
        </p>
      )}

      <div className="space-y-2">
        {open.map((entry) => (
          <OpenCard
            key={entry.id}
            entry={entry}
            onSaved={(updated) => setOpen((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))}
            onDone={() => refresh()}
            onRemove={(id) => setOpen((prev) => prev.filter((e) => e.id !== id))}
          />
        ))}
      </div>

      {done.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setDoneOpen((v) => !v)}
            aria-expanded={doneOpen}
            className="flex w-full items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800"
          >
            Done ({done.length}{done.length === 50 ? ', latest' : ''})
            <ChevronDown size={16} className={`transition-transform duration-200 ${doneOpen ? 'rotate-180' : ''}`} />
          </button>
          {doneOpen && (
            <div className="mt-1.5 space-y-1.5">
              {done.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/subscribers/${entry.subscriber.id}`}
                      className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900"
                    >
                      {entry.subscriber.name}
                    </Link>
                    {entry.fee != null && (
                      <span className="shrink-0 text-xs font-semibold text-emerald-600 tabular-nums">${entry.fee}</span>
                    )}
                  </div>
                  {entry.notes && <p className="whitespace-pre-wrap text-xs text-neutral-700">{entry.notes}</p>}
                  <p className="text-xs text-neutral-400">
                    Added {formatDateTime(entry.added_at)}
                    {entry.added_by_staff ? ` by ${entry.added_by_staff.username}` : ''} · Done{' '}
                    {entry.done_at ? formatDateTime(entry.done_at) : ''}
                    {entry.done_by_staff ? ` by ${entry.done_by_staff.username}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
