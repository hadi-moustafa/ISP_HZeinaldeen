import { supabase } from '../supabase'

export interface CollectionFeedback {
  id: string
  subscriber_id: string | null
  subscriber_name: string
  feedback: string
  collector_id: string | null
  staff_id: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  collectors: { name: string } | null
  staff: { username: string } | null
  reviewer: { username: string } | null
}

const FEEDBACK_SELECT = '*, collectors(name), staff:staff!staff_id(username), reviewer:staff!reviewed_by(username)'

export async function createCollectionFeedback(input: {
  subscriberId: string
  subscriberName: string
  feedback: string
  collectorId: string | null
  staffId: string | null
}) {
  const { data, error } = await supabase
    .from('collection_feedback')
    .insert({
      subscriber_id: input.subscriberId,
      subscriber_name: input.subscriberName,
      feedback: input.feedback,
      collector_id: input.collectorId,
      staff_id: input.staffId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

// Newest first. Everything still to review, plus the latest reviewed ones.
export async function listCollectionFeedback(reviewedLimit = 300): Promise<CollectionFeedback[]> {
  const [pending, reviewed] = await Promise.all([
    supabase.from('collection_feedback').select(FEEDBACK_SELECT).is('reviewed_at', null).order('created_at', { ascending: false }),
    supabase
      .from('collection_feedback')
      .select(FEEDBACK_SELECT)
      .not('reviewed_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(reviewedLimit),
  ])
  if (pending.error) throw pending.error
  if (reviewed.error) throw reviewed.error
  return [...(pending.data as unknown as CollectionFeedback[]), ...(reviewed.data as unknown as CollectionFeedback[])]
}

// staffId = mark reviewed by them; null = back to "to review".
export async function setFeedbackReviewed(id: string, staffId: string | null) {
  const { error } = await supabase
    .from('collection_feedback')
    .update(staffId ? { reviewed_at: new Date().toISOString(), reviewed_by: staffId } : { reviewed_at: null, reviewed_by: null })
    .eq('id', id)
  if (error) throw error
}

export async function deleteCollectionFeedback(id: string) {
  const { error } = await supabase.from('collection_feedback').delete().eq('id', id)
  if (error) throw error
}
