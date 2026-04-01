import {
  cancelSubscription,
  fetchSubscriptionOverview,
  finalizeSubscriptionActivation,
  startBillingPortal,
  startSubscriptionCheckout,
} from '@/lib/actions/subscription'
import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import {
  cancelStripeSubscriptionAtPeriodEnd,
  createStripeCheckoutSession,
  createStripeCustomerPortalSession,
  getStripeCheckoutSession,
  getStripeSubscription,
  mapStripeSubscriptionStatus,
} from '@/lib/subscription/billing'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

jest.mock('@/lib/subscription/billing', () => ({
  cancelStripeSubscriptionAtPeriodEnd: jest.fn(),
  createStripeCheckoutSession: jest.fn(),
  createStripeCustomerPortalSession: jest.fn(),
  getStripeCheckoutSession: jest.fn(),
  getStripeSubscription: jest.fn(),
  mapStripeSubscriptionStatus: jest.fn((status: string | null | undefined) => {
    if (status === 'active' || status === 'trialing') return 'active'
    if (status === 'past_due' || status === 'unpaid') return 'past_due'
    if (status === 'canceled') return 'cancelled'
    return 'trial'
  }),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>
const headersMock = headers as jest.MockedFunction<typeof headers>
const cancelStripeSubscriptionAtPeriodEndMock = cancelStripeSubscriptionAtPeriodEnd as jest.MockedFunction<typeof cancelStripeSubscriptionAtPeriodEnd>
const createStripeCheckoutSessionMock = createStripeCheckoutSession as jest.MockedFunction<typeof createStripeCheckoutSession>
const createStripeCustomerPortalSessionMock = createStripeCustomerPortalSession as jest.MockedFunction<typeof createStripeCustomerPortalSession>
const getStripeCheckoutSessionMock = getStripeCheckoutSession as jest.MockedFunction<typeof getStripeCheckoutSession>
const getStripeSubscriptionMock = getStripeSubscription as jest.MockedFunction<typeof getStripeSubscription>
const mapStripeSubscriptionStatusMock = mapStripeSubscriptionStatus as jest.MockedFunction<typeof mapStripeSubscriptionStatus>

beforeEach(() => {
  jest.clearAllMocks()
  mapStripeSubscriptionStatusMock.mockImplementation((status: string | null | undefined) => {
    if (status === 'active' || status === 'trialing') return 'active'
    if (status === 'past_due' || status === 'unpaid') return 'past_due'
    if (status === 'canceled') return 'cancelled'
    return 'trial'
  })
  headersMock.mockResolvedValue(
    new Headers({
      host: 'eventvico.example',
      'x-forwarded-proto': 'https',
    }) as never
  )
})

describe('startSubscriptionCheckout', () => {
  it('returns checkout url on success', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'tenant-1',
                    plan_status: 'trial',
                    stripe_customer_id: null,
                    stripe_subscription_id: null,
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    createStripeCheckoutSessionMock.mockResolvedValue({
      success: true,
      data: {
        sessionId: 'cs_123',
        url: 'https://checkout.stripe.com/c/pay/cs_123',
      },
    })

    const result = await startSubscriptionCheckout()

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.url).toContain('checkout.stripe.com')
    }
  })

  it('returns checkout start failure when Stripe is unavailable', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'tenant-1',
                    plan_status: 'trial',
                    stripe_customer_id: null,
                    stripe_subscription_id: null,
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    createStripeCheckoutSessionMock.mockResolvedValue({
      success: false,
      error: {
        code: 'STRIPE_CHECKOUT_CREATE_FAILED',
        message: 'Stripe outage',
      },
    })

    const result = await startSubscriptionCheckout()

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('STRIPE_CHECKOUT_CREATE_FAILED')
    }
  })
})

describe('finalizeSubscriptionActivation', () => {
  it('activates tenant on completed paid subscription session', async () => {
    const tenantUpdateEq = jest.fn().mockResolvedValue({ error: null })
    const tenantUpdate = jest.fn().mockReturnValue({ eq: tenantUpdateEq })
    const outboxInsert = jest.fn().mockResolvedValue({ error: null })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'tenant-1',
                    plan_status: 'trial',
                    stripe_customer_id: null,
                    stripe_subscription_id: 'sub_123',
                  },
                }),
              }),
            }),
            update: tenantUpdate,
          }
        }
        if (table === 'email_outbox') {
          return {
            insert: outboxInsert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    getStripeCheckoutSessionMock.mockResolvedValue({
      success: true,
      data: {
        id: 'cs_123',
        url: null,
        status: 'complete',
        mode: 'subscription',
        payment_status: 'paid',
        customer: 'cus_123',
        subscription: 'sub_123',
        client_reference_id: 'tenant-1',
        metadata: { tenant_id: 'tenant-1' },
      },
    })

    const result = await finalizeSubscriptionActivation('cs_123')

    expect(result.success).toBe(true)
    expect(tenantUpdateEq).toHaveBeenCalledWith('id', 'tenant-1')
  })

  it('returns failure on incomplete payment session', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'tenant-1',
                    plan_status: 'trial',
                    stripe_customer_id: null,
                    stripe_subscription_id: 'sub_123',
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    getStripeCheckoutSessionMock.mockResolvedValue({
      success: true,
      data: {
        id: 'cs_123',
        url: null,
        status: 'open',
        mode: 'subscription',
        payment_status: 'unpaid',
        customer: null,
        subscription: null,
        client_reference_id: 'tenant-1',
        metadata: { tenant_id: 'tenant-1' },
      },
    })

    const result = await finalizeSubscriptionActivation('cs_123')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('CHECKOUT_NOT_COMPLETED')
    }
  })
})

describe('fetchSubscriptionOverview', () => {
  it('returns subscription summary for active Stripe subscription', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'tenant-1',
                    plan_status: 'active',
                    stripe_customer_id: 'cus_123',
                    stripe_subscription_id: 'sub_123',
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    getStripeSubscriptionMock.mockResolvedValue({
      success: true,
      data: {
        id: 'sub_123',
        status: 'active',
        customer: 'cus_123',
        cancel_at_period_end: false,
        cancel_at: null,
        current_period_end: 1893456000,
        latest_invoice: { id: 'in_123', status: 'paid', created: 1890800000 },
        items: { data: [{ price: { recurring: { interval: 'month', interval_count: 1 } } }] },
      },
    })

    const result = await fetchSubscriptionOverview()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.planName).toBe('Pro Plan')
      expect(result.data.lastPaymentStatus).toBe('paid')
    }
  })
})

describe('startBillingPortal', () => {
  it('returns Stripe customer portal URL', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'tenant-1',
                    plan_status: 'active',
                    stripe_customer_id: 'cus_123',
                    stripe_subscription_id: 'sub_123',
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    createStripeCustomerPortalSessionMock.mockResolvedValue({
      success: true,
      data: {
        url: 'https://billing.stripe.com/session/test_123',
      },
    })

    const result = await startBillingPortal()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.url).toContain('billing.stripe.com')
    }
  })
})

describe('cancelSubscription', () => {
  it('schedules cancellation at period end and returns cancel date', async () => {
    const tenantUpdateEq = jest.fn().mockResolvedValue({ error: null })
    const tenantUpdate = jest.fn().mockReturnValue({ eq: tenantUpdateEq })
    const outboxInsert = jest.fn().mockResolvedValue({ error: null })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
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
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'tenant-1',
                    plan_status: 'active',
                    stripe_customer_id: 'cus_123',
                    stripe_subscription_id: 'sub_123',
                  },
                }),
              }),
            }),
            update: tenantUpdate,
          }
        }
        if (table === 'email_outbox') {
          return {
            insert: outboxInsert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    cancelStripeSubscriptionAtPeriodEndMock.mockResolvedValue({
      success: true,
      data: {
        id: 'sub_123',
        status: 'active',
        customer: 'cus_123',
        cancel_at_period_end: true,
        cancel_at: 1893456000,
        current_period_end: 1893456000,
        latest_invoice: null,
      },
    })

    const result = await cancelSubscription()
    expect(result.success).toBe(true)
    expect(tenantUpdateEq).toHaveBeenCalledWith('id', 'tenant-1')
  })
})
