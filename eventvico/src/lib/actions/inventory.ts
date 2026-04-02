'use server'

import { createClient } from '@/lib/supabase/server'
import {
  createInventoryItemSchema,
  deleteInventoryItemSchema,
  type InventoryCategory,
  updateInventoryItemSchema,
} from '@/lib/schemas/inventory'
import { normalizeInventoryCategory } from '@/lib/inventory/import'
import type { ActionResult } from '@/types/app'
import { getTenantContext, TenantContextResult } from './tenant-context'

type FetchInventoryItemsResult = ActionResult<{
  tenantId: string
  items: Array<{
    id: string
    name: string
    category: InventoryCategory
    unit: string
    cost: number
    quantityOnHand: number
    quantityCommitted: number
    quantityAvailable: number
    sku: string
    barcodeValue: string | null
  }>
}>
type CreateInventoryItemResult = ActionResult<{ itemId: string }>
type UpdateInventoryItemResult = ActionResult<{
  itemId: string
  priceChanged: boolean
  repricedRecipeCount: number
  repricedQuoteCount: number
}>
type DeleteInventoryItemResult = ActionResult<{ itemId: string }>
type ImportInventoryRowsResult = ActionResult<{
  importedCount: number
  skippedCount: number
  skippedRows: Array<{
    rowNumber: number
    reason: string
  }>
}>
type LinkInventoryBarcodeResult =
  | ActionResult<{
      itemId: string
      barcodeValue: string
    }>
  | ActionResult<{
      status: 'collision'
      existingItemId: string
      existingItemName: string
      barcodeValue: string
    }>
type ResolveBarcodeResult = ActionResult<{
  item: {
    id: string
    name: string
    unit: string
    sku: string
    quantityOnHand: number
  }
}>
type ApplyInventoryScanResult = ActionResult<{
  itemId: string
  quantityOnHand: number
}>
type ListAllocationEventsResult = ActionResult<{
  events: Array<{
    id: string
    name: string
    startAt: string
    endAt: string
  }>
}>
type CreateAllocationEventResult = ActionResult<{ eventId: string }>
type AllocateInventoryToEventResult =
  | ActionResult<{
      allocationId: string
      inventoryItemId: string
      quantityCommitted: number
    }>
  | ActionResult<{
      status: 'warning'
      availableQuantity: number
      requestedQuantity: number
      message: string
    }>

function mapInventoryFieldErrors(schema: typeof createInventoryItemSchema, input: unknown): Record<string, string[]> | undefined {
  const parsed = schema.safeParse(input)
  if (parsed.success) return undefined

  const fields = parsed.error.flatten().fieldErrors
  const mapped: Record<string, string[]> = {}
  Object.entries(fields).forEach(([key, value]) => {
    if (value && value.length > 0) mapped[key] = value
  })
  return Object.keys(mapped).length > 0 ? mapped : undefined
}


function isInventoryCategory(value: string): value is InventoryCategory {
  return value === 'flowers' || value === 'decor' || value === 'consumables'
}

export async function fetchInventoryItems(): Promise<FetchInventoryItemsResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, name, category, unit, cost, quantity_on_hand, sku, barcode_value')
      .eq('tenant_id', context.data.tenantId)
      .order('name', { ascending: true })

    if (error) {
      return {
        success: false,
        error: {
          code: 'INVENTORY_FETCH_FAILED',
          message: 'Could not load inventory.',
        },
      }
    }

    const itemIds = (data ?? []).map((item) => item.id)
    const { data: allocations } = await supabase
      .from('inventory_allocations')
      .select('inventory_item_id, quantity_committed')
      .eq('tenant_id', context.data.tenantId)
      .in('inventory_item_id', itemIds)

    const committedByItemId = new Map<string, number>()
    for (const allocation of allocations ?? []) {
      committedByItemId.set(
        allocation.inventory_item_id,
        (committedByItemId.get(allocation.inventory_item_id) ?? 0) + Number(allocation.quantity_committed)
      )
    }

    const items = (data ?? []).flatMap((item) => {
      if (!isInventoryCategory(item.category)) return []
      const quantityOnHand = Number(item.quantity_on_hand)
      const quantityCommitted = committedByItemId.get(item.id) ?? 0
      return [{
        id: item.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        cost: Number(item.cost),
        quantityOnHand,
        quantityCommitted,
        quantityAvailable: quantityOnHand - quantityCommitted,
        sku: item.sku,
        barcodeValue: item.barcode_value,
      }]
    })

    return {
      success: true,
      data: {
        tenantId: context.data.tenantId,
        items,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'INVENTORY_FETCH_FAILED',
        message: 'Could not load inventory.',
      },
    }
  }
}

export async function listAllocationEvents(): Promise<ListAllocationEventsResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('events')
      .select('id, name, start_at, end_at')
      .eq('tenant_id', context.data.tenantId)
      .order('start_at', { ascending: true })

    if (error) {
      return {
        success: false,
        error: {
          code: 'EVENTS_FETCH_FAILED',
          message: 'Could not load events.',
        },
      }
    }

    return {
      success: true,
      data: {
        events: (data ?? []).map((event) => ({
          id: event.id,
          name: event.name,
          startAt: event.start_at,
          endAt: event.end_at,
        })),
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'EVENTS_FETCH_FAILED',
        message: 'Could not load events.',
      },
    }
  }
}

export async function createAllocationEvent(input: unknown): Promise<CreateAllocationEventResult> {
  try {
    const parsed = (input as { name?: string; startAt?: string; endAt?: string } | undefined) ?? {}
    const name = parsed.name?.trim() ?? ''
    const startAt = parsed.startAt?.trim() ?? ''
    const endAt = parsed.endAt?.trim() ?? ''

    if (!name || !startAt || !endAt) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Name, start date/time, and end date/time are required.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data, error } = await supabase
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

    if (error || !data?.id) {
      return {
        success: false,
        error: {
          code: 'EVENT_CREATE_FAILED',
          message: 'Could not create event.',
        },
      }
    }

    return {
      success: true,
      data: {
        eventId: data.id,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'EVENT_CREATE_FAILED',
        message: 'Could not create event.',
      },
    }
  }
}

export async function allocateInventoryToEvent(input: unknown): Promise<AllocateInventoryToEventResult> {
  try {
    const parsed = (input as {
      inventoryItemId?: string
      eventId?: string
      quantityCommitted?: number
      force?: boolean
    } | undefined) ?? {}
    const inventoryItemId = parsed.inventoryItemId?.trim() ?? ''
    const eventId = parsed.eventId?.trim() ?? ''
    const quantityCommitted = Number(parsed.quantityCommitted)
    const force = parsed.force === true

    if (!inventoryItemId || !eventId || Number.isNaN(quantityCommitted) || quantityCommitted <= 0) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid allocation payload.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data: item } = await supabase
      .from('inventory_items')
      .select('id, quantity_on_hand')
      .eq('id', inventoryItemId)
      .eq('tenant_id', context.data.tenantId)
      .maybeSingle()

    if (!item?.id) {
      return {
        success: false,
        error: {
          code: 'INVENTORY_NOT_FOUND',
          message: 'Could not find inventory item.',
        },
      }
    }

    const { data: existingAllocation } = await supabase
      .from('inventory_allocations')
      .select('id, quantity_committed')
      .eq('tenant_id', context.data.tenantId)
      .eq('inventory_item_id', inventoryItemId)
      .eq('event_id', eventId)
      .maybeSingle()

    const { data: allAllocations } = await supabase
      .from('inventory_allocations')
      .select('quantity_committed')
      .eq('tenant_id', context.data.tenantId)
      .eq('inventory_item_id', inventoryItemId)

    const totalCommitted = (allAllocations ?? []).reduce(
      (sum, allocation) => sum + Number(allocation.quantity_committed),
      0
    )
    const previousForEvent = Number(existingAllocation?.quantity_committed ?? 0)
    const availableQuantity = Number(item.quantity_on_hand) - (totalCommitted - previousForEvent)

    if (quantityCommitted > availableQuantity && !force) {
      return {
        success: true,
        data: {
          status: 'warning',
          availableQuantity,
          requestedQuantity: quantityCommitted,
          message: `Only ${availableQuantity} units available — you're committing ${quantityCommitted}`,
        },
      }
    }

    if (existingAllocation?.id) {
      const { data: updated, error } = await supabase
        .from('inventory_allocations')
        .update({ quantity_committed: quantityCommitted })
        .eq('id', existingAllocation.id)
        .eq('tenant_id', context.data.tenantId)
        .select('id')
        .single()

      if (error || !updated?.id) {
        return {
          success: false,
          error: {
            code: 'ALLOCATION_SAVE_FAILED',
            message: 'Could not save allocation.',
          },
        }
      }

      return {
        success: true,
        data: {
          allocationId: updated.id,
          inventoryItemId,
          quantityCommitted,
        },
      }
    }

    const { data: created, error } = await supabase
      .from('inventory_allocations')
      .insert({
        tenant_id: context.data.tenantId,
        inventory_item_id: inventoryItemId,
        event_id: eventId,
        quantity_committed: quantityCommitted,
      })
      .select('id')
      .single()

    if (error || !created?.id) {
      return {
        success: false,
        error: {
          code: 'ALLOCATION_SAVE_FAILED',
          message: 'Could not save allocation.',
        },
      }
    }

    return {
      success: true,
      data: {
        allocationId: created.id,
        inventoryItemId,
        quantityCommitted,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'ALLOCATION_SAVE_FAILED',
        message: 'Could not save allocation.',
      },
    }
  }
}

export async function linkInventoryBarcode(input: unknown): Promise<LinkInventoryBarcodeResult> {
  try {
    const parsed = (input as { itemId?: string; code?: string; reassign?: boolean } | undefined) ?? {}
    const itemId = parsed.itemId?.trim() ?? ''
    const code = parsed.code?.trim() ?? ''
    const reassign = parsed.reassign === true

    if (!itemId || !code) {
      const fields: Record<string, string[]> = {}
      if (!code) fields.code = ['Barcode is required']
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Item and barcode are required.',
          fields: Object.keys(fields).length > 0 ? fields : undefined,
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const normalizedCode = code.replace(/\s+/g, '').toUpperCase()

    const { data: existing } = await supabase
      .from('inventory_items')
      .select('id, name')
      .eq('tenant_id', context.data.tenantId)
      .eq('barcode_value', normalizedCode)
      .maybeSingle()

    if (existing?.id && existing.id !== itemId) {
      if (!reassign) {
        return {
          success: true,
          data: {
            status: 'collision',
            existingItemId: existing.id,
            existingItemName: existing.name,
            barcodeValue: normalizedCode,
          },
        }
      }

      await supabase
        .from('inventory_items')
        .update({ barcode_value: null })
        .eq('id', existing.id)
        .eq('tenant_id', context.data.tenantId)
    }

    const { data: updated, error } = await supabase
      .from('inventory_items')
      .update({ barcode_value: normalizedCode })
      .eq('id', itemId)
      .eq('tenant_id', context.data.tenantId)
      .select('id, barcode_value')
      .single()

    if (error || !updated?.id || !updated.barcode_value) {
      return {
        success: false,
        error: {
          code: 'BARCODE_LINK_FAILED',
          message: 'Could not link barcode to inventory item.',
        },
      }
    }

    return {
      success: true,
      data: {
        itemId: updated.id,
        barcodeValue: updated.barcode_value,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'BARCODE_LINK_FAILED',
        message: 'Could not link barcode to inventory item.',
      },
    }
  }
}

export async function resolveInventoryBarcode(code: string): Promise<ResolveBarcodeResult> {
  try {
    const normalizedCode = code.trim().replace(/\s+/g, '').toUpperCase()
    if (!normalizedCode) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Barcode is required.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data: item } = await supabase
      .from('inventory_items')
      .select('id, name, unit, sku, quantity_on_hand')
      .eq('tenant_id', context.data.tenantId)
      .eq('barcode_value', normalizedCode)
      .maybeSingle()

    if (!item?.id) {
      return {
        success: false,
        error: {
          code: 'BARCODE_NOT_LINKED',
          message: 'No item linked to this code — link it now?',
        },
      }
    }

    return {
      success: true,
      data: {
        item: {
          id: item.id,
          name: item.name,
          unit: item.unit,
          sku: item.sku,
          quantityOnHand: Number(item.quantity_on_hand),
        },
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'BARCODE_RESOLVE_FAILED',
        message: 'Could not resolve scanned code.',
      },
    }
  }
}

export async function applyInventoryScan(input: unknown): Promise<ApplyInventoryScanResult> {
  try {
    const parsed = (input as { code?: string; quantityOnHand?: number } | undefined) ?? {}
    const code = parsed.code?.trim() ?? ''
    const quantityOnHand = Number(parsed.quantityOnHand)
    if (!code || Number.isNaN(quantityOnHand) || quantityOnHand < 0) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid scan payload.',
        },
      }
    }

    const resolved = await resolveInventoryBarcode(code)
    if (!resolved.success) return resolved

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('inventory_items')
      .update({
        quantity_on_hand: quantityOnHand,
      })
      .eq('id', resolved.data.item.id)
      .eq('tenant_id', context.data.tenantId)
      .select('id, quantity_on_hand')
      .single()

    if (error || !data?.id) {
      return {
        success: false,
        error: {
          code: 'SCAN_APPLY_FAILED',
          message: 'Could not update stock from scan.',
        },
      }
    }

    return {
      success: true,
      data: {
        itemId: data.id,
        quantityOnHand: Number(data.quantity_on_hand),
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'SCAN_APPLY_FAILED',
        message: 'Could not update stock from scan.',
      },
    }
  }
}

export async function createInventoryItem(input: unknown): Promise<CreateInventoryItemResult> {
  try {
    const parsed = createInventoryItemSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please correct the highlighted fields',
          fields: mapInventoryFieldErrors(createInventoryItemSchema, input),
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const values = parsed.data

    const { data: created, error } = await supabase
      .from('inventory_items')
      .insert({
        tenant_id: context.data.tenantId,
        created_by: context.data.userId,
        name: values.name.trim(),
        category: values.category,
        unit: values.unit.trim(),
        cost: Number(values.cost),
        quantity_on_hand: Number(values.quantityOnHand),
        sku: values.sku.trim(),
      })
      .select('id')
      .single()

    if (error || !created?.id) {
      const isDuplicateSku = error?.code === '23505'
      return {
        success: false,
        error: {
          code: 'INVENTORY_CREATE_FAILED',
          message: isDuplicateSku ? 'An item with this SKU already exists.' : 'Could not create inventory item.',
          fields: isDuplicateSku ? { sku: ['SKU already exists'] } : undefined,
        },
      }
    }

    return {
      success: true,
      data: {
        itemId: created.id,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'INVENTORY_CREATE_FAILED',
        message: 'Could not create inventory item.',
      },
    }
  }
}

export async function updateInventoryItem(input: unknown): Promise<UpdateInventoryItemResult> {
  try {
    const parsed = updateInventoryItemSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please correct the highlighted fields',
          fields: mapInventoryFieldErrors(createInventoryItemSchema, input),
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const values = parsed.data

    const { data: beforeUpdate } = await supabase
      .from('inventory_items')
      .select('cost')
      .eq('id', values.id)
      .eq('tenant_id', context.data.tenantId)
      .maybeSingle()

    const { data: updated, error } = await supabase
      .from('inventory_items')
      .update({
        name: values.name.trim(),
        category: values.category,
        unit: values.unit.trim(),
        cost: Number(values.cost),
        quantity_on_hand: Number(values.quantityOnHand),
        sku: values.sku.trim(),
      })
      .eq('id', values.id)
      .eq('tenant_id', context.data.tenantId)
      .select('id')
      .single()

    if (error || !updated?.id) {
      const isDuplicateSku = error?.code === '23505'
      return {
        success: false,
        error: {
          code: 'INVENTORY_UPDATE_FAILED',
          message: isDuplicateSku ? 'An item with this SKU already exists.' : 'Could not update inventory item.',
          fields: isDuplicateSku ? { sku: ['SKU already exists'] } : undefined,
        },
      }
    }

    const previousCost = Number(beforeUpdate?.cost ?? values.cost)
    const nextCost = Number(values.cost)
    const priceChanged = previousCost !== nextCost
    let repricedRecipeCount = 0
    let repricedQuoteCount = 0

    if (priceChanged) {
      const { data: recipeUsages } = await supabase
        .from('recipe_items')
        .select('recipe_id')
        .eq('tenant_id', context.data.tenantId)
        .eq('inventory_item_id', values.id)

      repricedRecipeCount = new Set((recipeUsages ?? []).map((usage) => usage.recipe_id)).size

      const { data: openQuotes } = await supabase
        .from('quotes')
        .select('id')
        .eq('tenant_id', context.data.tenantId)
        .in('status', ['draft', 'sent', 'revision_requested'])

      const openQuoteIds = (openQuotes ?? []).map((quote) => quote.id)
      if (openQuoteIds.length > 0) {
        const { data: impactedLineItems } = await supabase
          .from('quote_line_items')
          .select('id, quote_id')
          .eq('tenant_id', context.data.tenantId)
          .eq('inventory_item_id', values.id)
          .in('quote_id', openQuoteIds)

        const impactedQuoteIds = Array.from(
          new Set((impactedLineItems ?? []).map((line) => line.quote_id))
        )
        repricedQuoteCount = impactedQuoteIds.length

        if ((impactedLineItems ?? []).length > 0) {
          await supabase
            .from('quote_line_items')
            .update({ unit_cost_snapshot: nextCost })
            .eq('tenant_id', context.data.tenantId)
            .eq('inventory_item_id', values.id)
            .in('quote_id', openQuoteIds)
        }
      }
    }

    return {
      success: true,
      data: {
        itemId: updated.id,
        priceChanged,
        repricedRecipeCount,
        repricedQuoteCount,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'INVENTORY_UPDATE_FAILED',
        message: 'Could not update inventory item.',
      },
    }
  }
}

export async function deleteInventoryItem(input: unknown): Promise<DeleteInventoryItemResult> {
  try {
    const parsed = deleteInventoryItemSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid inventory item identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const { data: deleted, error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', parsed.data.id)
      .eq('tenant_id', context.data.tenantId)
      .select('id')
      .single()

    if (error || !deleted?.id) {
      return {
        success: false,
        error: {
          code: 'INVENTORY_DELETE_FAILED',
          message: 'Could not remove inventory item.',
        },
      }
    }

    return {
      success: true,
      data: {
        itemId: deleted.id,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'INVENTORY_DELETE_FAILED',
        message: 'Could not remove inventory item.',
      },
    }
  }
}

export async function importInventoryRows(input: unknown): Promise<ImportInventoryRowsResult> {
  try {
    const rows = (input as {
      rows?: Array<{
        rowNumber?: number
        name?: string
        category?: string
        unit?: string
        cost?: string
        quantityOnHand?: string
        sku?: string
      }>
    } | undefined)?.rows ?? []

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Add at least one row before importing.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    let importedCount = 0
    const skippedRows: Array<{ rowNumber: number; reason: string }> = []

    for (const row of rows) {
      const rowNumber = Number(row.rowNumber) || 0
      const normalizedCategory = normalizeInventoryCategory(row.category ?? '')
      const payload = {
        name: row.name?.trim() ?? '',
        category: normalizedCategory || 'flowers',
        unit: row.unit?.trim() ?? '',
        cost: row.cost?.trim() ?? '',
        quantityOnHand: row.quantityOnHand?.trim() ?? '',
        sku: row.sku?.trim() ?? '',
      }

      const parsed = createInventoryItemSchema.safeParse(payload)
      if (!parsed.success || !normalizedCategory) {
        const firstIssue = !normalizedCategory
          ? 'Category must be flowers, decor, or consumables'
          : !parsed.success
            ? parsed.error.issues[0]?.message ?? 'Invalid row values'
            : 'Invalid row values'
        skippedRows.push({
          rowNumber,
          reason: firstIssue,
        })
        continue
      }

      const { error } = await supabase
        .from('inventory_items')
        .insert({
          tenant_id: context.data.tenantId,
          created_by: context.data.userId,
          name: parsed.data.name.trim(),
          category: normalizedCategory,
          unit: parsed.data.unit.trim(),
          cost: Number(parsed.data.cost),
          quantity_on_hand: Number(parsed.data.quantityOnHand),
          sku: parsed.data.sku.trim(),
        })

      if (error) {
        const reason = error.code === '23505'
          ? 'SKU already exists'
          : 'Insert failed'
        skippedRows.push({
          rowNumber,
          reason,
        })
        continue
      }

      importedCount += 1
    }

    return {
      success: true,
      data: {
        importedCount,
        skippedCount: skippedRows.length,
        skippedRows,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'INVENTORY_IMPORT_FAILED',
        message: 'Could not import inventory rows.',
      },
    }
  }
}
