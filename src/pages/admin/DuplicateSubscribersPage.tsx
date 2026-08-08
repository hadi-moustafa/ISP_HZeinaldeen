import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listDuplicateSubscribers, type DuplicateSubscriberGroup } from '../../lib/api/subscribers'
import { cardClass } from '../../lib/uiClasses'

const MATCH_LABEL: Record<DuplicateSubscriberGroup['matchType'], string> = {
  username: 'Same username',
  name: 'Same name',
}

export function DuplicateSubscribersPage() {
  const [groups, setGroups] = useState<DuplicateSubscriberGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listDuplicateSubscribers()
      .then(setGroups)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load duplicates'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Flagged duplicate subscribers
      </h1>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
        Subscribers sharing the same username or the same name — review and fix, merge, or delete
        the wrong one manually. Nothing here is changed automatically.
      </p>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      {!loading && groups.length === 0 && (
        <p className={`${cardClass} text-sm text-neutral-500 dark:text-neutral-400`}>
          Nothing flagged — no two subscribers share a username or name.
        </p>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={`${group.matchType}-${group.matchValue}`} className={cardClass}>
            <p className="mb-2 text-sm font-semibold text-amber-600 dark:text-amber-400">
              {MATCH_LABEL[group.matchType]}: "{group.matchValue}"
            </p>
            <div className="space-y-2">
              {group.subscribers.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between rounded-md bg-neutral-50 p-2 text-sm dark:bg-neutral-700/50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{sub.name}</p>
                    <p className="text-neutral-500 dark:text-neutral-400">
                      {sub.external_username ?? '—'} · {sub.phone ?? 'no phone'} ·{' '}
                      {sub.connection_status}
                    </p>
                  </div>
                  <Link
                    to={`/subscribers/${sub.id}`}
                    className="shrink-0 text-sm font-medium text-blue-600 dark:text-blue-400"
                  >
                    View
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
