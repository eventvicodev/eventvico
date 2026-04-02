'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ActionResult, FulfillmentStatus } from '@/types/app'
import { createClient } from '@/lib/supabase/server'
import { getTenantContext } from './tenant-context'

type EventRecord = {
  id: string
  name: string
  startAt: string
  endAt: string
  status: string
  venue: string | null
  clientId: string | null
  clientName: string | null
  linkedRecipeCount: number
  fulfillmentComplete: boolean
}

type EventSnapshotResult = ActionResult<{ events: EventRecord[]; weekStart: string }>
type EventFormOptionsResult = ActionResult<{
  clients: Array<{ id: string; name: string }>
  recipes: Array<{ id: string; name: string }>
}>
type UpsertEventResult = ActionResult<{ eventId: string }>
type EventDetailResult = ActionResult<{
  event: EventRecord
  linkedRecipes: Array<{ id: string; name: string }>
  fulfillmentItems: Array<{ id: string; arrangementName: string; itemName: string; status: FulfillmentStatus }>
}>
type ExportIcsResult = ActionResult<{ filename: string; content: string }>
type UpdateFulfillmentResult = ActionResult<{ eventId: string; allDelivered: boolean }>

function startOfWeek(date: Date) {
  const value = new Date(date)
  const day = value.getDay()
  const diff = day === 0 ? -6 : 1 - day
  value.setDate(value.getDate() + diff)
  value.setHours(0, 0, 0, 0)
  return value
}

function parseWeekStart(input?: string) {
  const parsed = input ? new Date(input) : new Date()
  return Number.isNaN(parsed.getTime()) ? startOfWeek(new Date()) : startOfWeek(parsed)
}

export async function fetchEventFormOptions(): Promise<EventFormOptionsResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) return context
    const supabase = await createClient()
    const [{ data: clients }, { data: recipes }] = await Promise.all([
      supabase
        .from('clients')
        .select('id, name')
        .eq('tenant_id', context.data.tenantId)
        .order('name', { ascending: true }),
      supabase
        .from('recipes')
        .select('id, name')
        .eq('tenant_id', context.data.tenantId)
        .order('name', { ascending: true }),
    ])

    return {
      success: true,
      data: {
        clients: (clients ?? []).map((client) => ({ id: client.id, name: client.name })),
        recipes: (recipes ?? []).map((recipe) => ({ id: recipe.id, name: recipe.name })),
      },
    }
  } catch {
    return { success: false, error: { code: 'EVENT_OPTIONS_FETCH_FAILED', message: 'Could not load clients/recipes.' } }
  }
}

export async function fetchWeekEvents(input: unknown): Promise<EventSnapshotResult> {
  try {
    const weekStart = parseWeekStart((input as { weekStart?: string } | undefined)?.weekStart)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data: events } = await supabase
      .from('events')
      .select('id, name, start_at, end_at')
      .eq('tenant_id', context.data.tenantId)
      .gte('start_at', weekStart.toISOString())
      .lt('start_at', weekEnd.toISOString())
      .order('start_at', { ascending: true })

    const eventIds = (events ?? []).map((event) => event.id)

    const metadataRows = await (supabase as any)
      .from('event_metadata')
      .select('event_id, client_id, venue, status')
      .eq('tenant_id', context.data.tenantId)
      .in('event_id', eventIds.length > 0 ? eventIds : ['00000000-0000-0000-0000-000000000000'])

    const recipeLinkRows = await (supabase as any)
      .from('event_recipe_links')
      .select('event_id')
      .eq('tenant_id', context.data.tenantId)
      .in('event_id', eventIds.length > 0 ? eventIds : ['00000000-0000-0000-0000-000000000000'])

    const fulfillmentRows = await (supabase as any)
      .from('event_fulfillment_items')
      .select('event_id, status')
      .eq('tenant_id', context.data.tenantId)
      .in('event_id', eventIds.length > 0 ? eventIds : ['00000000-0000-0000-0000-000000000000'])

    type MetadataRow = { event_id: string; client_id: string | null; venue: string | null; status: string | null }
    type LinkRow = { event_id: string }
    type FulfillmentRow = { event_id: string; status: string }

    const metadata: MetadataRow[] = (metadataRows.data ?? []).filter(
      (row: any): row is MetadataRow =>
        typeof row?.event_id === 'string'
        && ('client_id' in row)
        && ('venue' in row)
        && ('status' in row)
    )
    const links: LinkRow[] = (recipeLinkRows.data ?? []).filter(
      (row: any): row is LinkRow => typeof row?.event_id === 'string'
    )
    const fulfillments: FulfillmentRow[] = (fulfillmentRows.data ?? []).filter(
      (row: any): row is FulfillmentRow => typeof row?.event_id === 'string' && typeof row?.status === 'string'
    )

    const clientIds: string[] = Array.from(
      new Set(
        metadata
          .map((row) => row.client_id)
          .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
      )
    )
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .eq('tenant_id', context.data.tenantId)
      .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])

    const clientById = new Map((clients ?? []).map((client) => [client.id, client.name]))
    const metadataByEventId = new Map<string, MetadataRow>(metadata.map((row) => [row.event_id, row]))

    const linkCountByEventId = new Map<string, number>()
    for (const link of links) {
      linkCountByEventId.set(link.event_id, (linkCountByEventId.get(link.event_id) ?? 0) + 1)
    }

    const fulfillmentByEventId = new Map<string, Array<{ status: string }>>()
    for (const item of fulfillments) {
      const existing = fulfillmentByEventId.get(item.event_id) ?? []
      existing.push({ status: item.status })
      fulfillmentByEventId.set(item.event_id, existing)
    }

    return {
      success: true,
      data: {
        weekStart: weekStart.toISOString(),
        events: (events ?? []).map((event) => {
          const meta = metadataByEventId.get(event.id)
          const eventFulfillment = fulfillmentByEventId.get(event.id) ?? []
          const allDelivered = eventFulfillment.length > 0 && eventFulfillment.every((item) => item.status === 'delivered')

          return {
            id: event.id,
            name: event.name,
            startAt: event.start_at,
            endAt: event.end_at,
            status: meta?.status ?? 'scheduled',
            venue: meta?.venue ?? null,
            clientId: meta?.client_id ?? null,
            clientName: meta?.client_id ? clientById.get(meta.client_id) ?? null : null,
            linkedRecipeCount: linkCountByEventId.get(event.id) ?? 0,
            fulfillmentComplete: allDelivered,
          }
        }),
      },
    }
  } catch {
    return { success: false, error: { code: 'EVENTS_FETCH_FAILED', message: 'Could not load events.' } }
  }
}

export async function upsertEvent(input: unknown): Promise<UpsertEventResult> {
  try {
    const parsed = (input as {
      eventId?: string
      name?: string
      startAt?: string
      endAt?: string
      clientId?: string | null
      venue?: string | null
      status?: string
      recipeIds?: string[]
    } | undefined) ?? {}

    const name = parsed.name?.trim() ?? ''
    const startAt = parsed.startAt?.trim() ?? ''
    const endAt = parsed.endAt?.trim() ?? ''
    const recipeIds = (parsed.recipeIds ?? []).map((id) => id.trim()).filter(Boolean)

    if (!name || !startAt || !endAt || recipeIds.length === 0) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Name, date/time, and recipes are required.' } }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    let eventId = parsed.eventId?.trim() ?? ''

    if (eventId) {
      await supabase
        .from('events')
        .update({ name, start_at: startAt, end_at: endAt })
        .eq('tenant_id', context.data.tenantId)
        .eq('id', eventId)
    } else {
      const { data: created } = await supabase
        .from('events')
        .insert({
          tenant_id: context.data.tenantId,
          created_by: context.data.userId,
          name,
          start_at: startAt,
          end_at: endAt,
        })
        .select('id')
        .single()
      eventId = created?.id ?? ''
    }

    if (!eventId) {
      return { success: false, error: { code: 'EVENT_SAVE_FAILED', message: 'Could not save event.' } }
    }

    await (supabase as any)
      .from('event_metadata')
      .upsert({
        event_id: eventId,
        tenant_id: context.data.tenantId,
        client_id: parsed.clientId ?? null,
        venue: parsed.venue?.trim() || null,
        status: parsed.status?.trim() || 'scheduled',
      }, { onConflict: 'event_id' })

    await (supabase as any)
      .from('event_recipe_links')
      .delete()
      .eq('tenant_id', context.data.tenantId)
      .eq('event_id', eventId)

    await (supabase as any)
      .from('event_fulfillment_items')
      .delete()
      .eq('tenant_id', context.data.tenantId)
      .eq('event_id', eventId)

    const { data: recipes } = await supabase
      .from('recipes')
      .select('id, name')
      .eq('tenant_id', context.data.tenantId)
      .in('id', recipeIds)

    if ((recipes ?? []).length > 0) {
      await (supabase as any)
        .from('event_recipe_links')
        .insert((recipes ?? []).map((recipe) => ({
          tenant_id: context.data.tenantId,
          event_id: eventId,
          recipe_id: recipe.id,
        })))
    }

    const { data: recipeItems } = await supabase
      .from('recipe_items')
      .select('recipe_id, quantity, inventory_item_id')
      .eq('tenant_id', context.data.tenantId)
      .in('recipe_id', recipeIds)

    const inventoryIds = Array.from(new Set((recipeItems ?? []).map((item) => item.inventory_item_id)))
    const { data: inventoryItems } = await supabase
      .from('inventory_items')
      .select('id, name')
      .eq('tenant_id', context.data.tenantId)
      .in('id', inventoryIds.length > 0 ? inventoryIds : ['00000000-0000-0000-0000-000000000000'])

    const recipeNameById = new Map((recipes ?? []).map((recipe) => [recipe.id, recipe.name]))
    const inventoryNameById = new Map((inventoryItems ?? []).map((item) => [item.id, item.name]))

    const fulfillmentRows = (recipeItems ?? []).map((item) => ({
      tenant_id: context.data.tenantId,
      event_id: eventId,
      arrangement_name: recipeNameById.get(item.recipe_id) ?? 'Arrangement',
      item_name: inventoryNameById.get(item.inventory_item_id) ?? 'Item',
      quantity_required: Number(item.quantity),
      status: 'unprepared',
    }))

    if (fulfillmentRows.length > 0) {
      await (supabase as any).from('event_fulfillment_items').insert(fulfillmentRows)
    }

    return { success: true, data: { eventId } }
  } catch {
    return { success: false, error: { code: 'EVENT_SAVE_FAILED', message: 'Could not save event.' } }
  }
}

export async function fetchEventDetail(input: unknown): Promise<EventDetailResult> {
  try {
    const eventId = ((input as { eventId?: string } | undefined)?.eventId ?? '').trim()
    if (!eventId) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing event id.' } }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data: event } = await supabase
      .from('events')
      .select('id, name, start_at, end_at')
      .eq('tenant_id', context.data.tenantId)
      .eq('id', eventId)
      .maybeSingle()

    if (!event?.id) return { success: false, error: { code: 'EVENT_NOT_FOUND', message: 'Event not found.' } }

    const metadataResult = await (supabase as any)
      .from('event_metadata')
      .select('client_id, venue, status')
      .eq('tenant_id', context.data.tenantId)
      .eq('event_id', eventId)
      .maybeSingle()

    const metadata = metadataResult.data
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('tenant_id', context.data.tenantId)
      .eq('id', metadata?.client_id ?? '00000000-0000-0000-0000-000000000000')
      .maybeSingle()

    const recipeLinksResult = await (supabase as any)
      .from('event_recipe_links')
      .select('recipe_id')
      .eq('tenant_id', context.data.tenantId)
      .eq('event_id', eventId)

    const recipeIds = (recipeLinksResult.data ?? []).map((row: any) => row.recipe_id)
    const { data: recipes } = await supabase
      .from('recipes')
      .select('id, name')
      .eq('tenant_id', context.data.tenantId)
      .in('id', recipeIds.length > 0 ? recipeIds : ['00000000-0000-0000-0000-000000000000'])

    const fulfillmentResult = await (supabase as any)
      .from('event_fulfillment_items')
      .select('id, arrangement_name, item_name, status')
      .eq('tenant_id', context.data.tenantId)
      .eq('event_id', eventId)
      .order('arrangement_name', { ascending: true })

    return {
      success: true,
      data: {
        event: {
          id: event.id,
          name: event.name,
          startAt: event.start_at,
          endAt: event.end_at,
          status: metadata?.status ?? 'scheduled',
          venue: metadata?.venue ?? null,
          clientId: metadata?.client_id ?? null,
          clientName: client?.name ?? null,
          linkedRecipeCount: recipeIds.length,
          fulfillmentComplete: (fulfillmentResult.data ?? []).length > 0
            && (fulfillmentResult.data ?? []).every((item: any) => item.status === 'delivered'),
        },
        linkedRecipes: (recipes ?? []).map((recipe) => ({ id: recipe.id, name: recipe.name })),
        fulfillmentItems: (fulfillmentResult.data ?? []).map((item: any) => ({
          id: item.id,
          arrangementName: item.arrangement_name,
          itemName: item.item_name,
          status: item.status,
        })),
      },
    }
  } catch {
    return { success: false, error: { code: 'EVENT_FETCH_FAILED', message: 'Could not load event detail.' } }
  }
}

export async function updateFulfillmentStatus(input: unknown): Promise<UpdateFulfillmentResult> {
  try {
    const parsed = (input as { itemId?: string; status?: FulfillmentStatus } | undefined) ?? {}
    const itemId = parsed.itemId?.trim() ?? ''
    const status = parsed.status

    if (!itemId || !status) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid fulfillment update.' } }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data: updated } = await (supabase as any)
      .from('event_fulfillment_items')
      .update({ status })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', itemId)
      .select('event_id')
      .maybeSingle()

    const eventId = updated?.event_id ?? ''
    if (!eventId) {
      return { success: false, error: { code: 'FULFILLMENT_UPDATE_FAILED', message: 'Could not update fulfillment.' } }
    }

    const { data: rows } = await (supabase as any)
      .from('event_fulfillment_items')
      .select('status')
      .eq('tenant_id', context.data.tenantId)
      .eq('event_id', eventId)

    const allDelivered = (rows ?? []).length > 0 && (rows ?? []).every((row: any) => row.status === 'delivered')

    if (allDelivered) {
      await (supabase as any)
        .from('event_metadata')
        .update({ status: 'fulfillment_complete' })
        .eq('tenant_id', context.data.tenantId)
        .eq('event_id', eventId)
    } else {
      await (supabase as any)
        .from('event_metadata')
        .update({ status: 'in_progress' })
        .eq('tenant_id', context.data.tenantId)
        .eq('event_id', eventId)
        .eq('status', 'fulfillment_complete')
    }

    return { success: true, data: { eventId, allDelivered } }
  } catch {
    return { success: false, error: { code: 'FULFILLMENT_UPDATE_FAILED', message: 'Could not update fulfillment.' } }
  }
}

export async function exportEventsIcal(input: unknown): Promise<ExportIcsResult> {
  try {
    const parsed = (input as { eventIds?: string[] } | undefined) ?? {}
    const eventIds = (parsed.eventIds ?? []).map((id) => id.trim()).filter(Boolean)

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const query = supabase
      .from('events')
      .select('id, name, start_at, end_at')
      .eq('tenant_id', context.data.tenantId)
      .order('start_at', { ascending: true })

    const { data } = eventIds.length > 0
      ? await query.in('id', eventIds)
      : await query

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Eventvico//Studio Calendar//EN',
    ]

    for (const event of data ?? []) {
      const startUtc = new Date(event.start_at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
      const endUtc = new Date(event.end_at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${event.id}@eventvico.app`)
      lines.push(`DTSTAMP:${startUtc}`)
      lines.push(`DTSTART:${startUtc}`)
      lines.push(`DTEND:${endUtc}`)
      lines.push(`SUMMARY:${event.name.replace(/\n/g, ' ')}`)
      lines.push('END:VEVENT')
    }

    lines.push('END:VCALENDAR')

    return {
      success: true,
      data: {
        filename: `eventvico-${new Date().toISOString().slice(0, 10)}.ics`,
        content: `${lines.join('\r\n')}\r\n`,
      },
    }
  } catch {
    return { success: false, error: { code: 'ICAL_EXPORT_FAILED', message: 'Could not export iCal file.' } }
  }
}
