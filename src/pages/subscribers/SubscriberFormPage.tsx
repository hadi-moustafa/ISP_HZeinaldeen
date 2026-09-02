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
import { listCompanies } from '../../lib/api/companies'
import { listAddresses } from '../../lib/api/addresses'
import { listRegions } from '../../lib/api/regions'
import { createPeriodInvoice } from '../../lib/api/invoices'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import type { Owner, Collector, ServiceWithCompany, Address, Region, Company } from '../../types/reference'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../../lib/uiClasses'

function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Adds one month, clamped to the target month's last day -- plain `Date`
// month arithmetic doesn't clamp (Jan 31 + 1 month rolls into March, not
// Feb 28), the same gotcha already solved server-side for auto-renewal in
// 0010_auto_renew_on_paid.sql.
function addOneMonthClamped(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const targetMonthFirst = new Date(y, m, 1) // m is already "next month" (0-indexed this month + 1)
  const lastDayOfTargetMonth = new Date(targetMonthFirst.getFullYear(), targetMonthFirst.getMonth() + 1, 0).getDate()
  const clampedDay = Math.min(d, lastDayOfTargetMonth)
  return localDateString(new Date(targetMonthFirst.getFullYear(), targetMonthFirst.getMonth(), clampedDay))
}

const emptyForm: SubscriberInput = {
  name: '',
  external_username: '',
  phone: '',
  nationality: null,
  building: '',
  address_id: '',
  region_id: '',
  service_id: '',
  company_id: '',
  owner_id: '',
  default_collector_id: '',
  connection_status: 'active',
  expiry_date: '',
  connection_date: '',
  notes: '',
  password: '',
  switch: '',
  mac_address: '',
  price: null,
  balance: null,
}

export function SubscriberFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { staff } = useStaff()

  const [owners, setOwners] = useState<Owner[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [addresses, setAddresses] = useState<Address[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [form, setForm] = useState<SubscriberInput>(emptyForm)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Expiry date auto-follows connection date + 1 month until the admin
  // manually edits expiry themselves -- then it stops auto-following.
  const [expiryTouched, setExpiryTouched] = useState(false)

  useEffect(() => {
    Promise.all([listOwners(), listCollectors(), listServices(), listCompanies(), listAddresses(), listRegions()])
      .then(([o, c, s, comp, addrs, rgs]) => {
        setOwners(o)
        setCollectors(c)
        setServices(s)
        setCompanies(comp)
        setAddresses(addrs)
        setRegions(rgs)
        if (!isEdit) {
          // Collector defaults to whoever is logged in, when they're a
          // collector account (has a linked collector_id) -- admin logins
          // have no personal collector, so it stays a manual optional pick.
          const today = localDateString(new Date())
          setForm((f) => ({
            ...f,
            default_collector_id: staff?.collectorId ?? '',
            connection_date: today,
            expiry_date: addOneMonthClamped(today),
          }))
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load form data'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredServices = form.company_id
    ? services.filter((s) => s.comp_id === form.company_id)
    : services
  const filteredRegions = form.address_id ? regions.filter((r) => r.address_id === form.address_id) : []

  useEffect(() => {
    if (!id) return
    getSubscriber(id)
      .then((sub) => {
        setForm({
          name: sub.name,
          external_username: sub.external_username ?? '',
          phone: sub.phone ?? '',
          nationality: sub.nationality,
          building: sub.building ?? '',
          address_id: sub.address_id ?? '',
          region_id: sub.region_id ?? '',
          service_id: sub.service_id ?? '',
          company_id: sub.company_id ?? '',
          owner_id: sub.owner_id ?? '',
          default_collector_id: sub.default_collector_id ?? '',
          connection_status: sub.connection_status,
          expiry_date: sub.expiry_date ?? '',
          connection_date: sub.connection_date ?? '',
          notes: sub.notes ?? '',
          password: sub.password ?? '',
          switch: sub.switch ?? '',
          mac_address: sub.mac_address ?? '',
          price: sub.price,
          balance: sub.balance,
        })
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load subscriber'))
      .finally(() => setLoading(false))
  }, [id])

  function update<K extends keyof SubscriberInput>(key: K, value: SubscriberInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function updateConnectionDate(value: string) {
    setForm((f) => ({
      ...f,
      connection_date: value,
      expiry_date: !isEdit && !expiryTouched && value ? addOneMonthClamped(value) : f.expiry_date,
    }))
  }

  function updateExpiryDate(value: string) {
    setExpiryTouched(true)
    update('expiry_date', value)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.company_id || !form.service_id || !form.address_id || !form.owner_id) {
      setError('Name, username, phone, company, service, address, building, and owner are all required.')
      return
    }
    setSaving(true)
    setError(null)
    const input: SubscriberInput = {
      ...form,
      phone: form.phone || null,
      nationality: form.nationality || null,
      building: form.building || null,
      address_id: form.address_id || null,
      region_id: form.region_id || null,
      service_id: form.service_id || null,
      company_id: form.company_id || null,
      owner_id: form.owner_id || null,
      default_collector_id: form.default_collector_id || null,
      expiry_date: form.expiry_date || null,
      connection_date: form.connection_date || null,
      notes: form.notes || null,
      password: form.password || null,
      switch: form.switch || null,
      mac_address: form.mac_address || null,
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
          await createPeriodInvoice(created.id, input.service_id, currentPeriodMonth())
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
        <div className="grid grid-cols-2 gap-3">
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Name"
            className={inputClass}
            required
          />
          <input
            value={form.external_username}
            onChange={(e) => update('external_username', e.target.value)}
            placeholder="Username"
            className={inputClass}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <input
            value={form.phone ?? ''}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="Phone"
            className={inputClass}
            required
          />
          <select
            value={form.nationality ?? ''}
            onChange={(e) => update('nationality', (e.target.value || null) as SubscriberInput['nationality'])}
            className={inputClass}
          >
            <option value="">Nationality</option>
            <option value="Lebanese">Lebanese</option>
            <option value="Syrian">Syrian</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <select
            value={form.address_id ?? ''}
            onChange={(e) => {
              const address_id = e.target.value
              // Region only makes sense scoped to its parent address --
              // switching (or clearing) the address invalidates whatever
              // region was previously chosen.
              setForm((f) => ({ ...f, address_id, region_id: '' }))
            }}
            className={inputClass}
            required
          >
            <option value="">Address</option>
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={form.region_id ?? ''}
            onChange={(e) => update('region_id', e.target.value)}
            className={inputClass}
            disabled={!form.address_id}
          >
            <option value="">{form.address_id ? 'Region (optional)' : 'Select an address first'}</option>
            {filteredRegions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <input
          value={form.building ?? ''}
          onChange={(e) => update('building', e.target.value)}
          placeholder="Building"
          className={inputClass}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <select
            value={form.company_id ?? ''}
            onChange={(e) => {
              const company_id = e.target.value
              // Clear the service if it no longer belongs to the newly
              // chosen company.
              setForm((f) => {
                const stillValid = services.find((s) => s.id === f.service_id)?.comp_id === company_id
                return { ...f, company_id, service_id: stillValid || !company_id ? f.service_id : '' }
              })
            }}
            className={inputClass}
            required
          >
            <option value="">Company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={form.service_id ?? ''}
            onChange={(e) => update('service_id', e.target.value)}
            className={inputClass}
            disabled={!form.company_id}
            required
          >
            <option value="">{form.company_id ? 'Service' : 'Select a company first'}</option>
            {filteredServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <select
            value={form.owner_id ?? ''}
            onChange={(e) => update('owner_id', e.target.value)}
            className={inputClass}
            required
          >
            <option value="">Owner</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            value={form.default_collector_id ?? ''}
            onChange={(e) => update('default_collector_id', e.target.value)}
            className={inputClass}
          >
            <option value="">Collector</option>
            {collectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <select
          value={form.connection_status}
          onChange={(e) => update('connection_status', e.target.value as SubscriberInput['connection_status'])}
          className={inputClass}
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <div className="grid grid-cols-2 gap-3">
          <input
            type="date"
            aria-label="Connection date"
            value={form.connection_date ?? ''}
            onChange={(e) => updateConnectionDate(e.target.value)}
            className={inputClass}
          />
          <input
            type="date"
            aria-label="Expiry date"
            value={form.expiry_date ?? ''}
            onChange={(e) => updateExpiryDate(e.target.value)}
            className={inputClass}
          />
        </div>

        {isEdit && (
          <>
            <textarea
              value={form.notes ?? ''}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Notes"
              className={inputClass}
              rows={3}
            />

            <h2 className="pt-2 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
              Technical &amp; billing details
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.password ?? ''}
                onChange={(e) => update('password', e.target.value)}
                placeholder="Password"
                className={inputClass}
              />
              <input
                value={form.switch ?? ''}
                onChange={(e) => update('switch', e.target.value)}
                placeholder="Switch"
                className={inputClass}
              />
            </div>

            <input
              value={form.mac_address ?? ''}
              onChange={(e) => update('mac_address', e.target.value)}
              placeholder="MAC address"
              className={inputClass}
            />
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.price ?? ''}
            onChange={(e) => update('price', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="Custom price (optional)"
            className={inputClass}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.balance ?? ''}
            onChange={(e) => update('balance', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="Balance (optional)"
            className={inputClass}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => navigate(-1)} className={secondaryButtonClass}>
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
