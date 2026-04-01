import crypto from 'node:crypto'
import { POST } from '@/app/api/webhooks/stripe/route'
import { createAdminClient } from '@/lib/supabase/admin'

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}))

const createAdminClientMock = createAdminClient as jest.MockedFunction<typeof createAdminClient>

function signPayload(secret: string, payload: string) {
  const timestamp = Math.floor(Date.now() / 1000)
  const signedPayload = `${timestamp}.${payload}`
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

function makeAdminClient() {
  const eq = jest.fn().mockResolvedValue({ error: null })
  const maybeSingle = jest.fn().mockResolvedValue({
    data: {
      id: 'tenant-1',
      name: 'Bloom Studio',
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
    },
  })

  return {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle,
            }),
          }),
          update: () => ({
            eq,
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [{ id: 'owner-user-1' }],
              }),
            }),
          }),
        }
      }
      if (table === 'email_outbox') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue({
          data: {
            user: { email: 'owner@example.com' },
          },
        }),
      },
    },
  }
}

describe('stripe webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 503 when webhook secret is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET

    const request = new Request('https://eventvico.example/api/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request)

    expect(response.status).toBe(503)
  })

  it('returns 400 for invalid signatures', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'

    const request = new Request('https://eventvico.example/api/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }),
      headers: {
        'stripe-signature': 't=1,v1=invalid',
      },
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('accepts valid checkout completion event', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'

    createAdminClientMock.mockImplementation(() => makeAdminClient() as never)

    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_123',
          subscription: 'sub_123',
        },
      },
    })

    const request = new Request('https://eventvico.example/api/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers: {
        'stripe-signature': signPayload(process.env.STRIPE_WEBHOOK_SECRET, payload),
      },
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it('handles subscription updated with payment_failed lifecycle processing', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'

    createAdminClientMock.mockImplementation(() => makeAdminClient() as never)

    const payload = JSON.stringify({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'past_due',
          cancel_at_period_end: false,
          current_period_end: 1893456000,
        },
      },
    })

    const request = new Request('https://eventvico.example/api/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers: {
        'stripe-signature': signPayload(process.env.STRIPE_WEBHOOK_SECRET, payload),
      },
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
  })
})
