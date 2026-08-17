import { supabase } from '../supabase'
import type { MessageTemplate, MessageTemplateKey } from '../../types/messageTemplates'

export async function listMessageTemplates() {
  const { data, error } = await supabase.from('message_templates').select('*').order('key')
  if (error) throw error
  return data as MessageTemplate[]
}

export async function updateMessageTemplate(key: MessageTemplateKey, template: string) {
  const { data, error } = await supabase
    .from('message_templates')
    .update({ template })
    .eq('key', key)
    .select()
    .single()
  if (error) throw error
  return data as MessageTemplate
}
