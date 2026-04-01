import { createAdminClient } from '@/lib/supabase/admin'
import {
  approveQuoteFromPortal,
  fetchPortalSnapshot,
  requestNewPortalLink,
  requestQuoteChangesFromPortal,
} from '@/lib/actions/portal'

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}))

const createAdminClientMock = createAdminClient as jest.MockedFunction<typeof createAdminClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('portal actions', () => {
  it('returns expiry error for expired portal link', async () => {
    createAdminClientMock.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'quote_share_tokens') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'token-1',
                    token: 'expired',
                    tenant_id: 'tenant-1',
                    quote_id: 'quote-1',
                    client_id: 'client-1',
                    expires_at: '2020-01-01T00:00:00.000Z',
                    consumed_at: null,
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchPortalSnapshot({ token: 'expired' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PORTAL_LINK_EXPIRED')
    }
  })

  it('rejects a portal link after first use', async () => {
    createAdminClientMock.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'quote_share_tokens') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'token-1',
                    token: 'used-token',
                    tenant_id: 'tenant-1',
                    quote_id: 'quote-1',
                    client_id: 'client-1',
                    expires_at: '2099-01-01T00:00:00.000Z',
                    consumed_at: '2026-03-31T10:00:00.000Z',
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchPortalSnapshot({ token: 'used-token' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PORTAL_LINK_USED')
    }
  })

  it('allows snapshot load then one approval with the same token', async () => {
    let consumedAt: string | null = null
    const quoteUpdateEqId = jest.fn().mockResolvedValue({ data: null, error: null })
    const quoteUpdateEqTenant = jest.fn().mockReturnValue({ eq: quoteUpdateEqId })
    const quoteUpdate = jest.fn().mockReturnValue({ eq: quoteUpdateEqTenant })

    const getUserById = jest.fn().mockResolvedValue({
      data: { user: { email: 'owner@studio.com' } },
      error: null,
    })

    createAdminClientMock.mockReturnValue({
      auth: {
        admin: {
          getUserById,
        },
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'quote_share_tokens') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'token-1',
                    token: 'valid-token',
                    tenant_id: 'tenant-1',
                    quote_id: 'quote-1',
                    client_id: 'client-1',
                    expires_at: '2099-01-01T00:00:00.000Z',
                    consumed_at: consumedAt,
                  },
                }),
              }),
            }),
            update: () => ({
              eq: async () => {
                consumedAt = '2026-04-01T12:00:00.000Z'
                return { data: null, error: null }
              },
            }),
          }
        }
        if (table === 'quotes') {
          return {
            select: () => ({
              eq: (column: string) => {
                if (column === 'id') {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: 'quote-1',
                        title: 'Wedding Quote',
                        status: 'sent',
                        note: null,
                        discount_type: null,
                        discount_value: 0,
                        root_quote_id: null,
                        client_id: 'client-1',
                      },
                    }),
                  }
                }
                return {
                  or: () => ({
                    order: async () => ({
                      data: [{
                        id: 'quote-1',
                        revision_number: 1,
                        status: 'sent',
                        created_at: '2026-04-01T10:00:00.000Z',
                      }],
                    }),
                  }),
                }
              },
            }),
            update: quoteUpdate,
          }
        }
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    name: 'Client One',
                    email: 'client@example.com',
                    event_date: '2026-05-01',
                    venue: 'Main Hall',
                  },
                }),
              }),
            }),
          }
        }
        if (table === 'quote_line_items') {
          return {
            select: () => ({
              in: async () => ({
                data: [{
                  id: 'line-1',
                  quote_id: 'quote-1',
                  description: 'Rose stems',
                  quantity: 10,
                  unit_cost_snapshot: 2.5,
                  line_type: 'inventory',
                }],
              }),
              eq: () => ({
                order: async () => ({
                  data: [{
                    id: 'line-1',
                    description: 'Rose stems',
                    quantity: 10,
                    unit_cost_snapshot: 2.5,
                    line_type: 'inventory',
                  }],
                }),
              }),
            }),
          }
        }
        if (table === 'quote_audit_logs') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async () => ({ data: [] }),
                  }),
                }),
              }),
            }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'email_outbox') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'owner-1', role: 'owner' }],
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const snapshot = await fetchPortalSnapshot({ token: 'valid-token' })
    expect(snapshot.success).toBe(true)

    const firstApproval = await approveQuoteFromPortal({ token: 'valid-token' })
    expect(firstApproval.success).toBe(true)
    expect(quoteUpdate).toHaveBeenCalled()

    const secondApproval = await approveQuoteFromPortal({ token: 'valid-token' })
    expect(secondApproval.success).toBe(false)
    if (!secondApproval.success) {
      expect(secondApproval.error.code).toBe('PORTAL_LINK_USED')
    }
  })

  it('approves quote and creates notification outbox event', async () => {
    const tokenUpdateEq = jest.fn().mockResolvedValue({ data: null, error: null })
    const tokenUpdate = jest.fn().mockReturnValue({ eq: tokenUpdateEq })
    const quoteUpdateEqId = jest.fn().mockResolvedValue({ data: null, error: null })
    const quoteUpdateEqTenant = jest.fn().mockReturnValue({ eq: quoteUpdateEqId })
    const quoteUpdate = jest.fn().mockReturnValue({ eq: quoteUpdateEqTenant })
    const outboxInsert = jest.fn().mockResolvedValue({ error: null })

    const getUserById = jest.fn().mockResolvedValue({
      data: { user: { email: 'owner@studio.com' } },
      error: null,
    })

    createAdminClientMock.mockReturnValue({
      auth: {
        admin: {
          getUserById,
        },
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'quote_share_tokens') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'token-1',
                    token: 'valid-token',
                    tenant_id: 'tenant-1',
                    quote_id: 'quote-1',
                    client_id: 'client-1',
                    expires_at: '2099-01-01T00:00:00.000Z',
                    consumed_at: null,
                  },
                }),
              }),
            }),
            update: tokenUpdate,
          }
        }
        if (table === 'quotes') {
          return {
            update: quoteUpdate,
          }
        }
        if (table === 'quote_audit_logs') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'email_outbox') {
          return {
            insert: outboxInsert,
          }
        }
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'owner-1', role: 'owner' }],
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await approveQuoteFromPortal({ token: 'valid-token' })
    expect(result.success).toBe(true)
    expect(outboxInsert).toHaveBeenCalled()
    expect(quoteUpdate).toHaveBeenCalled()
  })

  it('validates change request note', async () => {
    const result = await requestQuoteChangesFromPortal({ token: 'valid-token', note: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('requests new portal link notification for studio', async () => {
    const outboxInsert = jest.fn().mockResolvedValue({ error: null })
    const getUserById = jest.fn().mockResolvedValue({
      data: { user: { email: 'owner@studio.com' } },
      error: null,
    })

    createAdminClientMock.mockReturnValue({
      auth: {
        admin: {
          getUserById,
        },
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'quote_share_tokens') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    tenant_id: 'tenant-1',
                    quote_id: 'quote-1',
                    client_id: 'client-1',
                  },
                }),
              }),
            }),
          }
        }
        if (table === 'quote_audit_logs') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'email_outbox') {
          return {
            insert: outboxInsert,
          }
        }
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: 'owner-1', role: 'owner' }],
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await requestNewPortalLink({ token: 'old-token' })
    expect(result.success).toBe(true)
    expect(outboxInsert).toHaveBeenCalled()
  })
})
