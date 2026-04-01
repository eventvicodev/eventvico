import { createClient } from '@/lib/supabase/server'
import {
  exportEventsIcal,
  updateFulfillmentStatus,
  upsertEvent,
} from '@/lib/actions/events'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('event actions', () => {
  it('validates required fields before saving event', async () => {
    const result = await upsertEvent({ name: '', recipeIds: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('exports iCal content for tenant events', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
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
                  data: [{
                    id: 'event-1',
                    name: 'Wedding Setup',
                    start_at: '2026-04-10T10:00:00.000Z',
                    end_at: '2026-04-10T14:00:00.000Z',
                  }],
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await exportEventsIcal({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.filename.endsWith('.ics')).toBe(true)
      expect(result.data.content).toContain('BEGIN:VEVENT')
      expect(result.data.content).toContain('SUMMARY:Wedding Setup')
    }
  })

  it('updates fulfillment item and reports event completion', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
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
        if (table === 'event_fulfillment_items') {
          return {
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: { event_id: 'event-1' } }),
                  }),
                }),
              }),
            }),
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ status: 'delivered' }, { status: 'delivered' }],
                }),
              }),
            }),
          }
        }
        if (table === 'event_metadata') {
          return {
            update: () => ({
              eq: () => ({
                eq: async () => ({ data: null, error: null }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await updateFulfillmentStatus({ itemId: 'item-1', status: 'delivered' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.allDelivered).toBe(true)
    }
  })

  it('reverts event status from fulfillment_complete when an item is no longer delivered', async () => {
    const metadataEqStatus = jest.fn().mockResolvedValue({ data: null, error: null })
    const metadataEqEvent = jest.fn().mockReturnValue({ eq: metadataEqStatus })
    const metadataEqTenant = jest.fn().mockReturnValue({ eq: metadataEqEvent })
    const metadataUpdate = jest.fn().mockReturnValue({ eq: metadataEqTenant })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
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
        if (table === 'event_fulfillment_items') {
          return {
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: { event_id: 'event-1' } }),
                  }),
                }),
              }),
            }),
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ status: 'delivered' }, { status: 'packed' }],
                }),
              }),
            }),
          }
        }
        if (table === 'event_metadata') {
          return {
            update: metadataUpdate,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await updateFulfillmentStatus({ itemId: 'item-1', status: 'packed' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.allDelivered).toBe(false)
    }
    expect(metadataUpdate).toHaveBeenCalledWith({ status: 'in_progress' })
  })
})
