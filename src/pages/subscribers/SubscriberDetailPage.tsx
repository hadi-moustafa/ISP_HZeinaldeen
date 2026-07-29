import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  getSubscriber,
  deleteSubscriber,
  listSubscriberAddresses,
  createSubscriberAddress,
  updateSubscriberAddress,
  deleteSubscriberAddress,
} from '../../lib/api/subscribers'
import type { SubscriberAddress, SubscriberWithRelations } from '../../types/subscribers'
import type { Collector } from '../../types/reference'
import { listCollectors } from '../../lib/api/collectors'
import { Modal } from '../../components/Modal'
import { InvoicesSection } from '../../components/subscriber/InvoicesSection'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
  cardClass,
} from '../../lib/uiClasses'

const emptyAddressForm = {
  label: 'home',
  line1: '',
  line2: '',
  city: '',
  region: '',
  country: '',
  is_primary: false,
}

const statusBadgeClass: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  cancelled: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
}

export function SubscriberDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [subscriber, setSubscriber] = useState<SubscriberWithRelations | null>(null)
  const [addresses, setAddresses] = useState<SubscriberAddress[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [addressModalOpen, setAddressModalOpen] = useState(false)
  const [editingAddress, setEditingAddress] = useState<SubscriberAddress | null>(null)
  const [addressForm, setAddressForm] = useState(emptyAddressForm)

  async function refresh() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [sub, addr, cols] = await Promise.all([
        getSubscriber(id),
        listSubscriberAddresses(id),
        listCollectors(),
      ])
      setSubscriber(sub)
      setAddresses(addr)
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
    if (!confirm(`Delete subscriber "${subscriber.name}"? This also deletes their addresses.`))
      return
    try {
      await deleteSubscriber(id)
      navigate('/subscribers')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete subscriber')
    }
  }

  function openCreateAddress() {
    setEditingAddress(null)
    setAddressForm(emptyAddressForm)
    setAddressModalOpen(true)
  }

  function openEditAddress(address: SubscriberAddress) {
    setEditingAddress(address)
    setAddressForm({
      label: address.label ?? '',
      line1: address.line1 ?? '',
      line2: address.line2 ?? '',
      city: address.city ?? '',
      region: address.region ?? '',
      country: address.country ?? '',
      is_primary: address.is_primary,
    })
    setAddressModalOpen(true)
  }

  async function submitAddress(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    const input = {
      label: addressForm.label || null,
      line1: addressForm.line1 || null,
      line2: addressForm.line2 || null,
      city: addressForm.city || null,
      region: addressForm.region || null,
      country: addressForm.country || null,
      is_primary: addressForm.is_primary,
    }
    try {
      if (editingAddress) {
        await updateSubscriberAddress(editingAddress.id, input)
      } else {
        await createSubscriberAddress(id, input)
      }
      setAddressModalOpen(false)
      setAddresses(await listSubscriberAddresses(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save address')
    }
  }

  async function removeAddress(addressId: string) {
    if (!id) return
    if (!confirm('Delete this address?')) return
    try {
      await deleteSubscriberAddress(addressId)
      setAddresses(await listSubscriberAddresses(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete address')
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
              {subscriber.phone ?? '—'} {subscriber.national_id && `· ID ${subscriber.national_id}`}
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
              {subscriber.services?.companies?.name ?? '—'}
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
            <dt className="text-neutral-500 dark:text-neutral-400">Expiry date</dt>
            <dd className="text-neutral-900 dark:text-neutral-100">
              {subscriber.expiry_date ?? '—'}
            </dd>
          </div>
        </dl>

        {subscriber.notes && (
          <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">{subscriber.notes}</p>
        )}

        <div className="mt-4 flex gap-2">
          <Link to={`/subscribers/${subscriber.id}/edit`} className={secondaryButtonClass}>
            Edit
          </Link>
          <button onClick={remove} className={dangerButtonClass}>
            Delete
          </button>
        </div>
      </div>

      <h2 className="mb-3 mt-6 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
        Addresses
      </h2>
      <div className="space-y-2">
        {addresses.map((address) => (
          <div
            key={address.id}
            className="flex items-start justify-between rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          >
            <div>
              <p className="font-medium text-neutral-800 dark:text-neutral-100">
                {address.label}
                {address.is_primary && (
                  <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    primary
                  </span>
                )}
              </p>
              <p className="text-neutral-500 dark:text-neutral-400">
                {[address.line1, address.city, address.region, address.country]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => openEditAddress(address)}
                className="text-blue-600 dark:text-blue-400"
              >
                Edit
              </button>
              <button
                onClick={() => removeAddress(address.id)}
                className="text-red-600 dark:text-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {addresses.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No addresses yet.</p>
        )}
        <button onClick={openCreateAddress} className="text-sm text-blue-600 dark:text-blue-400">
          + Add address
        </button>
      </div>

      <Modal
        open={addressModalOpen}
        onClose={() => setAddressModalOpen(false)}
        title={editingAddress ? 'Edit address' : 'New address'}
      >
        <form onSubmit={submitAddress}>
          <label className={labelClass}>Label</label>
          <input
            value={addressForm.label}
            onChange={(e) => setAddressForm((f) => ({ ...f, label: e.target.value }))}
            className={`${inputClass} mb-4`}
            placeholder="home, work, installation..."
          />
          <label className={labelClass}>Address line 1</label>
          <input
            value={addressForm.line1}
            onChange={(e) => setAddressForm((f) => ({ ...f, line1: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <label className={labelClass}>Address line 2</label>
          <input
            value={addressForm.line2}
            onChange={(e) => setAddressForm((f) => ({ ...f, line2: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>City</label>
              <input
                value={addressForm.city}
                onChange={(e) => setAddressForm((f) => ({ ...f, city: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Region</label>
              <input
                value={addressForm.region}
                onChange={(e) => setAddressForm((f) => ({ ...f, region: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>
          <label className={labelClass}>Country</label>
          <input
            value={addressForm.country}
            onChange={(e) => setAddressForm((f) => ({ ...f, country: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <label className="mb-4 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={addressForm.is_primary}
              onChange={(e) => setAddressForm((f) => ({ ...f, is_primary: e.target.checked }))}
            />
            Primary address
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddressModalOpen(false)}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass}>
              Save
            </button>
          </div>
        </form>
      </Modal>

      <InvoicesSection
        subscriberId={subscriber.id}
        subscriberName={subscriber.name}
        subscriberPhone={subscriber.phone}
        defaultCollectorId={subscriber.default_collector_id}
        collectors={collectors}
      />
    </div>
  )
}
