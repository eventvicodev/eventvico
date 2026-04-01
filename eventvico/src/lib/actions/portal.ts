'use server'

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from '@/types/app'

type PortalLine = {
  id: string
  description: string
  quantity: number
  unitCostSnapshot: number
  lineType: 'inventory' | 'custom' | 'discount'
}

type PortalRevision = {
  id: string
  revisionNumber: number
  status: 'draft' | 'sent' | 'approved' | 'revision_requested' | 'locked'
  createdAt: string
  lines: PortalLine[]
}

type PortalSnapshot = {
  token: string
  quoteId: string
  client: {
    name: string
    email: string | null
    eventDate: string | null
    venue: string | null
  }
  quote: {
    title: string
    status: 'draft' | 'sent' | 'approved' | 'revision_requested' | 'locked'
    note: string | null
    discountType: 'percent' | 'fixed' | null
    discountValue: number
  }
  lines: PortalLine[]
  revisions: PortalRevision[]
  approvedAt: string | null
}

type FetchPortalSnapshotResult = ActionResult<PortalSnapshot>
type PortalDecisionResult = ActionResult<{ quoteId: string; status: 'approved' | 'revision_requested' }>
type PortalRefreshLinkResult = ActionResult<{ requested: true }>
type PortalOutboxClient = {
  from: (table: 'email_outbox') => {
    insert: (rows: Array<{
      tenant_id: string
      event_type: string
      recipient_email: string
      subject: string
      payload: Record<string, unknown>
      dedupe_key: string
    }>) => Promise<{ error: unknown }>
  }
}

type ResolvedToken = {
  tokenId: string
  token: string
  tenantId: string
  quoteId: string
  clientId: string | null
}

async function listStudioRecipientEmails(tenantId: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data: elevatedProfiles } = await admin
    .from('profiles')
    .select('id, role')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'admin'])

  const recipients = new Set<string>()
  for (const profile of elevatedProfiles ?? []) {
    const { data, error } = await admin.auth.admin.getUserById(profile.id)
    if (error) continue
    const email = data.user?.email?.trim().toLowerCase()
    if (email) recipients.add(email)
  }

  if (recipients.size > 0) return Array.from(recipients)

  const { data: fallbackProfiles } = await admin
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)

  for (const profile of fallbackProfiles ?? []) {
    const { data, error } = await admin.auth.admin.getUserById(profile.id)
    if (error) continue
    const email = data.user?.email?.trim().toLowerCase()
    if (email) recipients.add(email)
  }

  return Array.from(recipients)
}

async function resolvePortalToken(
  token: string,
  options?: { consumeOnUse?: boolean }
): Promise<ActionResult<ResolvedToken>> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('quote_share_tokens')
    .select('id, token, tenant_id, quote_id, client_id, expires_at, consumed_at')
    .eq('token', token)
    .maybeSingle()

  if (!data?.id) {
    return {
      success: false,
      error: { code: 'PORTAL_LINK_INVALID', message: 'This link is invalid. Request a new portal link.' },
    }
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    return {
      success: false,
      error: { code: 'PORTAL_LINK_EXPIRED', message: 'This link has expired. Request a new portal link.' },
    }
  }

  if (data.consumed_at) {
    return {
      success: false,
      error: { code: 'PORTAL_LINK_USED', message: 'This link has already been used. Request a new portal link.' },
    }
  }

  if (options?.consumeOnUse) {
    await admin
      .from('quote_share_tokens')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', data.id)
  }

  return {
    success: true,
    data: {
      tokenId: data.id,
      token: data.token,
      tenantId: data.tenant_id,
      quoteId: data.quote_id,
      clientId: data.client_id,
    },
  }
}

async function listQuoteLines(quoteId: string): Promise<PortalLine[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('quote_line_items')
    .select('id, description, quantity, unit_cost_snapshot, line_type')
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: true })

  return (data ?? []).map((line) => ({
    id: line.id,
    description: line.description,
    quantity: Number(line.quantity),
    unitCostSnapshot: Number(line.unit_cost_snapshot),
    lineType: line.line_type,
  }))
}

export async function fetchPortalSnapshot(input: unknown): Promise<FetchPortalSnapshotResult> {
  try {
    const token = ((input as { token?: string } | undefined)?.token ?? '').trim()
    if (!token) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing portal token.' } }
    }

    const resolved = await resolvePortalToken(token)
    if (!resolved.success) return resolved

    const admin = createAdminClient()
    const outboxClient = admin as unknown as PortalOutboxClient
    const { data: quote } = await admin
      .from('quotes')
      .select('id, title, status, note, discount_type, discount_value, root_quote_id, client_id')
      .eq('id', resolved.data.quoteId)
      .maybeSingle()

    if (!quote?.id) {
      return { success: false, error: { code: 'QUOTE_NOT_FOUND', message: 'Quote could not be found.' } }
    }

    const { data: client } = await admin
      .from('clients')
      .select('name, email, event_date, venue')
      .eq('id', quote.client_id ?? '00000000-0000-0000-0000-000000000000')
      .maybeSingle()

    const rootId = quote.root_quote_id ?? quote.id
    const { data: revisions } = await admin
      .from('quotes')
      .select('id, revision_number, status, created_at')
      .eq('tenant_id', resolved.data.tenantId)
      .or(`id.eq.${rootId},root_quote_id.eq.${rootId}`)
      .order('revision_number', { ascending: false })

    const revisionIds = (revisions ?? []).map((revision) => revision.id)
    const { data: revisionLines } = await admin
      .from('quote_line_items')
      .select('id, quote_id, description, quantity, unit_cost_snapshot, line_type')
      .in('quote_id', revisionIds.length > 0 ? revisionIds : ['00000000-0000-0000-0000-000000000000'])

    const linesByQuoteId = new Map<string, PortalLine[]>()
    for (const line of revisionLines ?? []) {
      const row: PortalLine = {
        id: line.id,
        description: line.description,
        quantity: Number(line.quantity),
        unitCostSnapshot: Number(line.unit_cost_snapshot),
        lineType: line.line_type,
      }
      const existing = linesByQuoteId.get(line.quote_id) ?? []
      existing.push(row)
      linesByQuoteId.set(line.quote_id, existing)
    }

    const { data: approvedAudit } = await admin
      .from('quote_audit_logs')
      .select('created_at')
      .eq('quote_id', quote.id)
      .eq('action_type', 'quote_approved')
      .order('created_at', { ascending: false })
      .limit(1)

    return {
      success: true,
      data: {
        token: resolved.data.token,
        quoteId: quote.id,
        client: {
          name: client?.name ?? 'Client',
          email: client?.email ?? null,
          eventDate: client?.event_date ?? null,
          venue: client?.venue ?? null,
        },
        quote: {
          title: quote.title,
          status: quote.status,
          note: quote.note,
          discountType: quote.discount_type,
          discountValue: Number(quote.discount_value ?? 0),
        },
        lines: await listQuoteLines(quote.id),
        revisions: (revisions ?? []).map((revision) => ({
          id: revision.id,
          revisionNumber: revision.revision_number ?? 1,
          status: revision.status,
          createdAt: revision.created_at,
          lines: linesByQuoteId.get(revision.id) ?? [],
        })),
        approvedAt: approvedAudit?.[0]?.created_at ?? null,
      },
    }
  } catch {
    return { success: false, error: { code: 'PORTAL_FETCH_FAILED', message: 'Could not load the client portal.' } }
  }
}

export async function approveQuoteFromPortal(input: unknown): Promise<PortalDecisionResult> {
  try {
    const token = ((input as { token?: string } | undefined)?.token ?? '').trim()
    const resolved = await resolvePortalToken(token, { consumeOnUse: true })
    if (!resolved.success) return resolved
    const recipientEmails = await listStudioRecipientEmails(resolved.data.tenantId)
    if (recipientEmails.length === 0) {
      return {
        success: false,
        error: { code: 'PORTAL_RECIPIENT_NOT_FOUND', message: 'Studio recipients are not configured for notifications.' },
      }
    }

    const admin = createAdminClient()
    const outboxClient = admin as unknown as PortalOutboxClient
    await admin
      .from('quotes')
      .update({ status: 'approved' })
      .eq('tenant_id', resolved.data.tenantId)
      .eq('id', resolved.data.quoteId)

    await admin.from('quote_audit_logs').insert({
      tenant_id: resolved.data.tenantId,
      quote_id: resolved.data.quoteId,
      action_type: 'quote_approved',
      action_payload: { source: 'portal' },
      performed_by: null,
    })

    await outboxClient.from('email_outbox').insert(
      recipientEmails.map((recipientEmail) => ({
        tenant_id: resolved.data.tenantId,
        event_type: 'quote_approved',
        recipient_email: recipientEmail,
        subject: 'Client approved quote',
        payload: { quoteId: resolved.data.quoteId, source: 'portal' },
        dedupe_key: `quote_approved_${resolved.data.quoteId}_${recipientEmail}`,
      }))
    )

    return { success: true, data: { quoteId: resolved.data.quoteId, status: 'approved' } }
  } catch {
    return { success: false, error: { code: 'PORTAL_APPROVAL_FAILED', message: 'Could not record approval.' } }
  }
}

export async function requestQuoteChangesFromPortal(input: unknown): Promise<PortalDecisionResult> {
  try {
    const parsed = (input as { token?: string; note?: string } | undefined) ?? {}
    const token = parsed.token?.trim() ?? ''
    const note = parsed.note?.trim() ?? ''

    if (!note) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Please add a note before requesting changes.' },
      }
    }

    const resolved = await resolvePortalToken(token, { consumeOnUse: true })
    if (!resolved.success) return resolved
    const recipientEmails = await listStudioRecipientEmails(resolved.data.tenantId)
    if (recipientEmails.length === 0) {
      return {
        success: false,
        error: { code: 'PORTAL_RECIPIENT_NOT_FOUND', message: 'Studio recipients are not configured for notifications.' },
      }
    }

    const admin = createAdminClient()
    const outboxClient = admin as unknown as PortalOutboxClient
    await admin
      .from('quotes')
      .update({ status: 'revision_requested' })
      .eq('tenant_id', resolved.data.tenantId)
      .eq('id', resolved.data.quoteId)

    await admin.from('quote_audit_logs').insert({
      tenant_id: resolved.data.tenantId,
      quote_id: resolved.data.quoteId,
      action_type: 'quote_change_requested',
      action_payload: { note },
      performed_by: null,
    })

    await outboxClient.from('email_outbox').insert(
      recipientEmails.map((recipientEmail) => ({
        tenant_id: resolved.data.tenantId,
        event_type: 'quote_change_requested',
        recipient_email: recipientEmail,
        subject: 'Client requested quote changes',
        payload: {
          quoteId: resolved.data.quoteId,
          note,
          textFallback: note,
        },
        dedupe_key: `quote_change_${resolved.data.quoteId}_${randomUUID()}`,
      }))
    )

    return { success: true, data: { quoteId: resolved.data.quoteId, status: 'revision_requested' } }
  } catch {
    return { success: false, error: { code: 'PORTAL_CHANGE_REQUEST_FAILED', message: 'Could not submit your feedback.' } }
  }
}

export async function requestNewPortalLink(input: unknown): Promise<PortalRefreshLinkResult> {
  try {
    const token = ((input as { token?: string } | undefined)?.token ?? '').trim()
    if (!token) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing portal token.' } }

    const admin = createAdminClient()
    const outboxClient = admin as unknown as PortalOutboxClient
    const { data } = await admin
      .from('quote_share_tokens')
      .select('tenant_id, quote_id, client_id')
      .eq('token', token)
      .maybeSingle()

    if (!data?.quote_id) {
      return { success: false, error: { code: 'PORTAL_LINK_INVALID', message: 'This link is invalid.' } }
    }
    const recipientEmails = await listStudioRecipientEmails(data.tenant_id)
    if (recipientEmails.length === 0) {
      return {
        success: false,
        error: { code: 'PORTAL_RECIPIENT_NOT_FOUND', message: 'Studio recipients are not configured for notifications.' },
      }
    }

    await admin.from('quote_audit_logs').insert({
      tenant_id: data.tenant_id,
      quote_id: data.quote_id,
      action_type: 'portal_link_refresh_requested',
      action_payload: {},
      performed_by: null,
    })

    await outboxClient.from('email_outbox').insert(
      recipientEmails.map((recipientEmail) => ({
        tenant_id: data.tenant_id,
        event_type: 'portal_link_refresh_requested',
        recipient_email: recipientEmail,
        subject: 'Client requested a new portal link',
        payload: { quoteId: data.quote_id },
        dedupe_key: `portal_refresh_${data.quote_id}_${randomUUID()}`,
      }))
    )

    return { success: true, data: { requested: true } }
  } catch {
    return { success: false, error: { code: 'PORTAL_LINK_REFRESH_FAILED', message: 'Could not request a new link.' } }
  }
}
