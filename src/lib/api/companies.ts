import { supabase } from '../supabase'
import type { Company, CompanyAddress } from '../../types/reference'

export async function listCompanies() {
  const { data, error } = await supabase.from('companies').select('*').order('name')
  if (error) throw error
  return data as Company[]
}

export async function createCompany(input: { name: string; notes: string | null }) {
  const { data, error } = await supabase.from('companies').insert(input).select().single()
  if (error) throw error
  return data as Company
}

export async function updateCompany(id: string, input: { name: string; notes: string | null }) {
  const { data, error } = await supabase.from('companies').update(input).eq('id', id).select().single()
  if (error) throw error
  return data as Company
}

export async function deleteCompany(id: string) {
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}

export async function listCompanyAddresses(compId: string) {
  const { data, error } = await supabase
    .from('company_addresses')
    .select('*')
    .eq('comp_id', compId)
    .order('is_primary', { ascending: false })
  if (error) throw error
  return data as CompanyAddress[]
}

type AddressInput = {
  label: string | null
  line1: string | null
  line2: string | null
  city: string | null
  region: string | null
  country: string | null
  is_primary: boolean
}

export async function createCompanyAddress(compId: string, input: AddressInput) {
  const { data, error } = await supabase
    .from('company_addresses')
    .insert({ ...input, comp_id: compId })
    .select()
    .single()
  if (error) throw error
  return data as CompanyAddress
}

export async function updateCompanyAddress(id: string, input: AddressInput) {
  const { data, error } = await supabase
    .from('company_addresses')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as CompanyAddress
}

export async function deleteCompanyAddress(id: string) {
  const { error } = await supabase.from('company_addresses').delete().eq('id', id)
  if (error) throw error
}
