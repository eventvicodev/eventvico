'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/types/app'

type TenantContextResult = ActionResult<{ tenantId: string; userId: string }>

type RequestDeletionResult = ActionResult<{ requestId: string; completed: boolean }>
type NotificationListResult = ActionResult<{
  notifications: Array<{
    id: string
    severity: 'info' | 'warning' | 'error' | 'success'
    title: string
    message: string
    createdAt: string
    readAt: string | null
  }>
}>
type LifecycleSweepResult = ActionResult<{ archivedCount: number; purgedCount: number }>

type OutboxFailureResult = ActionResult<{ outboxId: number; status: 'pending' | 'failed' }>

const EMAIL_MAX_RETRIES = 6

async function getTenantContext(): Promise<TenantContextResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    return { success: false, error: { code: 'AUTH_REQUIRED', message: 'Please sign in again.' } }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.tenant_id) {
    return { success: false, error: { code: 'TENANT_NOT_FOUND', message: 'Could not find your studio account.' } }
  }

  return { success: true, data: { tenantId: profile.tenant_id, userId: user.id } }
}

async function createNotification(input: {
  tenantId: string
  userId?: string | null
  severity: 'info' | 'warning' | 'error' | 'success'
  title: string
  message: string
  dedupeKey?: string
}) {
  const supabase = await createClient()
  await (supabase as any)
    .from('in_app_notifications')
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId ?? null,
      severity: input.severity,
      title: input.title,
      message: input.message,
      dedupe_key: input.dedupeKey ?? null,
    })
}

export async function requestClientDataDeletion(input: unknown): Promise<RequestDeletionResult> {
  try {
    const parsed = (input as { clientId?: string; confirmImpact?: boolean } | undefined) ?? {}
    const clientId = parsed.clientId?.trim() ?? ''
    const confirmImpact = parsed.confirmImpact === true

    if (!clientId) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing client id.' } }
    }

    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()

    const now = new Date().toISOString()
    const upcomingEvents = await (supabase as any)
      .from('event_metadata')
      .select('event_id, events!inner(start_at)')
      .eq('tenant_id', context.data.tenantId)
      .eq('client_id', clientId)
      .gte('events.start_at', now)

    if ((upcomingEvents.data ?? []).length > 0 && !confirmImpact) {
      return {
        success: false,
        error: {
          code: 'UPCOMING_EVENT_WARNING',
          message: 'This client has an upcoming event — deleting their data may affect fulfillment. Confirm to proceed.',
        },
      }
    }

    const { data: request } = await (supabase as any)
      .from('gdpr_deletion_requests')
      .insert({
        tenant_id: context.data.tenantId,
        client_id: clientId,
        requested_by: context.data.userId,
        status: 'processing',
        warning_acknowledged: confirmImpact,
      })
      .select('id')
      .single()

    if (!request?.id) {
      return { success: false, error: { code: 'GDPR_REQUEST_FAILED', message: 'Could not create deletion request.' } }
    }

    await supabase
      .from('clients')
      .update({
        name: 'Deleted Client',
        email: null,
        phone: null,
        venue: null,
      })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', clientId)

    await supabase
      .from('quotes')
      .update({ client_id: null })
      .eq('tenant_id', context.data.tenantId)
      .eq('client_id', clientId)

    await (supabase as any)
      .from('event_metadata')
      .update({ client_id: null })
      .eq('tenant_id', context.data.tenantId)
      .eq('client_id', clientId)

    await (supabase as any)
      .from('gdpr_deletion_requests')
      .update({ status: 'completed', processed_at: new Date().toISOString() })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', request.id)

    await createNotification({
      tenantId: context.data.tenantId,
      userId: context.data.userId,
      severity: 'success',
      title: 'GDPR deletion complete',
      message: 'Client personal data was removed and related records were anonymized.',
      dedupeKey: `gdpr_complete_${request.id}`,
    })

    return { success: true, data: { requestId: request.id, completed: true } }
  } catch {
    return { success: false, error: { code: 'GDPR_REQUEST_FAILED', message: 'Could not process deletion request.' } }
  }
}

export async function listStudioNotifications(): Promise<NotificationListResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data } = await (supabase as any)
      .from('in_app_notifications')
      .select('id, severity, title, message, created_at, read_at')
      .eq('tenant_id', context.data.tenantId)
      .order('created_at', { ascending: false })
      .limit(5)

    return {
      success: true,
      data: {
        notifications: (data ?? []).map((item: any) => ({
          id: item.id,
          severity: item.severity,
          title: item.title,
          message: item.message,
          createdAt: item.created_at,
          readAt: item.read_at,
        })),
      },
    }
  } catch {
    return { success: false, error: { code: 'NOTIFICATIONS_FETCH_FAILED', message: 'Could not load notifications.' } }
  }
}

export async function markNotificationRead(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const id = ((input as { id?: string } | undefined)?.id ?? '').trim()
    if (!id) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing notification id.' } }

    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()

    await (supabase as any)
      .from('in_app_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', id)

    return { success: true, data: { id } }
  } catch {
    return { success: false, error: { code: 'NOTIFICATION_UPDATE_FAILED', message: 'Could not update notification.' } }
  }
}

export async function recordOutboxDeliveryFailure(input: unknown): Promise<OutboxFailureResult> {
  try {
    const parsed = (input as { outboxId?: number; errorMessage?: string } | undefined) ?? {}
    const outboxId = Number(parsed.outboxId)
    const errorMessage = parsed.errorMessage?.trim() ?? 'Delivery failed'

    if (!Number.isFinite(outboxId) || outboxId <= 0) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid outbox id.' } }
    }

    const supabase = await createClient()
    const { data: row } = await (supabase as any)
      .from('email_outbox')
      .select('id, tenant_id, retry_count')
      .eq('id', outboxId)
      .maybeSingle()

    if (!row?.id) {
      return { success: false, error: { code: 'OUTBOX_NOT_FOUND', message: 'Outbox item not found.' } }
    }

    const retryCount = Number(row.retry_count ?? 0)
    const nextRetry = retryCount + 1
    const retryable = nextRetry < EMAIL_MAX_RETRIES

    if (retryable) {
      const delayMinutes = Math.min(240, Math.pow(2, retryCount) * 10)
      const nextAttemptAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()

      await (supabase as any)
        .from('email_outbox')
        .update({
          status: 'pending',
          retry_count: nextRetry,
          last_error: errorMessage,
          next_attempt_at: nextAttemptAt,
        })
        .eq('id', outboxId)

      return { success: true, data: { outboxId, status: 'pending' } }
    }

    await (supabase as any)
      .from('email_outbox')
      .update({
        status: 'failed',
        retry_count: nextRetry,
        last_error: errorMessage,
        failed_at: new Date().toISOString(),
      })
      .eq('id', outboxId)

    await createNotification({
      tenantId: row.tenant_id,
      severity: 'error',
      title: 'Email delivery failed',
      message: 'A transactional email failed permanently after retries. Please verify recipient details.',
      dedupeKey: `email_failure_${outboxId}`,
    })

    return { success: true, data: { outboxId, status: 'failed' } }
  } catch {
    return { success: false, error: { code: 'OUTBOX_FAILURE_UPDATE_FAILED', message: 'Could not update outbox failure.' } }
  }
}

export async function registerUploadedImageAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = (input as { storagePath?: string; clientId?: string | null; source?: string } | undefined) ?? {}
    const storagePath = parsed.storagePath?.trim() ?? ''
    const source = parsed.source?.trim() || 'client_upload'

    if (!storagePath) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing image storage path.' } }
    }

    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()

    const { data } = await (supabase as any)
      .from('image_assets')
      .insert({
        tenant_id: context.data.tenantId,
        uploaded_by: context.data.userId,
        client_id: parsed.clientId ?? null,
        source,
        storage_path: storagePath,
        lifecycle_state: 'active',
      })
      .select('id')
      .single()

    if (!data?.id) {
      return { success: false, error: { code: 'IMAGE_ASSET_CREATE_FAILED', message: 'Could not register image asset.' } }
    }

    return { success: true, data: { id: data.id } }
  } catch {
    return { success: false, error: { code: 'IMAGE_ASSET_CREATE_FAILED', message: 'Could not register image asset.' } }
  }
}

export async function runImageLifecycleSweep(input?: unknown): Promise<LifecycleSweepResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) return context

    const now = (input as { nowIso?: string } | undefined)?.nowIso
      ? new Date((input as { nowIso?: string }).nowIso as string)
      : new Date()

    const archiveCutoff = new Date(now)
    archiveCutoff.setMonth(archiveCutoff.getMonth() - 18)

    const purgeCutoff = new Date(now)
    purgeCutoff.setMonth(purgeCutoff.getMonth() - 24)

    const supabase = await createClient()
    const { data: toArchive } = await (supabase as any)
      .from('image_assets')
      .select('id')
      .eq('tenant_id', context.data.tenantId)
      .eq('lifecycle_state', 'active')
      .lt('uploaded_at', archiveCutoff.toISOString())

    const { data: toPurge } = await (supabase as any)
      .from('image_assets')
      .select('id')
      .eq('tenant_id', context.data.tenantId)
      .in('lifecycle_state', ['active', 'archived'])
      .lt('uploaded_at', purgeCutoff.toISOString())

    if ((toArchive ?? []).length > 0) {
      await (supabase as any)
        .from('image_assets')
        .update({ lifecycle_state: 'archived', archived_at: now.toISOString() })
        .eq('tenant_id', context.data.tenantId)
        .in('id', (toArchive ?? []).map((row: any) => row.id))
    }

    if ((toPurge ?? []).length > 0) {
      await (supabase as any)
        .from('image_assets')
        .update({ lifecycle_state: 'purged', purged_at: now.toISOString() })
        .eq('tenant_id', context.data.tenantId)
        .in('id', (toPurge ?? []).map((row: any) => row.id))
    }

    return {
      success: true,
      data: {
        archivedCount: (toArchive ?? []).length,
        purgedCount: (toPurge ?? []).length,
      },
    }
  } catch {
    return { success: false, error: { code: 'IMAGE_LIFECYCLE_SWEEP_FAILED', message: 'Could not run lifecycle sweep.' } }
  }
}
