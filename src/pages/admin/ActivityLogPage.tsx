import { useEffect, useState } from 'react'
import { listActivityLog } from '../../lib/api/activityLog'
import type { ActivityLogEntryWithStaff } from '../../types/activityLog'
import { inputClass, cardClass } from '../../lib/uiClasses'

function formatWhen(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntryWithStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(100)

  useEffect(() => {
    setLoading(true)
    setError(null)
    listActivityLog(limit)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load activity log'))
      .finally(() => setLoading(false))
  }, [limit])

  const filtered = search.trim()
    ? entries.filter((e) => e.summary.toLowerCase().includes(search.trim().toLowerCase()))
    : entries

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Activity log</h1>
      <p className="mb-4 text-sm text-neutral-500">
        A plain-English history of what's happened in the app.
      </p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search activity…"
        className={`${inputClass} mb-4`}
      />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-neutral-500">Loading…</p>}

      <div className="space-y-2">
        {filtered.map((entry) => (
          <div key={entry.id} className={cardClass}>
            <p className="text-sm text-neutral-800">{entry.summary}</p>
            <p className="mt-1 text-xs text-neutral-400">{formatWhen(entry.created_at)}</p>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="text-neutral-500">
            {search.trim() ? 'No matching activity.' : 'No activity recorded yet.'}
          </p>
        )}
      </div>

      {!loading && entries.length >= limit && !search.trim() && (
        <button
          onClick={() => setLimit((l) => l + 100)}
          className="mt-4 text-sm font-medium text-blue-600"
        >
          Load more
        </button>
      )}
    </div>
  )
}
