import { supabase } from '../supabase'
import type { Company, CompanyWithStats } from '../../types/reference'

export async function listCompanies() {
  const { data, error } = await supabase.from('companies').select('*').order('name')
  if (error) throw error
  return data as Company[]
}

// Only used by the admin Companies page (the subscriber count is specific
// to that view) -- every other call site just needs listCompanies() above.
export async function listCompaniesWithSubscriberCount(): Promise<CompanyWithStats[]> {
  const [companiesRes, subscribersRes] = await Promise.all([
    supabase.from('companies').select('*').order('name'),
    supabase.from('subscribers').select('company_id').not('company_id', 'is', null),
  ])
  if (companiesRes.error) throw companiesRes.error
  if (subscribersRes.error) throw subscribersRes.error

  const counts = new Map<string, number>()
  for (const row of subscribersRes.data as { company_id: string }[]) {
    counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1)
  }

  return (companiesRes.data as Company[]).map((c) => ({
    ...c,
    subscriber_count: counts.get(c.id) ?? 0,
  }))
}

export interface CompanyInput {
  name: string
  notes: string | null
  payment_phone: string | null
  support_phone: string | null
}

export async function createCompany(input: CompanyInput) {
  const { data, error } = await supabase.from('companies').insert(input).select().single()
  if (error) throw error
  return data as Company
}

export async function updateCompany(id: string, input: CompanyInput) {
  const { data, error } = await supabase.from('companies').update(input).eq('id', id).select().single()
  if (error) throw error
  return data as Company
}

export async function deleteCompany(id: string) {
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}
