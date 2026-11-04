import type { SubscriberWithRelations } from '../types/subscribers'
import { compareByExpiryDay } from './subscriberRowHelpers'

// How a subscriber list is ordered. Shared by the subscriber list and the
// dashboard search. Default is expiry day, smallest first; filtering by an
// address switches to building (client: within one address, walk the
// buildings in order).
export type SubscriberSort =
  | 'address_asc'
  | 'address_desc'
  | 'expiry_asc'
  | 'expiry_desc'
  | 'building_asc'
  | 'building_desc'
  | 'name_asc'
  | 'name_desc'

export const SORT_OPTIONS: { value: SubscriberSort; label: string }[] = [
  { value: 'address_asc', label: 'Address ↑' },
  { value: 'address_desc', label: 'Address ↓' },
  { value: 'expiry_asc', label: 'Expiry ↑' },
  { value: 'expiry_desc', label: 'Expiry ↓' },
  { value: 'building_asc', label: 'Building ↑' },
  { value: 'building_desc', label: 'Building ↓' },
  { value: 'name_asc', label: 'Name A→Z' },
  { value: 'name_desc', label: 'Name Z→A' },
]

// Buildings are free text, often with numbers in them ("Bldg 2", "Bldg 10",
// "Taleb 8ada"): compare numbers as numbers, so 2 comes before 10, and
// ignore case.
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareBuilding(a: SubscriberWithRelations, b: SubscriberWithRelations, dir: 1 | -1) {
  const ab = a.building?.trim() ?? ''
  const bb = b.building?.trim() ?? ''
  // No building always goes last, whichever direction.
  if (!ab || !bb) {
    if (ab || bb) return ab ? -1 : 1
  } else {
    const byBuilding = natural.compare(ab, bb)
    if (byBuilding !== 0) return byBuilding * dir
  }
  return natural.compare(a.name, b.name)
}

// Address, then region, then building, so a collector can walk the list. No
// address always goes last, whichever direction.
function compareAddress(a: SubscriberWithRelations, b: SubscriberWithRelations, dir: 1 | -1) {
  const aa = a.addresses?.name?.trim() ?? ''
  const ba = b.addresses?.name?.trim() ?? ''
  if (!aa || !ba) {
    if (aa || ba) return aa ? -1 : 1
  } else {
    const byAddress = natural.compare(aa, ba)
    if (byAddress !== 0) return byAddress * dir
  }
  const byRegion = natural.compare(a.regions?.name ?? '', b.regions?.name ?? '')
  if (byRegion !== 0) return byRegion * dir
  return compareBuilding(a, b, dir)
}

export function sortSubscribers(rows: SubscriberWithRelations[], mode: SubscriberSort): SubscriberWithRelations[] {
  const out = [...rows]
  switch (mode) {
    case 'address_asc':
      return out.sort((a, b) => compareAddress(a, b, 1))
    case 'address_desc':
      return out.sort((a, b) => compareAddress(a, b, -1))
    case 'building_asc':
      return out.sort((a, b) => compareBuilding(a, b, 1))
    case 'building_desc':
      return out.sort((a, b) => compareBuilding(a, b, -1))
    case 'name_asc':
      return out.sort((a, b) => natural.compare(a.name, b.name))
    case 'name_desc':
      return out.sort((a, b) => natural.compare(b.name, a.name))
    case 'expiry_desc':
      return out.sort(compareByExpiryDay).reverse()
    default:
      return out.sort(compareByExpiryDay)
  }
}

export function isAddressSort(mode: SubscriberSort) {
  return mode === 'address_asc' || mode === 'address_desc'
}

export function isBuildingSort(mode: SubscriberSort) {
  return mode === 'building_asc' || mode === 'building_desc'
}
