'use server'

import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/types/app'
import { getTenantContext, TenantContextResult } from './tenant-context'

type FetchRecipeBuilderSnapshotResult = ActionResult<{
  recipes: Array<{
    id: string
    name: string
    eventType: string | null
    clientId: string | null
    tags: string[]
  }>
  inventoryItems: Array<{
    id: string
    name: string
    category: 'flowers' | 'decor' | 'consumables'
    unit: string
    cost: number
    unavailable: boolean
  }>
  clients: Array<{
    id: string
    name: string
  }>
}>

type FetchRecipeItemsResult = ActionResult<{
  items: Array<{
    inventoryItemId: string
    name: string
    unit: string
    cost: number
    unavailable: boolean
    stemCount: number
    quantity: number
    position: number
  }>
}>

type SaveRecipeItemsResult = ActionResult<{ recipeId: string; itemCount: number }>
type CreateRecipeResult = ActionResult<{ recipeId: string }>
type UpdateRecipeMetadataResult = ActionResult<{ recipeId: string }>
type ConfirmAIDraftRecipeResult = ActionResult<{
  recipeId: string
  matchedCount: number
  skippedCount: number
}>
type SuggestSubstitutionsResult = ActionResult<{
  targetItemId: string
  suggestions: Array<{
    inventoryItemId: string
    name: string
    unit: string
    cost: number
    costDelta: number
  }>
}>
type SetInventoryUnavailableResult = ActionResult<{
  inventoryItemId: string
  unavailable: boolean
}>


export async function fetchRecipeBuilderSnapshot(): Promise<FetchRecipeBuilderSnapshotResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const [
      { data: recipes, error: recipesError },
      { data: inventoryItems, error: inventoryError },
      { data: clients, error: clientsError },
    ] = await Promise.all([
      supabase
        .from('recipes')
        .select('id, name, event_type, client_id, recipe_tags')
        .eq('tenant_id', context.data.tenantId)
        .order('created_at', { ascending: false }),
      supabase
        .from('inventory_items')
        .select('id, name, category, unit, cost, is_unavailable')
        .eq('tenant_id', context.data.tenantId)
        .order('name', { ascending: true }),
      supabase
        .from('clients')
        .select('id, name')
        .eq('tenant_id', context.data.tenantId)
        .order('name', { ascending: true }),
    ])

    if (recipesError || inventoryError || clientsError) {
      return {
        success: false,
        error: {
          code: 'RECIPE_SNAPSHOT_FETCH_FAILED',
          message: 'Could not load recipe builder data.',
        },
      }
    }

    return {
      success: true,
      data: {
        recipes: (recipes ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          eventType: item.event_type,
          clientId: item.client_id,
          tags: item.recipe_tags ?? [],
        })),
        inventoryItems: (inventoryItems ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          unit: item.unit,
          cost: Number(item.cost),
          unavailable: item.is_unavailable,
        })),
        clients: (clients ?? []).map((client) => ({
          id: client.id,
          name: client.name,
        })),
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'RECIPE_SNAPSHOT_FETCH_FAILED',
        message: 'Could not load recipe builder data.',
      },
    }
  }
}

export async function createRecipe(input?: unknown): Promise<CreateRecipeResult> {
  try {
    const name = (input as { name?: string } | undefined)?.name?.trim() || 'Untitled recipe'
    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('recipes')
      .insert({
        tenant_id: context.data.tenantId,
        created_by: context.data.userId,
        name,
        recipe_tags: [],
      })
      .select('id')
      .single()

    if (error || !data?.id) {
      return {
        success: false,
        error: {
          code: 'RECIPE_CREATE_FAILED',
          message: 'Could not create recipe.',
        },
      }
    }

    return {
      success: true,
      data: {
        recipeId: data.id,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'RECIPE_CREATE_FAILED',
        message: 'Could not create recipe.',
      },
    }
  }
}

export async function updateRecipeMetadata(input: unknown): Promise<UpdateRecipeMetadataResult> {
  try {
    const parsed = input as
      | {
          recipeId?: string
          eventType?: string | null
          clientId?: string | null
          tags?: string[]
        }
      | undefined

    const recipeId = parsed?.recipeId?.trim() ?? ''
    if (!recipeId) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing recipe identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const tags = (parsed?.tags ?? [])
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)

    const eventType = parsed?.eventType?.trim() || null
    const clientId = parsed?.clientId?.trim() || null

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('recipes')
      .update({
        event_type: eventType,
        client_id: clientId,
        recipe_tags: tags,
      })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', recipeId)
      .select('id')
      .single()

    if (error || !data?.id) {
      return {
        success: false,
        error: {
          code: 'RECIPE_UPDATE_FAILED',
          message: 'Could not update recipe metadata.',
        },
      }
    }

    return {
      success: true,
      data: {
        recipeId: data.id,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'RECIPE_UPDATE_FAILED',
        message: 'Could not update recipe metadata.',
      },
    }
  }
}

export async function fetchRecipeItems(recipeId: string): Promise<FetchRecipeItemsResult> {
  try {
    const normalizedRecipeId = recipeId.trim()
    if (!normalizedRecipeId) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing recipe identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('recipe_items')
      .select('inventory_item_id, stem_count, quantity, position')
      .eq('tenant_id', context.data.tenantId)
      .eq('recipe_id', normalizedRecipeId)
      .order('position', { ascending: true })

    if (error) {
      return {
        success: false,
        error: {
          code: 'RECIPE_ITEMS_FETCH_FAILED',
          message: 'Could not load recipe items.',
        },
      }
    }

    const inventoryIds = Array.from(new Set((data ?? []).map((item) => item.inventory_item_id)))
    const { data: inventoryItems } = await supabase
      .from('inventory_items')
      .select('id, name, unit, cost, is_unavailable')
      .in('id', inventoryIds)

    const inventoryById = new Map((inventoryItems ?? []).map((item) => [item.id, item]))
    const items = (data ?? []).flatMap((item) => {
      const inventory = inventoryById.get(item.inventory_item_id)
      if (!inventory) return []
      return [{
        inventoryItemId: item.inventory_item_id,
        name: inventory.name,
        unit: inventory.unit,
        cost: Number(inventory.cost),
        unavailable: inventory.is_unavailable,
        stemCount: item.stem_count,
        quantity: Number(item.quantity),
        position: item.position,
      }]
    })

    return {
      success: true,
      data: {
        items,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'RECIPE_ITEMS_FETCH_FAILED',
        message: 'Could not load recipe items.',
      },
    }
  }
}

export async function saveRecipeItems(input: unknown): Promise<SaveRecipeItemsResult> {
  try {
    const parsed = input as {
      recipeId?: string
      items?: Array<{
        inventoryItemId?: string
        stemCount?: number
        quantity?: number
        position?: number
      }>
    } | undefined

    const recipeId = parsed?.recipeId?.trim() ?? ''
    const items = parsed?.items ?? []

    if (!recipeId) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing recipe identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    await supabase
      .from('recipe_items')
      .delete()
      .eq('tenant_id', context.data.tenantId)
      .eq('recipe_id', recipeId)

    if (items.length > 0) {
      const payload = items
        .filter((item) => Boolean(item.inventoryItemId))
        .map((item, index) => ({
          tenant_id: context.data.tenantId,
          recipe_id: recipeId,
          inventory_item_id: item.inventoryItemId!,
          stem_count: Math.max(1, Math.floor(item.stemCount ?? 1)),
          quantity: Math.max(0.01, Number(item.quantity ?? 1)),
          position: index,
        }))

      const { error } = await supabase.from('recipe_items').insert(payload)
      if (error) {
        return {
          success: false,
          error: {
            code: 'RECIPE_ITEMS_SAVE_FAILED',
            message: 'Could not save recipe changes.',
          },
        }
      }
    }

    return {
      success: true,
      data: {
        recipeId,
        itemCount: items.length,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'RECIPE_ITEMS_SAVE_FAILED',
        message: 'Could not save recipe changes.',
      },
    }
  }
}

export async function confirmAIDraftRecipe(input: unknown): Promise<ConfirmAIDraftRecipeResult> {
  try {
    const parsed = input as
      | {
          recipeName?: string
          items?: Array<{
            name?: string
            stemCount?: number
            quantity?: number
          }>
        }
      | undefined

    const recipeName = parsed?.recipeName?.trim() || `AI Draft ${new Date().toLocaleDateString('en-US')}`
    const draftItems = parsed?.items ?? []
    if (draftItems.length === 0) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Add at least one draft item before confirming.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data: recipe, error: recipeError } = await supabase
      .from('recipes')
      .insert({
        tenant_id: context.data.tenantId,
        created_by: context.data.userId,
        name: recipeName,
      })
      .select('id')
      .single()

    if (recipeError || !recipe?.id) {
      return {
        success: false,
        error: {
          code: 'RECIPE_CREATE_FAILED',
          message: 'Could not confirm AI draft recipe.',
        },
      }
    }

    const { data: inventoryItems } = await supabase
      .from('inventory_items')
      .select('id, name')
      .eq('tenant_id', context.data.tenantId)

    const inventoryByName = new Map(
      (inventoryItems ?? []).map((item) => [item.name.trim().toLowerCase(), item.id])
    )

    const recipeItemsPayload = draftItems.flatMap((item, index) => {
      const normalizedName = item.name?.trim().toLowerCase() ?? ''
      const inventoryItemId = inventoryByName.get(normalizedName)
      if (!inventoryItemId) return []
      return [{
        tenant_id: context.data.tenantId,
        recipe_id: recipe.id,
        inventory_item_id: inventoryItemId,
        stem_count: Math.max(1, Math.floor(Number(item.stemCount ?? 1))),
        quantity: Math.max(0.01, Number(item.quantity ?? 1)),
        position: index,
      }]
    })

    if (recipeItemsPayload.length > 0) {
      const { error: insertError } = await supabase
        .from('recipe_items')
        .insert(recipeItemsPayload)

      if (insertError) {
        return {
          success: false,
          error: {
            code: 'RECIPE_ITEMS_SAVE_FAILED',
            message: 'Could not save confirmed AI draft items.',
          },
        }
      }
    }

    return {
      success: true,
      data: {
        recipeId: recipe.id,
        matchedCount: recipeItemsPayload.length,
        skippedCount: draftItems.length - recipeItemsPayload.length,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'RECIPE_CREATE_FAILED',
        message: 'Could not confirm AI draft recipe.',
      },
    }
  }
}

export async function setInventoryItemUnavailable(input: unknown): Promise<SetInventoryUnavailableResult> {
  try {
    const parsed = input as { inventoryItemId?: string; unavailable?: boolean } | undefined
    const inventoryItemId = parsed?.inventoryItemId?.trim() ?? ''
    const unavailable = parsed?.unavailable === true

    if (!inventoryItemId) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing inventory item identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('inventory_items')
      .update({ is_unavailable: unavailable })
      .eq('tenant_id', context.data.tenantId)
      .eq('id', inventoryItemId)
      .select('id, is_unavailable')
      .single()

    if (error || !data?.id) {
      return {
        success: false,
        error: {
          code: 'INVENTORY_UPDATE_FAILED',
          message: 'Could not update availability flag.',
        },
      }
    }

    return {
      success: true,
      data: {
        inventoryItemId: data.id,
        unavailable: data.is_unavailable,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'INVENTORY_UPDATE_FAILED',
        message: 'Could not update availability flag.',
      },
    }
  }
}

export async function suggestSubstitutions(input: unknown): Promise<SuggestSubstitutionsResult> {
  try {
    const parsed = input as { inventoryItemId?: string } | undefined
    const inventoryItemId = parsed?.inventoryItemId?.trim() ?? ''
    if (!inventoryItemId) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing inventory item identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) return context

    const supabase = await createClient()
    const { data: target } = await supabase
      .from('inventory_items')
      .select('id, category, cost')
      .eq('tenant_id', context.data.tenantId)
      .eq('id', inventoryItemId)
      .maybeSingle()

    if (!target?.id) {
      return {
        success: false,
        error: {
          code: 'INVENTORY_NOT_FOUND',
          message: 'Could not find the unavailable inventory item.',
        },
      }
    }

    const { data: alternatives } = await supabase
      .from('inventory_items')
      .select('id, name, unit, cost')
      .eq('tenant_id', context.data.tenantId)
      .eq('category', target.category)
      .eq('is_unavailable', false)
      .neq('id', inventoryItemId)
      .limit(6)

    const sorted = (alternatives ?? [])
      .map((item) => ({
        inventoryItemId: item.id,
        name: item.name,
        unit: item.unit,
        cost: Number(item.cost),
        costDelta: Number(item.cost) - Number(target.cost),
      }))
      .sort((a, b) => Math.abs(a.costDelta) - Math.abs(b.costDelta))
      .slice(0, 3)

    return {
      success: true,
      data: {
        targetItemId: inventoryItemId,
        suggestions: sorted,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'SUBSTITUTIONS_FETCH_FAILED',
        message: 'Could not suggest substitutions.',
      },
    }
  }
}
