import {
  cancelStripeSubscriptionAtPeriodEnd,
  createStripeCheckoutSession,
  createStripeCustomerPortalSession,
  getStripeCheckoutSession,
  getStripeSubscription,
  mapStripeSubscriptionStatus,
} from '@/lib/subscription/billing'

describe('mapStripeSubscriptionStatus', () => {
  it('maps active and trialing to active', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('active')
    expect(mapStripeSubscriptionStatus('trialing')).toBe('active')
  })

  it('maps delinquent states to past_due', () => {
    expect(mapStripeSubscriptionStatus('past_due')).toBe('past_due')
    expect(mapStripeSubscriptionStatus('unpaid')).toBe('past_due')
  })

  it('maps canceled to cancelled', () => {
    expect(mapStripeSubscriptionStatus('canceled')).toBe('cancelled')
  })
})

describe('billing Stripe calls', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = {
      ...originalEnv,
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_PRICE_ID: 'price_123',
    }
    global.fetch = jest.fn()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns checkout URL when Stripe session creation succeeds', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      }),
    })

    const result = await createStripeCheckoutSession({
      customerEmail: 'owner@example.com',
      tenantId: 'tenant-1',
      successUrl: 'https://eventvico.example/subscription/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://eventvico.example/subscription?checkout=cancelled',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.url).toContain('checkout.stripe.com')
    }
  })

  it('returns outage-style error when Stripe fails session creation', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Stripe outage' } }),
    })

    const result = await createStripeCheckoutSession({
      customerEmail: 'owner@example.com',
      tenantId: 'tenant-1',
      successUrl: 'https://eventvico.example/subscription/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://eventvico.example/subscription?checkout=cancelled',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('STRIPE_CHECKOUT_CREATE_FAILED')
    }
  })

  it('fetches checkout session details by id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'cs_test_123',
        status: 'complete',
        mode: 'subscription',
        payment_status: 'paid',
        metadata: { tenant_id: 'tenant-1' },
      }),
    })

    const result = await getStripeCheckoutSession('cs_test_123')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('cs_test_123')
    }
  })

  it('creates customer portal session', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'bps_123',
        url: 'https://billing.stripe.com/session/test_123',
      }),
    })

    const result = await createStripeCustomerPortalSession({
      customerId: 'cus_123',
      returnUrl: 'https://eventvico.example/subscription',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.url).toContain('billing.stripe.com')
    }
  })

  it('fetches Stripe subscription details', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'sub_123',
        status: 'active',
        current_period_end: 1893456000,
      }),
    })

    const result = await getStripeSubscription('sub_123')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('sub_123')
    }
  })

  it('schedules cancellation at period end', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'sub_123',
        status: 'active',
        cancel_at_period_end: true,
        cancel_at: 1893456000,
      }),
    })

    const result = await cancelStripeSubscriptionAtPeriodEnd('sub_123')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cancel_at_period_end).toBe(true)
    }
  })
})
