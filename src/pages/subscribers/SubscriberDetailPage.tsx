import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getSubscriber, deleteSubscriber } from '../../lib/api/subscribers'
import type { SubscriberWithRelations } from '../../types/subscribers'
import type { Collector } from '../../types/reference'
import { listCollectors } from '../../lib/api/collectors'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import { InvoicesSection } from '../../components/subscriber/InvoicesSection'
import { secondaryButtonClass, dangerButtonClass, cardClass } from '../../lib/uiClasses'

const statusBadgeClass: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  cancelled: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
}

// created_at is a real timestamptz (not a date-only value), so local
// getters here are just for a readable "day it happened" display, not
// working around the date-only/toISOString timezone gotcha documented
// elsewhere in this codebase.
function formatCreatedDate(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function SubscriberDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { staff } = useStaff()

  const [subscriber, setSubscriber] = useState<SubscriberWithRelations | null>(null)
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [sub, cols] = await Promise.all([getSubscriber(id), listCollectors()])
      setSubscriber(sub)
      setCollectors(cols)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriber')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function remove() {
    if (!id || !subscriber) return
    if (!confirm(`Delete subscriber "${subscriber.name}"?`)) return
    try {
      await deleteSubscriber(id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted subscriber ${subscriber.name}`, 'subscriber', id)
      navigate('/subscribers')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete subscriber')
    }
  }

  if (loading) return <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>
  if (error && !subscriber) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!subscriber) return null

  return (
    <div>
      <Link to="/subscribers" className="mb-4 inline-block text-sm text-blue-600 dark:text-blue-400">
        ← Back to subscribers
      </Link>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className={cardClass}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {subscriber.name}
            </h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {subscriber.phone ?? '—'} {subscriber.nationality && `· ${subscriber.nationality}`}
            </p>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass[subscriber.connection_status]}`}
          >
            {subscriber.connection_status}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Service</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">
              {subscriber.services?.name ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Company</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">
              {subscriber.company?.name ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Owner</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">
              {subscriber.owners?.name ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Default collector</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">
              {subscriber.default_collector?.name ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Connection date</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">
              {subscriber.connection_date ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Created</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">
              {formatCreatedDate(subscriber.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Address</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{subscriber.address ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Region</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{subscriber.regions?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Building</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{subscriber.building ?? '—'}</dd>
          </div>
        </dl>

        {subscriber.notes && (
          <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">{subscriber.notes}</p>
        )}

        <h2 className="mb-2 mt-4 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
          Technical &amp; billing details
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Password</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{subscriber.password ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Switch</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{subscriber.switch ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">MAC address</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{subscriber.mac_address ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Price</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{subscriber.price ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Balance</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">{subscriber.balance ?? '—'}</dd>
          </div>
        </dl>

        <div className="mt-4 flex gap-2">
          <Link to={`/subscribers/${subscriber.id}/edit`} className={secondaryButtonClass}>
            Edit
          </Link>
          <button onClick={remove} className={dangerButtonClass}>
            Delete
          </button>
        </div>
      </div>

      <InvoicesSection
        subscriberId={subscriber.id}
        subscriberName={subscriber.name}
        subscriberPhone={subscriber.phone}
        defaultCollectorId={subscriber.default_collector_id}
        collectors={collectors}
        onChanged={refresh}
      />
    </div>
  )
}
