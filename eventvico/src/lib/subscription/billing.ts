import type { ActionResult } from '@/types/app'

export type StripeCheckoutSession = {
  id: string
  url: string | null
  status: string | null
  mode: string | null
  payment_status: string | null
  customer: string | null
  subscription: string | null
  client_reference_id: string | null
  metadata: Record<string, string> | null
}

type CreateCheckoutSessionInput = {
  customerEmail: string
  tenantId: string
  successUrl: string
  cancelUrl: string
}

type CreateCheckoutSessionResult = ActionResult<{
  sessionId: string
  url: string
}>

type CreateCustomerPortalSessionInput = {
  customerId: string
  returnUrl: string
}

export type StripeCustomerPortalSession = {
  id: string
  url: string | null
}

export type StripeInvoice = {
  id: string
  status: string | null
  created: number | null
}

export type StripeSubscription = {
  id: string
  status: string | null
  customer: string | null
  cancel_at_period_end: boolean
  cancel_at: number | null
  current_period_end: number | null
  latest_invoice: StripeInvoice | null
  items?: {
    data?: Array<{
      price?: {
        recurring?: {
          interval?: string | null
          interval_count?: number | null
        } | null
      } | null
    }>
  }
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

function getStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const priceId = process.env.STRIPE_PRICE_ID

  if (!secretKey || !priceId) return null
  return { secretKey, priceId }
}

export function mapStripeSubscriptionStatus(
  status: string | null | undefined
): 'trial' | 'active' | 'past_due' | 'cancelled' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
    case 'incomplete':
    case 'incomplete_expired':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
      return 'cancelled'
    default:
      return 'trial'
  }
}

function getStripeErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const maybeError = payload as { error?: { message?: unknown } }
  const message = maybeError.error?.message
  return typeof message === 'string' ? message : null
}

async function callStripe(path: string, init: RequestInit) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, init)
  const payload = (await response.json().catch(() => null)) as unknown
  return { response, payload }
}

export async function createStripeCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<CreateCheckoutSessionResult> {
  const config = getStripeConfig()
  if (!config) {
    return {
      success: false,
      error: {
        code: 'STRIPE_NOT_CONFIGURED',
        message: 'Billing is temporarily unavailable. Please try again later.',
      },
    }
  }

  const body = new URLSearchParams()
  body.set('mode', 'subscription')
  body.set('success_url', input.successUrl)
  body.set('cancel_url', input.cancelUrl)
  body.set('line_items[0][price]', config.priceId)
  body.set('line_items[0][quantity]', '1')
  body.set('customer_email', input.customerEmail)
  body.set('client_reference_id', input.tenantId)
  body.set('metadata[tenant_id]', input.tenantId)

  const { response, payload } = await callStripe('/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    return {
      success: false,
      error: {
        code: 'STRIPE_CHECKOUT_CREATE_FAILED',
        message: getStripeErrorMessage(payload) ?? 'Could not start checkout. Please try again.',
      },
    }
  }

  const session = payload as StripeCheckoutSession
  if (!session?.id || !session.url) {
    return {
      success: false,
      error: {
        code: 'STRIPE_CHECKOUT_CREATE_FAILED',
        message: 'Could not start checkout. Please try again.',
      },
    }
  }

  return {
    success: true,
    data: {
      sessionId: session.id,
      url: session.url,
    },
  }
}

export async function getStripeCheckoutSession(sessionId: string): Promise<ActionResult<StripeCheckoutSession>> {
  const config = getStripeConfig()
  if (!config) {
    return {
      success: false,
      error: {
        code: 'STRIPE_NOT_CONFIGURED',
        message: 'Billing is temporarily unavailable. Please try again later.',
      },
    }
  }

  const { response, payload } = await callStripe(`/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
    },
  })

  if (!response.ok) {
    return {
      success: false,
      error: {
        code: 'STRIPE_SESSION_FETCH_FAILED',
        message: getStripeErrorMessage(payload) ?? 'Could not verify checkout session.',
      },
    }
  }

  return {
    success: true,
    data: payload as StripeCheckoutSession,
  }
}

export async function createStripeCustomerPortalSession(
  input: CreateCustomerPortalSessionInput
): Promise<ActionResult<{ url: string }>> {
  const config = getStripeConfig()
  if (!config) {
    return {
      success: false,
      error: {
        code: 'STRIPE_NOT_CONFIGURED',
        message: 'Billing is temporarily unavailable. Please try again later.',
      },
    }
  }

  const body = new URLSearchParams()
  body.set('customer', input.customerId)
  body.set('return_url', input.returnUrl)

  const { response, payload } = await callStripe('/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    return {
      success: false,
      error: {
        code: 'STRIPE_PORTAL_CREATE_FAILED',
        message: getStripeErrorMessage(payload) ?? 'Could not open billing portal. Please try again.',
      },
    }
  }

  const session = payload as StripeCustomerPortalSession
  if (!session.url) {
    return {
      success: false,
      error: {
        code: 'STRIPE_PORTAL_CREATE_FAILED',
        message: 'Could not open billing portal. Please try again.',
      },
    }
  }

  return {
    success: true,
    data: {
      url: session.url,
    },
  }
}

export async function getStripeSubscription(
  subscriptionId: string
): Promise<ActionResult<StripeSubscription>> {
  const config = getStripeConfig()
  if (!config) {
    return {
      success: false,
      error: {
        code: 'STRIPE_NOT_CONFIGURED',
        message: 'Billing is temporarily unavailable. Please try again later.',
      },
    }
  }

  const query = new URLSearchParams()
  query.append('expand[]', 'latest_invoice')
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}?${query.toString()}`

  const { response, payload } = await callStripe(path, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
    },
  })

  if (!response.ok) {
    return {
      success: false,
      error: {
        code: 'STRIPE_SUBSCRIPTION_FETCH_FAILED',
        message: getStripeErrorMessage(payload) ?? 'Could not load subscription details.',
      },
    }
  }

  return {
    success: true,
    data: payload as StripeSubscription,
  }
}

export async function cancelStripeSubscriptionAtPeriodEnd(
  subscriptionId: string
): Promise<ActionResult<StripeSubscription>> {
  const config = getStripeConfig()
  if (!config) {
    return {
      success: false,
      error: {
        code: 'STRIPE_NOT_CONFIGURED',
        message: 'Billing is temporarily unavailable. Please try again later.',
      },
    }
  }

  const body = new URLSearchParams()
  body.set('cancel_at_period_end', 'true')

  const { response, payload } = await callStripe(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    return {
      success: false,
      error: {
        code: 'STRIPE_SUBSCRIPTION_CANCEL_FAILED',
        message: getStripeErrorMessage(payload) ?? 'Could not cancel subscription. Please try again.',
      },
    }
  }

  return {
    success: true,
    data: payload as StripeSubscription,
  }
}
