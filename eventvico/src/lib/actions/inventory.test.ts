import { createClient } from '@/lib/supabase/server'
import {
  allocateInventoryToEvent,
  applyInventoryScan,
  createAllocationEvent,
  createInventoryItem,
  deleteInventoryItem,
  fetchInventoryItems,
  importInventoryRows,
  linkInventoryBarcode,
  listAllocationEvents,
  resolveInventoryBarcode,
  updateInventoryItem,
} from '@/lib/actions/inventory'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('inventory actions', () => {
  it('returns tenant-scoped inventory records', async () => {
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
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'item-1',
                      name: 'White Rose',
                      category: 'flowers',
                      unit: 'stems',
                      cost: 2.5,
                      quantity_on_hand: 120,
                      sku: 'FLR-001',
                      barcode_value: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'inventory_allocations') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ inventory_item_id: 'item-1', quantity_committed: 20 }],
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchInventoryItems()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tenantId).toBe('tenant-1')
      expect(result.data.items.length).toBe(1)
      expect(result.data.items[0]).toEqual(
          expect.objectContaining({
            name: 'White Rose',
            category: 'flowers',
            cost: 2.5,
            quantityOnHand: 120,
            quantityCommitted: 20,
            quantityAvailable: 100,
          })
      )
    }
  })

  it('filters out rows with invalid categories', async () => {
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
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'item-1',
                      name: 'Invalid Item',
                      category: 'other',
                      unit: 'pcs',
                      cost: 5,
                      quantity_on_hand: 10,
                      sku: 'INV-1',
                      barcode_value: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'inventory_allocations') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({ data: [] }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchInventoryItems()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.items).toEqual([])
    }
  })

  it('creates an inventory item', async () => {
    const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'item-1' }, error: null })
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
        if (table === 'inventory_items') {
          return {
            insert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createInventoryItem({
      name: 'White Rose',
      category: 'flowers',
      unit: 'stems',
      cost: '2.50',
      quantityOnHand: '120',
      sku: 'FLR-001',
    })

    expect(result.success).toBe(true)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        created_by: 'user-1',
        name: 'White Rose',
      })
    )
  })

  it('updates an inventory item', async () => {
    const updateSingle = jest.fn().mockResolvedValue({ data: { id: 'item-1' }, error: null })
    const updateEqTenant = jest.fn().mockReturnValue({ select: () => ({ single: updateSingle }) })
    const updateEqId = jest.fn().mockReturnValue({ eq: updateEqTenant })
    const update = jest.fn().mockReturnValue({ eq: updateEqId })
    const selectMaybeSingle = jest.fn().mockResolvedValue({ data: { cost: 2.5 } })
    const selectEqTenant = jest.fn().mockReturnValue({ maybeSingle: selectMaybeSingle })
    const selectEqId = jest.fn().mockReturnValue({ eq: selectEqTenant })
    const quoteLineUpdateIn = jest.fn().mockResolvedValue({ data: null, error: null })
    const quoteLineUpdateEqInventory = jest.fn().mockReturnValue({ in: quoteLineUpdateIn })
    const quoteLineUpdateEqTenant = jest.fn().mockReturnValue({ eq: quoteLineUpdateEqInventory })
    const quoteLineUpdate = jest.fn().mockReturnValue({ eq: quoteLineUpdateEqTenant })

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
            select: () => ({
              eq: selectEqId,
            }),
            update,
          }
        }
        if (table === 'recipe_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ recipe_id: 'recipe-1' }, { recipe_id: 'recipe-2' }, { recipe_id: 'recipe-1' }],
                }),
              }),
            }),
          }
        }
        if (table === 'quotes') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'quote-open-1' }, { id: 'quote-open-2' }],
                }),
              }),
            }),
          }
        }
        if (table === 'quote_line_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: async () => ({
                    data: [
                      { id: 'qli-1', quote_id: 'quote-open-1' },
                      { id: 'qli-2', quote_id: 'quote-open-1' },
                    ],
                  }),
                }),
              }),
            }),
            update: quoteLineUpdate,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await updateInventoryItem({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'White Rose',
      category: 'flowers',
      unit: 'stems',
      cost: '3.00',
      quantityOnHand: '110',
      sku: 'FLR-001',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.priceChanged).toBe(true)
      expect(result.data.repricedRecipeCount).toBe(2)
      expect(result.data.repricedQuoteCount).toBe(1)
    }
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'White Rose',
        cost: 3,
        quantity_on_hand: 110,
      })
    )
  })

  it('deletes an inventory item', async () => {
    const deleteSingle = jest.fn().mockResolvedValue({ data: { id: 'item-1' }, error: null })
    const deleteEqTenant = jest.fn().mockReturnValue({ select: () => ({ single: deleteSingle }) })
    const deleteEqId = jest.fn().mockReturnValue({ eq: deleteEqTenant })
    const del = jest.fn().mockReturnValue({ eq: deleteEqId })

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
            delete: del,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await deleteInventoryItem({
      id: '123e4567-e89b-12d3-a456-426614174000',
    })

    expect(result.success).toBe(true)
    expect(del).toHaveBeenCalled()
  })

  it('returns validation errors for invalid payload', async () => {
    const result = await createInventoryItem({
      name: '',
      category: 'flowers',
      unit: '',
      cost: '-1',
      quantityOnHand: '-2',
      sku: '',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.fields?.cost).toBeDefined()
      expect(result.error.fields?.quantityOnHand).toBeDefined()
    }
  })

  it('imports valid rows and returns skipped rows summary', async () => {
    const insert = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'item-1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23505' } })

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
            insert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await importInventoryRows({
      rows: [
        {
          rowNumber: 2,
          name: 'White Rose',
          category: 'flowers',
          unit: 'stems',
          cost: '2.50',
          quantityOnHand: '120',
          sku: 'FLR-001',
        },
        {
          rowNumber: 3,
          name: 'White Rose 2',
          category: 'flowers',
          unit: 'stems',
          cost: '2.50',
          quantityOnHand: '50',
          sku: 'FLR-001',
        },
        {
          rowNumber: 4,
          name: 'Bad Category',
          category: 'unknown',
          unit: 'stems',
          cost: '2.50',
          quantityOnHand: '50',
          sku: 'FLR-002',
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.importedCount).toBe(1)
      expect(result.data.skippedCount).toBe(2)
      expect(result.data.skippedRows.length).toBe(2)
    }
  })

  it('links barcode to inventory item', async () => {
    const updateSingle = jest.fn().mockResolvedValue({
      data: { id: 'item-1', barcode_value: 'ABC123' },
      error: null,
    })
    const updateEqTenant = jest.fn().mockReturnValue({ select: () => ({ single: updateSingle }) })
    const updateEqId = jest.fn().mockReturnValue({ eq: updateEqTenant })
    const update = jest.fn().mockReturnValue({ eq: updateEqId })

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
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null }),
                }),
              }),
            }),
            update,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await linkInventoryBarcode({
      itemId: 'item-1',
      code: 'abc123',
    })

    expect(result.success).toBe(true)
    if (result.success && 'barcodeValue' in result.data) {
      expect(result.data.barcodeValue).toBe('ABC123')
    }
  })

  it('returns collision payload when barcode is linked to another item', async () => {
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
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 'item-2', name: 'Linked Item' } }),
                }),
              }),
            }),
            update: jest.fn(),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await linkInventoryBarcode({
      itemId: 'item-1',
      code: 'abc123',
    })

    expect(result.success).toBe(true)
    if (result.success && 'status' in result.data) {
      expect(result.data.status).toBe('collision')
      expect(result.data.existingItemName).toBe('Linked Item')
    }
  })

  it('resolves linked barcode to inventory item', async () => {
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
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'item-1',
                      name: 'White Rose',
                      unit: 'stems',
                      sku: 'FLR-001',
                      quantity_on_hand: 120,
                    },
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await resolveInventoryBarcode('abc123')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.item.name).toBe('White Rose')
    }
  })

  it('lists allocation events', async () => {
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
        if (table === 'events') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'event-1',
                      name: 'Spring Wedding',
                      start_at: '2026-04-02T10:00:00.000Z',
                      end_at: '2026-04-02T18:00:00.000Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await listAllocationEvents()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.events[0]).toEqual(
        expect.objectContaining({
          id: 'event-1',
          name: 'Spring Wedding',
        })
      )
    }
  })

  it('creates allocation event', async () => {
    const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'event-1' }, error: null })
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
        if (table === 'events') {
          return {
            insert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createAllocationEvent({
      name: 'Wedding',
      startAt: '2026-04-10T11:00',
      endAt: '2026-04-10T17:00',
    })
    expect(result.success).toBe(true)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        created_by: 'user-1',
        name: 'Wedding',
      })
    )
  })

  it('returns over-allocation warning unless forced', async () => {
    const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'alloc-1' }, error: null })
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
        if (table === 'inventory_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'item-1',
                      quantity_on_hand: 10,
                    },
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'inventory_allocations') {
          return {
            select: (columns: string) => {
              if (columns.includes('id, quantity_committed')) {
                return {
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: async () => ({ data: null }),
                      }),
                    }),
                  }),
                }
              }
              return {
                eq: () => ({
                  eq: async () => ({
                    data: [{ quantity_committed: 8 }],
                  }),
                }),
              }
            },
            insert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const warningResult = await allocateInventoryToEvent({
      inventoryItemId: 'item-1',
      eventId: 'event-1',
      quantityCommitted: 5,
    })
    expect(warningResult.success).toBe(true)
    if (warningResult.success && 'status' in warningResult.data) {
      expect(warningResult.data.status).toBe('warning')
      expect(warningResult.data.availableQuantity).toBe(2)
    }

    const forcedResult = await allocateInventoryToEvent({
      inventoryItemId: 'item-1',
      eventId: 'event-1',
      quantityCommitted: 5,
      force: true,
    })
    expect(forcedResult.success).toBe(true)
    if (forcedResult.success && 'allocationId' in forcedResult.data) {
      expect(forcedResult.data.allocationId).toBe('alloc-1')
    }
  })

  it('applies scanned stock quantity update', async () => {
    const updateSingle = jest.fn().mockResolvedValue({
      data: { id: 'item-1', quantity_on_hand: 150 },
      error: null,
    })
    const updateEqTenant = jest.fn().mockReturnValue({ select: () => ({ single: updateSingle }) })
    const updateEqId = jest.fn().mockReturnValue({ eq: updateEqTenant })
    const update = jest.fn().mockReturnValue({ eq: updateEqId })

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
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'item-1',
                      name: 'White Rose',
                      unit: 'stems',
                      sku: 'FLR-001',
                      quantity_on_hand: 120,
                    },
                  }),
                }),
              }),
            }),
            update,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await applyInventoryScan({
      code: 'abc123',
      quantityOnHand: 150,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quantityOnHand).toBe(150)
    }
  })
})
