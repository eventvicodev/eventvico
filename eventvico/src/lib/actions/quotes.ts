'use server'

import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/types/app'
import type { Json } from '@/types/supabase'
import { getTenantContext, TenantContextResult } from './tenant-context'

type QuoteLine = {
  id: string
  description: string
  quantity: number
  unitCostSnapshot: number
  currentUnitCost: number
  hasPriceDelta: boolean
  lineType: 'inventory' | 'custom' | 'discount'
}

type QuoteSummary = {
  id: string
  title: string
  clientId: string | null
  status: 'draft' | 'sent' | 'approved' | 'revision_requested' | 'locked'
  note: string | null
  discountType: 'percent' | 'fixed' | null
  discountValue: number
  rootQuoteId: string | null
  revisionNumber: number
  lines: QuoteLine[]
}

type QuoteAuditEntry = {
  id: string
  quoteId: string
  actionType: string
  actionPayload: Record<string, unknown>
  performedBy: string | null
  createdAt: string
}

type FetchQuotesResult = ActionResult<{ quotes: QuoteSummary[] }>
type FetchQuoteBuilderSnapshotResult = ActionResult<{
  clients: Array<{ id: string; name: string; email: string | null; eventDate: string | null }>
  recipes: Array<{ id: string; name: string }>
  quotes: QuoteSummary[]
}>
type CreateQuoteFromRecipesResult = ActionResult<{ quoteId: string; lineCount: number }>
type SaveQuoteLineItemsResult = ActionResult<{ quoteId: string; lineCount: number }>
type AddQuoteCustomItemResult = ActionResult<{ quoteId: string; lineId: string }>
type SetQuoteDiscountAndNoteResult = ActionResult<{ quoteId: string }>
type SendQuoteToClientResult = ActionResult<{ quoteId: string; shareToken: string }>
type CreateQuoteRevisionResult = ActionResult<{ quoteId: string; rootQuoteId: string; revisionNumber: number }>
type SetQuoteLockStateResult = ActionResult<{ quoteId: string; status: 'draft' | 'locked' }>
type FetchQuoteAuditLogResult = ActionResult<{ entries: QuoteAuditEntry[] }>
type BuildQuotePdfResult = ActionResult<{ filename: string; contentBase64: string }>
type BuildShareableLinkResult = ActionResult<{ url: string; expiresAt: string }>

function sanitizePdfText(value: string) {
  return value.replace(/[^\x20-\x7E]/g, ' ')
}

function escapePdfText(value: string) {
  return sanitizePdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildSimplePdfBase64(lines: string[]) {
  const maxLines = 45
  const printableLines = lines.slice(0, maxLines)
  if (lines.length > maxLines) {
    printableLines[maxLines - 1] = `${printableLines[maxLines - 1]} ...`
  }

  const streamLines = ['BT', '/F1 12 Tf', '14 TL', '50 760 Td']
  for (const [index, line] of printableLines.entries()) {
    if (index > 0) streamLines.push('T*')
    streamLines.push(`(${escapePdfText(line)}) Tj`)
  }
  streamLines.push('ET')
  const streamContent = streamLines.join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(streamContent, 'ascii')} >>\nstream\n${streamContent}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'ascii').toString('base64')
}


async function appendQuoteAuditEntry(
  tenantId: string,
  quoteId: string,
  actionType: string,
  actionPayload: Json,
  performedBy: string
) {
  const supabase = await createClient()
  await supabase.from('quote_audit_logs').insert({
    tenant_id: tenantId,
    quote_id: quoteId,
    action_type: actionType,
    action_payload: actionPayload,
    performed_by: performedBy,
  })
}

async function fetchQuotesScoped(tenantId: string): Promise<QuoteSummary[]> {
  const supabase = await createClient()

  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, title, client_id, status, note, discount_type, discount_value, root_quote_id, revision_number')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const quoteIds = (quotes ?? []).map((quote) => quote.id)
  const { data: lines } = await supabase
    .from('quote_line_items')
    .select('id, quote_id, inventory_item_id, description, quantity, unit_cost_snapshot, line_type')
    .eq('tenant_id', tenantId)
    .in('quote_id', quoteIds.length > 0 ? quoteIds : ['00000000-0000-0000-0000-000000000000'])

  const inventoryIds = Array.from(new Set((lines ?? []).map((line) => line.inventory_item_id)))
  const { data: inventoryItems } = await supabase
    .from('inventory_items')
    .select('id, cost')
    .in('id', inventoryIds.length > 0 ? inventoryIds : ['00000000-0000-0000-0000-000000000000'])

  const currentCostByInventoryId = new Map((inventoryItems ?? []).map((item) => [item.id, Number(item.cost)]))
  const linesByQuoteId = new Map<string, QuoteLine[]>()

  for (const line of lines ?? []) {
    const snapshot = Number(line.unit_cost_snapshot)
    const current = currentCostByInventoryId.get(line.inventory_item_id) ?? snapshot
    const mapped: QuoteLine = {
      id: line.id,
      description: line.description,
      quantity: Number(line.quantity),
      unitCostSnapshot: snapshot,
      currentUnitCost: current,
      hasPriceDelta: snapshot !== current,
      lineType: line.line_type,
    }
    const existing = linesByQuoteId.get(line.quote_id) ?? []
    existing.push(mapped)
    linesByQuoteId.set(line.quote_id, existing)
  }

  return (quotes ?? []).map((quote) => ({
    id: quote.id,
    title: quote.title,
    clientId: quote.client_id,
    status: quote.status,
    note: quote.note,
    discountType: quote.discount_type,
    discountValue: Number(quote.discount_value ?? 0),
    rootQuoteId: quote.root_quote_id,
    revisionNumber: quote.revision_number ?? 1,
    lines: linesByQuoteId.get(quote.id) ?? [],
  }))
}

async function enforceQuoteLocks(tenantId: string, userId: string) {
  const supabase = await createClient()
  const { data: tenants } = await supabase
    .from('tenants')
    .select('lock_window_days')
    .eq('id', tenantId)
    .maybeSingle()
  const lockWindowDays = Number(tenants?.lock_window_days ?? 10)

  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, status, client_id')
    .eq('tenant_id', tenantId)
    .in('status', ['draft', 'sent', 'revision_requested'])

  const clientIds = Array.from(new Set((quotes ?? []).map((item) => item.client_id).filter(Boolean) as string[]))
  const { data: clients } = await supabase
    .from('clients')
    .select('id, event_date')
    .eq('tenant_id', tenantId)
    .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])

  const clientEventDateById = new Map((clients ?? []).map((client) => [client.id, client.event_date]))
  const now = Date.now()

  for (const quote of quotes ?? []) {
    if (!quote.client_id) continue
    const eventDate = clientEventDateById.get(quote.client_id)
    if (!eventDate) continue

    const diffDays = (new Date(eventDate).getTime() - now) / (1000 * 60 * 60 * 24)
    if (diffDays <= lockWindowDays && quote.status !== 'locked') {
      await supabase
        .from('quotes')
        .update({ status: 'locked', locked_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('id', quote.id)

      await appendQuoteAuditEntry(
        tenantId,
        quote.id,
        'quote_locked_auto',
        { lockWindowDays, eventDate },
        userId
      )
    }
  }
}

export async function fetchQuotesWithPricing(): Promise<FetchQuotesResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) return context

    return {
      success: true,
      data: { quotes: await fetchQuotesScoped(context.data.tenantId) },
    }
  } catch {
    return {
      success: false,
      error: { code: 'QUOTES_FETCH_FAILED', message: 'Could not load quotes.' },
    }
  }
}

export async function fetchQuoteBuilderSnapshot(): Promise<FetchQuoteBuilderSnapshotResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) return context

    await enforceQuoteLocks(context.data.tenantId, context.data.userId)
    const supabase = await createClient()
    const [{ data: clients }, { data: recipes }] = await Promise.all([
      supabase
        .from('clients')
        .select('id, name, email, event_date')
        .eq('tenant_id', context.data.tenantId)
        .order('name', { ascending: true }),
      supabase
        .from('recipes')
        .select('id, name')
        .eq('tenant_id', context.data.tenantId)
        .order('created_at', { ascending: false }),
    ])

    return {
      success: true,
      data: {
        clients: (clients ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          email: item.email,
          eventDate: item.event_date,
        })),
        recipes: (recipes ?? []).map((item) => ({ id: item.id, name: item.name })),
        quotes: await fetchQuotesScoped(context.data.tenantId),
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'QUOTE_SNAPSHOT_FETCH_FAILED',
        message: 'Could not load quote builder data.',
      },
    }
  }
}

export async function createQuoteFromRecipes(input: unknown): Promise<CreateQuoteFromRecipesResult> {
  try {
    const parsed = (input as { clientId?: string; recipeIds?: string[]; title?: string } | undefined) ?? {}
    const clientId = parsed.clientId?.trim() ?? ''
    const recipeIds = (parsed.recipeIds ?? []).map((id) => id.trim()).filter(Boolean)
    const title = parsed.title?.trim() || `Quote ${new Date().toLocaleDateString('en-US')}`

    if (!clientId || recipeIds.length === 0) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Select a client and at least one recipe.' },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()

    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .insert({
        tenant_id: context.data.tenantId,
        created_by: context.data.userId,
        client_id: clientId,
        title,
        status: 'draft',
        revision_number: 1,
      })
      .select('id')
      .single()

    if (quoteError || !quote?.id) {
      return {
        success: false,
        error: { code: 'QUOTE_CREATE_FAILED', message: 'Could not create quote.' },
      }
    }

    const { data: recipeItems } = await supabase
      .from('recipe_items')
      .select('inventory_item_id, quantity')
      .eq('tenant_id', context.data.tenantId)
      .in('recipe_id', recipeIds)

    const inventoryIds = Array.from(new Set((recipeItems ?? []).map((item) => item.inventory_item_id)))
    const { data: inventoryItems } = await supabase
      .from('inventory_items')
      .select('id, name, cost')
      .eq('tenant_id', context.data.tenantId)
      .in('id', inventoryIds.length > 0 ? inventoryIds : ['00000000-0000-0000-0000-000000000000'])

    const inventoryById = new Map((inventoryItems ?? []).map((item) => [item.id, item]))
    const quantityByInventoryId = new Map<string, number>()
    for (const item of recipeItems ?? []) {
      quantityByInventoryId.set(item.inventory_item_id, (quantityByInventoryId.get(item.inventory_item_id) ?? 0) + Number(item.quantity))
    }

    const payload = Array.from(quantityByInventoryId.entries()).flatMap(([inventoryItemId, quantity]) => {
      const inventory = inventoryById.get(inventoryItemId)
      if (!inventory) return []
      return [{
        tenant_id: context.data.tenantId,
        quote_id: quote.id,
        inventory_item_id: inventoryItemId,
        description: inventory.name,
        quantity: Number(quantity.toFixed(2)),
        unit_cost_snapshot: Number(inventory.cost),
        line_type: 'inventory' as const,
      }]
    })

    if (payload.length > 0) {
      const { error } = await supabase.from('quote_line_items').insert(payload)
      if (error) {
        return {
          success: false,
          error: { code: 'QUOTE_LINE_ITEMS_CREATE_FAILED', message: 'Could not populate quote line items from recipes.' },
        }
      }
    }

    await appendQuoteAuditEntry(
      context.data.tenantId,
      quote.id,
      'quote_created',
      { recipeIds, lineCount: payload.length },
      context.data.userId
    )

    return { success: true, data: { quoteId: quote.id, lineCount: payload.length } }
  } catch {
    return { success: false, error: { code: 'QUOTE_CREATE_FAILED', message: 'Could not create quote.' } }
  }
}

export async function saveQuoteLineItems(input: unknown): Promise<SaveQuoteLineItemsResult> {
  try {
    const parsed = (input as { quoteId?: string; lines?: Array<{ id?: string; quantity?: number }> } | undefined) ?? {}
    const quoteId = parsed.quoteId?.trim() ?? ''
    const lines = parsed.lines ?? []
    if (!quoteId) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing quote identifier.' } }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data: quote } = await supabase
      .from('quotes')
      .select('status')
      .eq('tenant_id', context.data.tenantId)
      .eq('id', quoteId)
      .maybeSingle()

    if (quote?.status === 'locked') {
      return {
        success: false,
        error: { code: 'QUOTE_LOCKED', message: 'Quote locked — event is within lock window.' },
      }
    }

    for (const line of lines) {
      const lineId = line.id?.trim() ?? ''
      const quantity = Number(line.quantity)
      if (!lineId || Number.isNaN(quantity) || quantity <= 0) continue
      await supabase
        .from('quote_line_items')
        .update({ quantity: Number(quantity.toFixed(2)) })
        .eq('tenant_id', context.data.tenantId)
        .eq('quote_id', quoteId)
        .eq('id', lineId)
    }

    await appendQuoteAuditEntry(
      context.data.tenantId,
      quoteId,
      'quote_line_items_saved',
      { lineCount: lines.length },
      context.data.userId
    )

    return { success: true, data: { quoteId, lineCount: lines.length } }
  } catch {
    return { success: false, error: { code: 'QUOTE_SAVE_FAILED', message: 'Could not save quote changes.' } }
  }
}

export async function addQuoteCustomLineItem(input: unknown): Promise<AddQuoteCustomItemResult> {
  try {
    const parsed = (input as {
      quoteId?: string
      description?: string
      quantity?: number
      unitPrice?: number
    } | undefined) ?? {}

    const quoteId = parsed.quoteId?.trim() ?? ''
    const description = parsed.description?.trim() ?? ''
    const quantity = Number(parsed.quantity)
    const unitPrice = Number(parsed.unitPrice)

    if (!quoteId || !description || Number.isNaN(quantity) || quantity <= 0 || Number.isNaN(unitPrice) || unitPrice < 0) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid custom line item payload.' } }
    }

    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()
    const { data: inserted, error } = await supabase
      .from('quote_line_items')
      .insert({
        tenant_id: context.data.tenantId,
        quote_id: quoteId,
        inventory_item_id: '00000000-0000-0000-0000-000000000000',
        description,
        quantity: Number(quantity.toFixed(2)),
        unit_cost_snapshot: Number(unitPrice.toFixed(2)),
        line_type: 'custom',
      })
      .select('id')
      .single()

    if (error || !inserted?.id) {
      return { success: false, error: { code: 'QUOTE_CUSTOM_ITEM_FAILED', message: 'Could not add custom line item.' } }
    }

    await appendQuoteAuditEntry(
      context.data.tenantId,
      quoteId,
      'quote_custom_item_added',
      { description, quantity, unitPrice },
      context.data.userId
    )

    return { success: true, data: { quoteId, lineId: inserted.id } }
  } catch {
    return { success: false, error: { code: 'QUOTE_CUSTOM_ITEM_FAILED', message: 'Could not add custom line item.' } }
  }
}

export async function setQuoteDiscountAndNote(input: unknown): Promise<SetQuoteDiscountAndNoteResult> {
  try {
    const parsed = (input as {
      quoteId?: string
      discountType?: 'percent' | 'fixed' | null
      discountValue?: number
      note?: string
    } | undefined) ?? {}

    const quoteId = parsed.quoteId?.trim() ?? ''
    const discountType = parsed.discountType ?? null
    const discountValue = Number(parsed.discountValue ?? 0)
    const note = parsed.note?.trim() ?? ''

    if (!quoteId || Number.isNaN(discountValue) || discountValue < 0) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid discount or note payload.' } }
    }

    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()

    const { error } = await supabase
      .from('quotes')
      .update({
        note: note || null,
        discount_type: discountType,
        discount_value: Number(discountValue.toFixed(2)),
      })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', quoteId)

    if (error) {
      return { success: false, error: { code: 'QUOTE_METADATA_UPDATE_FAILED', message: 'Could not save discount/note.' } }
    }

    await appendQuoteAuditEntry(
      context.data.tenantId,
      quoteId,
      'quote_discount_or_note_updated',
      { discountType, discountValue, noteLength: note.length },
      context.data.userId
    )

    return { success: true, data: { quoteId } }
  } catch {
    return { success: false, error: { code: 'QUOTE_METADATA_UPDATE_FAILED', message: 'Could not save discount/note.' } }
  }
}

export async function sendQuoteToClient(input: unknown): Promise<SendQuoteToClientResult> {
  try {
    const quoteId = ((input as { quoteId?: string } | undefined)?.quoteId ?? '').trim()
    if (!quoteId) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing quote identifier.' } }
    }

    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()

    const { data: quote } = await supabase
      .from('quotes')
      .select('id, client_id, title')
      .eq('tenant_id', context.data.tenantId)
      .eq('id', quoteId)
      .maybeSingle()

    if (!quote?.id || !quote.client_id) {
      return { success: false, error: { code: 'QUOTE_NOT_FOUND', message: 'Could not find quote/client mapping.' } }
    }

    const { data: client } = await supabase
      .from('clients')
      .select('email, name')
      .eq('tenant_id', context.data.tenantId)
      .eq('id', quote.client_id)
      .maybeSingle()

    if (!client?.email) {
      return { success: false, error: { code: 'CLIENT_EMAIL_REQUIRED', message: 'Client email is required to send quote.' } }
    }

    await supabase
      .from('quotes')
      .update({ status: 'sent' })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', quote.id)

    const shareToken = randomUUID()
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
    await supabase.from('quote_share_tokens').insert({
      tenant_id: context.data.tenantId,
      quote_id: quote.id,
      client_id: quote.client_id,
      token: shareToken,
      expires_at: expiresAt,
      created_by: context.data.userId,
    })

    const dedupeKey = `quote_sent_${quote.id}_${shareToken}`
    await (supabase as unknown as {
      from: (table: 'email_outbox') => {
        insert: (row: {
          tenant_id: string
          event_type: string
          recipient_email: string
          subject: string
          payload: Record<string, unknown>
          dedupe_key: string
        }) => Promise<{ error: { code?: string } | null }>
      }
    }).from('email_outbox').insert({
      tenant_id: context.data.tenantId,
      event_type: 'quote_sent',
      recipient_email: client.email,
      subject: `Your Eventvico Quote: ${quote.title}`,
      payload: {
        quoteId: quote.id,
        quoteTitle: quote.title,
        clientName: client.name,
        portalToken: shareToken,
        expiresAt,
        textFallback: `View your proposal: /portal/${shareToken}`,
      },
      dedupe_key: dedupeKey,
    })

    await appendQuoteAuditEntry(
      context.data.tenantId,
      quote.id,
      'quote_sent',
      { recipientEmail: client.email, expiresAt },
      context.data.userId
    )

    return { success: true, data: { quoteId: quote.id, shareToken } }
  } catch {
    return { success: false, error: { code: 'QUOTE_SEND_FAILED', message: 'Could not send quote to client.' } }
  }
}

export async function createQuoteRevision(input: unknown): Promise<CreateQuoteRevisionResult> {
  try {
    const quoteId = ((input as { quoteId?: string } | undefined)?.quoteId ?? '').trim()
    if (!quoteId) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing quote identifier.' } }
    }
    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()

    const { data: sourceQuote } = await supabase
      .from('quotes')
      .select('id, client_id, title, note, discount_type, discount_value, root_quote_id, revision_number')
      .eq('tenant_id', context.data.tenantId)
      .eq('id', quoteId)
      .maybeSingle()

    if (!sourceQuote?.id) {
      return { success: false, error: { code: 'QUOTE_NOT_FOUND', message: 'Could not find quote to revise.' } }
    }

    const rootQuoteId = sourceQuote.root_quote_id ?? sourceQuote.id
    const nextRevision = Number(sourceQuote.revision_number ?? 1) + 1
    const { data: created } = await supabase
      .from('quotes')
      .insert({
        tenant_id: context.data.tenantId,
        created_by: context.data.userId,
        client_id: sourceQuote.client_id,
        title: sourceQuote.title,
        status: 'draft',
        note: sourceQuote.note,
        discount_type: sourceQuote.discount_type,
        discount_value: sourceQuote.discount_value,
        root_quote_id: rootQuoteId,
        revision_number: nextRevision,
      })
      .select('id')
      .single()

    if (!created?.id) {
      return { success: false, error: { code: 'QUOTE_REVISION_FAILED', message: 'Could not create new revision.' } }
    }

    const { data: sourceLines } = await supabase
      .from('quote_line_items')
      .select('inventory_item_id, description, quantity, unit_cost_snapshot, line_type')
      .eq('tenant_id', context.data.tenantId)
      .eq('quote_id', sourceQuote.id)

    const payload = (sourceLines ?? []).map((line) => ({
      tenant_id: context.data.tenantId,
      quote_id: created.id,
      inventory_item_id: line.inventory_item_id,
      description: line.description,
      quantity: line.quantity,
      unit_cost_snapshot: line.unit_cost_snapshot,
      line_type: line.line_type,
    }))
    if (payload.length > 0) await supabase.from('quote_line_items').insert(payload)

    await appendQuoteAuditEntry(
      context.data.tenantId,
      created.id,
      'quote_revision_created',
      { sourceQuoteId: sourceQuote.id, rootQuoteId, revisionNumber: nextRevision },
      context.data.userId
    )

    return { success: true, data: { quoteId: created.id, rootQuoteId, revisionNumber: nextRevision } }
  } catch {
    return { success: false, error: { code: 'QUOTE_REVISION_FAILED', message: 'Could not create new revision.' } }
  }
}

export async function setQuoteLockState(input: unknown): Promise<SetQuoteLockStateResult> {
  try {
    const parsed = (input as { quoteId?: string; lock?: boolean } | undefined) ?? {}
    const quoteId = parsed.quoteId?.trim() ?? ''
    const lock = parsed.lock === true
    if (!quoteId) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing quote identifier.' } }

    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()
    const status = lock ? 'locked' : 'draft'

    await supabase
      .from('quotes')
      .update({
        status,
        locked_at: lock ? new Date().toISOString() : null,
        unlocked_at: lock ? null : new Date().toISOString(),
      })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', quoteId)

    await appendQuoteAuditEntry(
      context.data.tenantId,
      quoteId,
      lock ? 'quote_locked_manual' : 'quote_unlocked',
      {},
      context.data.userId
    )

    return { success: true, data: { quoteId, status } }
  } catch {
    return { success: false, error: { code: 'QUOTE_LOCK_UPDATE_FAILED', message: 'Could not update quote lock state.' } }
  }
}

export async function fetchQuoteAuditLog(input: unknown): Promise<FetchQuoteAuditLogResult> {
  try {
    const quoteId = ((input as { quoteId?: string } | undefined)?.quoteId ?? '').trim()
    if (!quoteId) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing quote identifier.' } }
    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()

    const { data } = await supabase
      .from('quote_audit_logs')
      .select('id, quote_id, action_type, action_payload, performed_by, created_at')
      .eq('tenant_id', context.data.tenantId)
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })

    return {
      success: true,
      data: {
        entries: (data ?? []).map((item) => ({
          id: item.id,
          quoteId: item.quote_id,
          actionType: item.action_type,
          actionPayload: (item.action_payload ?? {}) as Record<string, unknown>,
          performedBy: item.performed_by,
          createdAt: item.created_at,
        })),
      },
    }
  } catch {
    return { success: false, error: { code: 'QUOTE_AUDIT_FETCH_FAILED', message: 'Could not load quote audit log.' } }
  }
}

export async function buildQuotePdf(input: unknown): Promise<BuildQuotePdfResult> {
  try {
    const quoteId = ((input as { quoteId?: string } | undefined)?.quoteId ?? '').trim()
    if (!quoteId) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing quote identifier.' } }
    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()
    const { data: quote } = await supabase
      .from('quotes')
      .select('id, title, revision_number, note, discount_type, discount_value')
      .eq('tenant_id', context.data.tenantId)
      .eq('id', quoteId)
      .maybeSingle()
    if (!quote?.id) return { success: false, error: { code: 'QUOTE_NOT_FOUND', message: 'Could not find quote.' } }

    const { data: lines } = await supabase
      .from('quote_line_items')
      .select('description, quantity, unit_cost_snapshot')
      .eq('tenant_id', context.data.tenantId)
      .eq('quote_id', quoteId)

    const total = (lines ?? []).reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_cost_snapshot), 0)
    const lineRows = (lines ?? []).map((line) => `${line.description} | ${line.quantity} x ${line.unit_cost_snapshot}`)
    const contentLines = [
      `Eventvico Quote: ${quote.title}`,
      `Revision: ${quote.revision_number ?? 1}`,
      '',
      ...lineRows,
      '',
      `Subtotal: ${total.toFixed(2)}`,
      `Discount: ${quote.discount_type ?? 'none'} ${Number(quote.discount_value ?? 0).toFixed(2)}`,
      `Notes: ${quote.note ?? '-'}`,
    ]
    const contentBase64 = buildSimplePdfBase64(contentLines)

    return {
      success: true,
      data: {
        filename: `${quote.title.replace(/\s+/g, '-').toLowerCase()}-v${quote.revision_number ?? 1}.pdf`,
        contentBase64,
      },
    }
  } catch {
    return { success: false, error: { code: 'QUOTE_PDF_BUILD_FAILED', message: 'Could not generate PDF payload.' } }
  }
}

export async function buildShareableQuoteLink(input: unknown): Promise<BuildShareableLinkResult> {
  try {
    const quoteId = ((input as { quoteId?: string } | undefined)?.quoteId ?? '').trim()
    if (!quoteId) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing quote identifier.' } }
    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()
    const token = randomUUID()
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
    await supabase.from('quote_share_tokens').insert({
      tenant_id: context.data.tenantId,
      quote_id: quoteId,
      token,
      expires_at: expiresAt,
      created_by: context.data.userId,
    })

    await appendQuoteAuditEntry(
      context.data.tenantId,
      quoteId,
      'quote_share_link_generated',
      { expiresAt },
      context.data.userId
    )

    return { success: true, data: { url: `/portal/${token}`, expiresAt } }
  } catch {
    return { success: false, error: { code: 'QUOTE_SHARE_LINK_FAILED', message: 'Could not generate shareable link.' } }
  }
}
