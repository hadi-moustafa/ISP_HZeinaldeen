import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  createSubscriber,
  getSubscriber,
  updateSubscriber,
  type SubscriberInput,
} from '../../lib/api/subscribers'
import { listOwners } from '../../lib/api/owners'
import { listCollectors } from '../../lib/api/collectors'
import { listServices } from '../../lib/api/services'
import { listRegions } from '../../lib/api/regions'
import { createInvoice } from '../../lib/api/invoices'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import type { Owner, Collector, ServiceWithCompany, Region } from '../../types/reference'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from '../../lib/uiClasses'

function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

const emptyForm: SubscriberInput = {
  name: '',
  phone: '',
  nationality: null,
  address: '',
  region_id: '',
  service_id: '',
  owner_id: '',
  default_collector_id: '',
  connection_status: 'active',
  expiry_date: '',
  connection_date: '',
  notes: '',
}

export function SubscriberFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { staff } = useStaff()

  const [owners, setOwners] = useState<Owner[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [form, setForm] = useState<SubscriberInput>(emptyForm)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listOwners(), listCollectors(), listServices(), listRegions()])
      .then(([o, c, s, r]) => {
        setOwners(o)
        setCollectors(c)
        setServices(s)
        setRegions(r)
        // New subscribers default to collector "hussien" -- client-specified
        // default. Only applies on create; editing an existing subscriber
        // never overwrites their already-set collector.
        if (!isEdit) {
          const hussien = c.find((col) => col.name.toLowerCase() === 'hussien')
          if (hussien) setForm((f) => ({ ...f, default_collector_id: hussien.id }))
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load form data'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!id) return
    getSubscriber(id)
      .then((sub) => {
        setForm({
          name: sub.name,
          phone: sub.phone ?? '',
          nationality: sub.nationality,
          address: sub.address ?? '',
          region_id: sub.region_id ?? '',
          service_id: sub.service_id ?? '',
          owner_id: sub.owner_id ?? '',
          default_collector_id: sub.default_collector_id ?? '',
          connection_status: sub.connection_status,
          expiry_date: sub.expiry_date ?? '',
          connection_date: sub.connection_date ?? '',
          notes: sub.notes ?? '',
        })
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load subscriber'))
      .finally(() => setLoading(false))
  }, [id])

  function update<K extends keyof SubscriberInput>(key: K, value: SubscriberInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const input: SubscriberInput = {
      ...form,
      phone: form.phone || null,
      nationality: form.nationality || null,
      address: form.address || null,
      region_id: form.region_id || null,
      service_id: form.service_id || null,
      owner_id: form.owner_id || null,
      default_collector_id: form.default_collector_id || null,
      expiry_date: form.expiry_date || null,
      connection_date: form.connection_date || null,
      notes: form.notes || null,
    }
    try {
      if (isEdit && id) {
        await updateSubscriber(id, input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited subscriber ${input.name}`, 'subscriber', id)
        navigate(`/subscribers/${id}`)
      } else {
        const created = await createSubscriber(input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created subscriber ${input.name}`, 'subscriber', created.id)

        // Bill them for the current period immediately -- otherwise they'd
        // have no invoice (and no working Pay button) until the next
        // monthly cron run.
        if (input.connection_status === 'active' && input.service_id) {
          const service = services.find((s) => s.id === input.service_id)
          if (service) {
            await createInvoice({
              subscriber_id: created.id,
              service_id: input.service_id,
              period_month: currentPeriodMonth(),
              amount_due: service.sell_price,
            })
          }
        }

        navigate(`/subscribers/${created.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save subscriber')
      setSaving(false)
    }
  }

  if (loading) return <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {isEdit ? 'Edit subscriber' : 'New subscriber'}
      </h1>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Name</label>
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className={inputClass}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Phone</label>
            <input
              value={form.phone ?? ''}
              onChange={(e) => update('phone', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Nationality</label>
            <select
              value={form.nationality ?? ''}
              onChange={(e) => update('nationality', (e.target.value || null) as SubscriberInput['nationality'])}
              className={inputClass}
            >
              <option value="">None</option>
              <option value="Lebanese">Lebanese</option>
              <option value="Syrian">Syrian</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Address</label>
            <input
              value={form.address ?? ''}
              onChange={(e) => update('address', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Region</label>
            <select
              value={form.region_id ?? ''}
              onChange={(e) => update('region_id', e.target.value)}
              className={inputClass}
            >
              <option value="">None</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Service</label>
          <select
            value={form.service_id ?? ''}
            onChange={(e) => update('service_id', e.target.value)}
            className={inputClass}
          >
            <option value="">None</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.companies?.name})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Owner</label>
            <select
              value={form.owner_id ?? ''}
              onChange={(e) => update('owner_id', e.target.value)}
              className={inputClass}
            >
              <option value="">None</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Default collector</label>
            <select
              value={form.default_collector_id ?? ''}
              onChange={(e) => update('default_collector_id', e.target.value)}
              className={inputClass}
            >
              <option value="">None</option>
              {collectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Connection status</label>
          <select
            value={form.connection_status}
            onChange={(e) =>
              update('connection_status', e.target.value as SubscriberInput['connection_status'])
            }
            className={inputClass}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Connection date</label>
            <input
              type="date"
              value={form.connection_date ?? ''}
              onChange={(e) => update('connection_date', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Expiry date</label>
            <input
              type="date"
              value={form.expiry_date ?? ''}
              onChange={(e) => update('expiry_date', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => update('notes', e.target.value)}
            className={inputClass}
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button type="submit" disabled={saving} className={primaryButtonClass}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
