import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useStaff } from '../../context/StaffContext'
import {
  listCollectionFeedback,
  setFeedbackReviewed,
  deleteCollectionFeedback,
  type CollectionFeedback,
} from '../../lib/api/collectionFeedback'
import { logActivity } from '../../lib/api/activityLog'
import { formatDateTime } from '../../lib/tasks'

type Tab = 'pending' | 'reviewed'

// Feedback taken in the Pay modal while collecting, for the admin to go
// through: tick one off as reviewed (or undo), or delete it.
export function FeedbackPage() {
  const { staff } = useStaff()
  const [rows, setRows] = useState<CollectionFeedback[]>([])
  const [tab, setTab] = useState<Tab>('pending')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      setRows(await listCollectionFeedback())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feedback')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const pendingCount = rows.filter((r) => !r.reviewed_at).length
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows
      .filter((r) => (tab === 'pending' ? !r.reviewed_at : !!r.reviewed_at))
      .filter(
        (r) =>
          !term ||
          [r.subscriber_name, r.feedback, r.collectors?.name, r.staff?.username].some((v) =>
            (v ?? '').toLowerCase().includes(term),
          ),
      )
  }, [rows, tab, search])

  async function toggleReviewed(r: CollectionFeedback) {
    if (!staff) return
    try {
      await setFeedbackReviewed(r.id, r.reviewed_at ? null : staff.id)
      logActivity(
        staff.id,
        `${staff.username} ${r.reviewed_at ? 'reopened' : 'reviewed'} the collection feedback for ${r.subscriber_name}`,
        'feedback',
        r.id,
      )
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feedback')
    }
  }

  async function handleDelete(r: CollectionFeedback) {
    if (!staff || !confirm(`Delete this feedback for ${r.subscriber_name}?`)) return
    try {
      await deleteCollectionFeedback(r.id)
      logActivity(staff.id, `${staff.username} deleted the collection feedback for ${r.subscriber_name}: ${r.feedback}`, 'feedback', r.id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete feedback')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="h-5 w-1 rounded-full bg-indigo-500" />
        <h1 className="text-lg font-bold text-neutral-900">Collection feedback</h1>
      </div>

      <div className="mb-3 flex items-center rounded-full bg-white px-3 shadow-sm">
        <Search size={16} className="mr-2 shrink-0 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subscriber, feedback, collector…"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-neutral-900 outline-none"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ['pending', `To review ${pendingCount}`],
            ['reviewed', 'Reviewed'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium shadow-sm ${
              tab === key ? 'bg-indigo-500 text-white' : 'bg-white text-neutral-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      <div className="space-y-1.5">
        {visible.map((r) => (
          <div key={r.id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
            <div className="flex items-start gap-2">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.reviewed_at ? 'bg-green-500' : 'bg-amber-500'}`} />
              <div className="min-w-0 flex-1">
                {r.subscriber_id ? (
                  <Link to={`/subscribers/${r.subscriber_id}`} className="text-sm font-semibold text-neutral-900 hover:underline">
                    {r.subscriber_name}
                  </Link>
                ) : (
                  <span className="text-sm font-semibold text-neutral-900">{r.subscriber_name}</span>
                )}
                <p className="whitespace-pre-wrap text-sm text-neutral-800">{r.feedback}</p>
                <p className="text-xs text-neutral-400">
                  {formatDateTime(r.created_at)}
                  {r.collectors ? ` · collector ${r.collectors.name}` : ''}
                  {r.staff ? ` · by ${r.staff.username}` : ''}
                  {r.reviewed_at
                    ? ` · reviewed ${formatDateTime(r.reviewed_at)}${r.reviewer ? ` by ${r.reviewer.username}` : ''}`
                    : ''}
                </p>
              </div>
              <button
                onClick={() => toggleReviewed(r)}
                title={r.reviewed_at ? 'Back to "to review"' : 'Mark reviewed'}
                className={`shrink-0 rounded-full p-2 ${
                  r.reviewed_at ? 'bg-neutral-100 text-neutral-600' : 'bg-emerald-500 text-white'
                }`}
              >
                {r.reviewed_at ? <RotateCcw size={14} /> : <Check size={14} />}
              </button>
              <button onClick={() => handleDelete(r)} title="Delete" className="shrink-0 rounded-full bg-red-50 p-2 text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {!loading && visible.length === 0 && (
          <p className="text-sm text-neutral-500">
            {search.trim() ? 'No feedback matches this search.' : tab === 'pending' ? 'Nothing to review.' : 'Nothing reviewed yet.'}
          </p>
        )}
      </div>
    </div>
  )
}
