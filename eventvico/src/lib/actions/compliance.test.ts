import { createClient } from '@/lib/supabase/server'
import {
  recordOutboxDeliveryFailure,
  requestClientDataDeletion,
  runImageLifecycleSweep,
} from '@/lib/actions/compliance'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('compliance actions', () => {
  it('returns warning when upcoming-event deletion is not confirmed', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }) }),
            }),
          }
        }
        if (table === 'event_metadata') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  gte: async () => ({ data: [{ event_id: 'event-1' }] }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await requestClientDataDeletion({ clientId: 'client-1', confirmImpact: false })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('UPCOMING_EVENT_WARNING')
    }
  })

  it('requeues failed outbox email when under retry limit', async () => {
    const updateEq = jest.fn().mockResolvedValue({ data: null, error: null })
    const update = jest.fn().mockReturnValue({ eq: updateEq })

    createClientMock.mockResolvedValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'email_outbox') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: 1, tenant_id: 'tenant-1', retry_count: 1 } }) }),
            }),
            update,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await recordOutboxDeliveryFailure({ outboxId: 1, errorMessage: 'SMTP timeout' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('pending')
    }
    expect(update).toHaveBeenCalled()
  })

  it('returns lifecycle sweep counts', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }) }),
            }),
          }
        }
        if (table === 'image_assets') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  lt: async () => ({ data: [{ id: 'asset-1' }] }),
                }),
                in: () => ({
                  lt: async () => ({ data: [{ id: 'asset-2' }] }),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                in: async () => ({ data: null, error: null }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await runImageLifecycleSweep({ nowIso: '2026-04-01T12:00:00.000Z' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.archivedCount).toBe(1)
      expect(result.data.purgedCount).toBe(1)
    }
  })
})
