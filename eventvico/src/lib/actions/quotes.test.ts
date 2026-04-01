import { createClient } from '@/lib/supabase/server'
import {
  addQuoteCustomLineItem,
  buildQuotePdf,
  buildShareableQuoteLink,
  createQuoteFromRecipes,
  createQuoteRevision,
  fetchQuoteAuditLog,
  fetchQuotesWithPricing,
  saveQuoteLineItems,
  sendQuoteToClient,
  setQuoteDiscountAndNote,
  setQuoteLockState,
} from '@/lib/actions/quotes'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('quote actions', () => {
  it('returns locked quote lines with snapshot difference indicators', async () => {
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
        if (table === 'quotes') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [{ id: 'quote-1', title: 'Spring Quote', status: 'locked' }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'quote_line_items') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{
                    id: 'line-1',
                    quote_id: 'quote-1',
                    inventory_item_id: 'inv-1',
                    description: 'Rose bundle',
                    quantity: 1,
                    unit_cost_snapshot: 5,
                    line_type: 'inventory',
                  }],
                }),
              }),
            }),
          }
        }
        if (table === 'inventory_items') {
          return {
            select: () => ({
              in: async () => ({
                data: [{ id: 'inv-1', cost: 6 }],
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchQuotesWithPricing()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quotes[0].lines[0].hasPriceDelta).toBe(true)
    }
  })

  it('creates quote from selected recipes with snapshot line items', async () => {
    const quoteInsertSingle = jest.fn().mockResolvedValue({
      data: { id: 'quote-new-1' },
      error: null,
    })
    const quoteInsertSelect = jest.fn().mockReturnValue({ single: quoteInsertSingle })
    const quoteInsert = jest.fn().mockReturnValue({ select: quoteInsertSelect })
    const lineInsert = jest.fn().mockResolvedValue({ error: null })
    const auditInsert = jest.fn().mockResolvedValue({ error: null })

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
        if (table === 'quotes') {
          return {
            insert: quoteInsert,
          }
        }
        if (table === 'recipe_items') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    { inventory_item_id: 'inv-1', quantity: 2 },
                    { inventory_item_id: 'inv-1', quantity: 1 },
                    { inventory_item_id: 'inv-2', quantity: 3 },
                  ],
                }),
              }),
            }),
          }
        }
        if (table === 'inventory_items') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    { id: 'inv-1', name: 'White Rose', cost: 5 },
                    { id: 'inv-2', name: 'Ranunculus', cost: 3.5 },
                  ],
                }),
              }),
            }),
          }
        }
        if (table === 'quote_line_items') {
          return {
            insert: lineInsert,
          }
        }
        if (table === 'quote_audit_logs') {
          return {
            insert: auditInsert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createQuoteFromRecipes({
      clientId: 'client-1',
      recipeIds: ['recipe-1', 'recipe-2'],
      title: 'Wedding Quote',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quoteId).toBe('quote-new-1')
      expect(result.data.lineCount).toBe(2)
    }
    expect(lineInsert).toHaveBeenCalled()
  })

  it('autosaves edited quote quantities', async () => {
    const updateEqId = jest.fn().mockResolvedValue({ data: null, error: null })
    const updateEqQuote = jest.fn().mockReturnValue({ eq: updateEqId })
    const updateEqTenant = jest.fn().mockReturnValue({ eq: updateEqQuote })
    const update = jest.fn().mockReturnValue({ eq: updateEqTenant })
    const quoteSelectMaybeSingle = jest.fn().mockResolvedValue({ data: { status: 'draft' } })

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
        if (table === 'quotes') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: quoteSelectMaybeSingle,
                }),
              }),
            }),
          }
        }
        if (table === 'quote_line_items') {
          return {
            update,
          }
        }
        if (table === 'quote_audit_logs') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await saveQuoteLineItems({
      quoteId: 'quote-1',
      lines: [
        { id: 'line-1', quantity: 3 },
        { id: 'line-2', quantity: 1.5 },
      ],
    })
    expect(result.success).toBe(true)
    expect(update).toHaveBeenCalled()
  })

  it('adds a custom line item with an audit entry', async () => {
    const lineInsertSingle = jest.fn().mockResolvedValue({ data: { id: 'line-123' }, error: null })
    const lineInsertSelect = jest.fn().mockReturnValue({ single: lineInsertSingle })
    const lineInsert = jest.fn().mockReturnValue({ select: lineInsertSelect })
    const auditInsert = jest.fn().mockResolvedValue({ error: null })

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
        if (table === 'quote_line_items') {
          return { insert: lineInsert }
        }
        if (table === 'quote_audit_logs') {
          return { insert: auditInsert }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await addQuoteCustomLineItem({
      quoteId: 'quote-1',
      description: 'Labor surcharge',
      quantity: 1,
      unitPrice: 45,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.lineId).toBe('line-123')
    }
    expect(auditInsert).toHaveBeenCalled()
  })

  it('sends quote to client and enqueues outbound email', async () => {
    const quoteUpdateEqId = jest.fn().mockResolvedValue({ data: null, error: null })
    const quoteUpdateEqTenant = jest.fn().mockReturnValue({ eq: quoteUpdateEqId })
    const quoteUpdate = jest.fn().mockReturnValue({ eq: quoteUpdateEqTenant })
    const tokenInsert = jest.fn().mockResolvedValue({ error: null })
    const outboxInsert = jest.fn().mockResolvedValue({ error: null })

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
        if (table === 'quotes') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 'quote-1', client_id: 'client-1', title: 'Proposal' } }),
                }),
              }),
            }),
            update: quoteUpdate,
          }
        }
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { email: 'client@example.com', name: 'Asha' } }),
                }),
              }),
            }),
          }
        }
        if (table === 'quote_share_tokens') {
          return { insert: tokenInsert }
        }
        if (table === 'email_outbox') {
          return { insert: outboxInsert }
        }
        if (table === 'quote_audit_logs') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await sendQuoteToClient({ quoteId: 'quote-1' })
    expect(result.success).toBe(true)
    expect(tokenInsert).toHaveBeenCalled()
    expect(outboxInsert).toHaveBeenCalled()
  })

  it('creates quote revision and copies line items', async () => {
    const quoteInsertSingle = jest.fn().mockResolvedValue({ data: { id: 'quote-rev-2' }, error: null })
    const quoteInsertSelect = jest.fn().mockReturnValue({ single: quoteInsertSingle })
    const quoteInsert = jest.fn().mockReturnValue({ select: quoteInsertSelect })
    const lineInsert = jest.fn().mockResolvedValue({ error: null })

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
        if (table === 'quotes') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'quote-1',
                      client_id: 'client-1',
                      title: 'Proposal',
                      note: 'hello',
                      discount_type: 'fixed',
                      discount_value: 10,
                      root_quote_id: null,
                      revision_number: 1,
                    },
                  }),
                }),
              }),
            }),
            insert: quoteInsert,
          }
        }
        if (table === 'quote_line_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{
                    inventory_item_id: 'inv-1',
                    description: 'White Rose',
                    quantity: 2,
                    unit_cost_snapshot: 5,
                    line_type: 'inventory',
                  }],
                }),
              }),
            }),
            insert: lineInsert,
          }
        }
        if (table === 'quote_audit_logs') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createQuoteRevision({ quoteId: 'quote-1' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quoteId).toBe('quote-rev-2')
      expect(result.data.revisionNumber).toBe(2)
    }
    expect(lineInsert).toHaveBeenCalled()
  })

  it('saves quote metadata and toggles lock state', async () => {
    const quoteUpdateEqId = jest.fn().mockResolvedValue({ data: null, error: null })
    const quoteUpdateEqTenant = jest.fn().mockReturnValue({ eq: quoteUpdateEqId })
    const quoteUpdate = jest.fn().mockReturnValue({ eq: quoteUpdateEqTenant })

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
        if (table === 'quotes') {
          return { update: quoteUpdate }
        }
        if (table === 'quote_audit_logs') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const metadataResult = await setQuoteDiscountAndNote({
      quoteId: 'quote-1',
      discountType: 'percent',
      discountValue: 5,
      note: 'Please approve by Friday',
    })
    expect(metadataResult.success).toBe(true)

    const lockResult = await setQuoteLockState({ quoteId: 'quote-1', lock: true })
    expect(lockResult.success).toBe(true)
    if (lockResult.success) {
      expect(lockResult.data.status).toBe('locked')
    }
  })

  it('loads audit entries and builds share links', async () => {
    const auditData = [{
      id: 'audit-1',
      quote_id: 'quote-1',
      action_type: 'quote_sent',
      action_payload: {},
      performed_by: 'user-1',
      created_at: '2026-03-31T10:00:00.000Z',
    }]

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
        if (table === 'quote_audit_logs') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({ data: auditData }),
                }),
              }),
            }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'quote_share_tokens') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const auditResult = await fetchQuoteAuditLog({ quoteId: 'quote-1' })
    expect(auditResult.success).toBe(true)
    if (auditResult.success) {
      expect(auditResult.data.entries).toHaveLength(1)
      expect(auditResult.data.entries[0].actionType).toBe('quote_sent')
    }

    const linkResult = await buildShareableQuoteLink({ quoteId: 'quote-1' })
    expect(linkResult.success).toBe(true)
    if (linkResult.success) {
      expect(linkResult.data.url.startsWith('/portal/')).toBe(true)
    }
  })

  it('builds a valid PDF payload for quote export', async () => {
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
        if (table === 'quotes') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'quote-1',
                      title: 'Spring Wedding',
                      revision_number: 2,
                      note: 'Deliver by 9am',
                      discount_type: 'fixed',
                      discount_value: 25,
                    },
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'quote_line_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [
                    { description: 'Rose', quantity: 5, unit_cost_snapshot: 3.5 },
                    { description: 'Tulip', quantity: 4, unit_cost_snapshot: 2.25 },
                  ],
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await buildQuotePdf({ quoteId: 'quote-1' })
    expect(result.success).toBe(true)
    if (result.success) {
      const decoded = Buffer.from(result.data.contentBase64, 'base64').toString('ascii')
      expect(result.data.filename).toBe('spring-wedding-v2.pdf')
      expect(decoded.startsWith('%PDF-1.4')).toBe(true)
      expect(decoded).toContain('startxref')
    }
  })
})
