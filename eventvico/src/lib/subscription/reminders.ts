import { shouldQueueTrialReminder } from '@/lib/subscription/trial'
import type { Database } from '@/types/supabase'

type TenantRow = Database['public']['Tables']['tenants']['Row']

type OutboxInsertResult = {
  error: { code?: string } | null
}

type Awaitable<T> = T | PromiseLike<T>

type SupabaseOutboxClient = {
  from: (table: 'email_outbox') => {
    insert: (row: {
      tenant_id: string
      event_type: string
      recipient_email: string
      subject: string
      payload: Record<string, unknown>
      dedupe_key: string
    }) => Awaitable<OutboxInsertResult>
  }
}

type DueTaskReminderInput = {
  supabase: SupabaseOutboxClient
  tenantId: string
  tenantName: string
  activityId: string
  dueAt: string
  title: string
  recipientEmail: string
  now?: Date
}

type ReminderInput = {
  supabase: SupabaseOutboxClient
  tenant: Pick<TenantRow, 'id' | 'name' | 'plan_status' | 'trial_ends_at'>
  recipientEmail: string
  now?: Date
}

export async function enqueueTrialReminderIfNeeded({
  supabase,
  tenant,
  recipientEmail,
  now = new Date(),
}: ReminderInput): Promise<boolean> {
  if (!shouldQueueTrialReminder(tenant, now)) {
    return false
  }

  if (!recipientEmail) {
    return false
  }

  const trialEndsDate = tenant.trial_ends_at?.slice(0, 10) ?? 'unknown'
  const dedupeKey = `trial-expiry:${tenant.id}:${trialEndsDate}`

  const payload = {
    tenantName: tenant.name,
    trialEndsAt: tenant.trial_ends_at,
    daysRemaining: 3,
  }

  const outbox = supabase.from('email_outbox')
  const { error } = await outbox.insert({
    tenant_id: tenant.id,
    event_type: 'trial_expiry_3day',
    recipient_email: recipientEmail,
    subject: 'Your Eventvico trial ends in 3 days',
    payload,
    dedupe_key: dedupeKey,
  })

  if (!error) {
    return true
  }

  if (typeof error === 'object' && error && (error as { code?: string }).code === '23505') {
    return false
  }

  return false
}

export async function enqueueDueTaskReminderIfNeeded({
  supabase,
  tenantId,
  tenantName,
  activityId,
  dueAt,
  title,
  recipientEmail,
  now = new Date(),
}: DueTaskReminderInput): Promise<boolean> {
  if (!recipientEmail) return false
  const dueDate = new Date(dueAt)
  if (Number.isNaN(dueDate.getTime())) return false
  if (dueDate.getTime() > now.getTime()) return false

  const dedupeKey = `followup-due:${activityId}:${dueDate.toISOString()}`

  const { error } = await supabase.from('email_outbox').insert({
    tenant_id: tenantId,
    event_type: 'follow_up_reminder_due',
    recipient_email: recipientEmail,
    subject: 'A follow-up reminder is now due',
    payload: {
      tenantName,
      activityId,
      dueAt: dueDate.toISOString(),
      title,
    },
    dedupe_key: dedupeKey,
  })

  if (!error) return true
  if (typeof error === 'object' && error && (error as { code?: string }).code === '23505') {
    return false
  }
  return false
}
