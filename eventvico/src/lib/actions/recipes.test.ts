import { createClient } from '@/lib/supabase/server'
import {
  confirmAIDraftRecipe,
  createRecipe,
  fetchRecipeBuilderSnapshot,
  fetchRecipeItems,
  saveRecipeItems,
  setInventoryItemUnavailable,
  suggestSubstitutions,
  updateRecipeMetadata,
} from '@/lib/actions/recipes'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('recipe actions', () => {
  it('fetches recipe builder snapshot', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'recipes') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [{ id: 'recipe-1', name: 'Bridal Bouquet' }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'inventory_items') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [{ id: 'inv-1', name: 'White Rose', category: 'flowers', unit: 'stems', cost: 2.5, is_unavailable: false }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [{ id: 'client-1', name: 'Ava Chen' }],
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchRecipeBuilderSnapshot()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.recipes.length).toBe(1)
      expect(result.data.inventoryItems.length).toBe(1)
      expect(result.data.clients.length).toBe(1)
    }
  })

  it('creates a recipe', async () => {
    const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'recipe-1' }, error: null })
    const insertSelect = jest.fn().mockReturnValue({ single: insertSingle })
    const insert = jest.fn().mockReturnValue({ select: insertSelect })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'recipes') {
          return {
            insert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createRecipe({ name: 'Bridal Bouquet' })
    expect(result.success).toBe(true)
  })

  it('updates recipe metadata for organization fields', async () => {
    const updateSingle = jest.fn().mockResolvedValue({ data: { id: 'recipe-1' }, error: null })
    const updateEqRecipe = jest.fn().mockReturnValue({ select: () => ({ single: updateSingle }) })
    const updateEqTenant = jest.fn().mockReturnValue({ eq: updateEqRecipe })
    const update = jest.fn().mockReturnValue({ eq: updateEqTenant })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'recipes') {
          return {
            update,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await updateRecipeMetadata({
      recipeId: 'recipe-1',
      eventType: 'wedding',
      clientId: 'client-1',
      tags: ['spring', 'garden'],
    })
    expect(result.success).toBe(true)
  })

  it('fetches recipe items and hydrates inventory metadata', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'recipe_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({
                    data: [{
                      inventory_item_id: 'inv-1',
                      stem_count: 12,
                      quantity: 2,
                      position: 0,
                    }],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'inventory_items') {
          return {
            select: () => ({
              in: async () => ({
                data: [{ id: 'inv-1', name: 'White Rose', unit: 'stems', cost: 2.5 }],
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchRecipeItems('recipe-1')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.items[0].name).toBe('White Rose')
    }
  })

  it('saves recipe items by replacing existing rows', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null })
    const deleteEqRecipe = jest.fn().mockResolvedValue({ error: null })
    const deleteEqTenant = jest.fn().mockReturnValue({ eq: deleteEqRecipe })
    const del = jest.fn().mockReturnValue({ eq: deleteEqTenant })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'recipe_items') {
          return {
            delete: del,
            insert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await saveRecipeItems({
      recipeId: 'recipe-1',
      items: [{ inventoryItemId: 'inv-1', stemCount: 10, quantity: 1 }],
    })

    expect(result.success).toBe(true)
    expect(del).toHaveBeenCalled()
    expect(insert).toHaveBeenCalled()
  })

  it('confirms AI draft by creating recipe and matching known inventory items', async () => {
    const recipeInsertSingle = jest.fn().mockResolvedValue({ data: { id: 'recipe-2' }, error: null })
    const recipeInsertSelect = jest.fn().mockReturnValue({ single: recipeInsertSingle })
    const recipeInsert = jest.fn().mockReturnValue({ select: recipeInsertSelect })
    const recipeItemsInsert = jest.fn().mockResolvedValue({ error: null })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'recipes') {
          return {
            insert: recipeInsert,
          }
        }
        if (table === 'inventory_items') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { id: 'inv-1', name: 'White Rose' },
                  { id: 'inv-2', name: 'Ranunculus' },
                ],
              }),
            }),
          }
        }
        if (table === 'recipe_items') {
          return {
            insert: recipeItemsInsert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await confirmAIDraftRecipe({
      recipeName: 'AI Draft Bridal',
      items: [
        { name: 'White Rose', stemCount: 24, quantity: 1 },
        { name: 'Unknown Bloom', stemCount: 8, quantity: 1 },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.recipeId).toBe('recipe-2')
      expect(result.data.matchedCount).toBe(1)
      expect(result.data.skippedCount).toBe(1)
    }
    expect(recipeInsert).toHaveBeenCalled()
    expect(recipeItemsInsert).toHaveBeenCalled()
  })

  it('marks inventory item as unavailable', async () => {
    const updateSingle = jest.fn().mockResolvedValue({
      data: { id: 'inv-1', is_unavailable: true },
      error: null,
    })
    const updateEqId = jest.fn().mockReturnValue({ select: () => ({ single: updateSingle }) })
    const updateEqTenant = jest.fn().mockReturnValue({ eq: updateEqId })
    const update = jest.fn().mockReturnValue({ eq: updateEqTenant })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'inventory_items') {
          return {
            update,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await setInventoryItemUnavailable({
      inventoryItemId: 'inv-1',
      unavailable: true,
    })
    expect(result.success).toBe(true)
  })

  it('suggests substitutions from same category and excludes unavailable alternatives', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'inventory_items') {
          return {
            select: (columns: string) => {
              if (columns.includes('id, category, cost')) {
                return {
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({
                        data: { id: 'inv-1', category: 'flowers', cost: 5.5 },
                      }),
                    }),
                  }),
                }
              }
              return {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      neq: () => ({
                        limit: async () => ({
                          data: [
                            { id: 'inv-2', name: 'Garden Rose', unit: 'stems', cost: 6.25 },
                            { id: 'inv-3', name: 'Lisianthus', unit: 'stems', cost: 5.0 },
                          ],
                        }),
                      }),
                    }),
                  }),
                }),
              }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await suggestSubstitutions({ inventoryItemId: 'inv-1' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.suggestions.length).toBe(2)
    }
  })
})
