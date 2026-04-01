'use server'

import { headers } from 'next/headers'
import type { ActionResult } from '@/types/app'
import { createClient } from '@/lib/supabase/server'
import {
  cancelStripeSubscriptionAtPeriodEnd,
  createStripeCheckoutSession,
  createStripeCustomerPortalSession,
  getStripeCheckoutSession,
  getStripeSubscription,
  mapStripeSubscriptionStatus,
} from '@/lib/subscription/billing'

type StartSubscriptionCheckoutResult = ActionResult<{ url: string }>
type FinalizeSubscriptionActivationResult = ActionResult<{ redirectTo: string }>
type StartBillingPortalResult = ActionResult<{ url: string }>
type CancelSubscriptionResult = ActionResult<{ cancelAt: string | null }>
type SubscriptionOverviewResult = ActionResult<{
  planName: string
  billingPeriod: string
  nextRenewalDate: string | null
  lastPaymentStatus: string
  cancelAtPeriodEnd: boolean
  cancelAtDate: string | null
  isBillingUnavailable: boolean
}>
type SupabaseOutboxClient = {
  from: (table: 'email_outbox') => {
    insert: (row: {
      tenant_id: string
      event_type: string
      recipient_email: string
      subject: string
      payload: Record<string, unknown>
      dedupe_key: string
    }) => Promise<{ error: { code?: string } | null }>
  }
}
type TenantContext = {
  user: {
    id: string
    email: string | null
  }
  tenant: {
    id: string
    plan_status: 'trial' | 'active' | 'past_due' | 'cancelled'
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
  }
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

async function resolveServerOrigin(): Promise<string | null> {
  const headerStore = await headers()
  const forwardedProtoRaw = headerStore.get('x-forwarded-proto')
  const forwardedProto = forwardedProtoRaw?.split(',')[0]?.trim()
  const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https'
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host')

  if (host) {
    return `${protocol}://${host}`
  }

  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL
  if (configuredOrigin) {
    return normalizeOrigin(configuredOrigin)
  }

  return null
}

function formatDateFromUnix(timestamp: number | null | undefined): string | null {
  if (!timestamp || Number.isNaN(timestamp)) return null
  return new Date(timestamp * 1000).toISOString()
}

function formatBillingPeriod(interval: string | null | undefined, intervalCount: number | null | undefined): string {
  if (!interval) return 'N/A'
  if (!intervalCount || intervalCount <= 1) return interval
  return `${intervalCount} ${interval}s`
}

async function getTenantContext(requireEmail = false): Promise<ActionResult<TenantContext>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id || (requireEmail && !user.email)) {
    return {
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Please sign in again to continue.',
      },
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.tenant_id) {
    return {
      success: false,
      error: {
        code: 'TENANT_NOT_FOUND',
        message: 'Could not find your studio account. Please contact support.',
      },
    }
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, plan_status, stripe_customer_id, stripe_subscription_id')
    .eq('id', profile.tenant_id)
    .maybeSingle()

  if (!tenant) {
    return {
      success: false,
      error: {
        code: 'TENANT_NOT_FOUND',
        message: 'Could not find your studio account. Please contact support.',
      },
    }
  }

  return {
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email ?? null,
      },
      tenant: {
        id: tenant.id,
        plan_status: tenant.plan_status,
        stripe_customer_id: tenant.stripe_customer_id,
        stripe_subscription_id: tenant.stripe_subscription_id,
      },
    },
  }
}

async function enqueueBillingEmail(
  tenantId: string,
  recipientEmail: string,
  eventType: string,
  subject: string,
  payload: Record<string, unknown>,
  dedupeKey: string
) {
  const supabase = await createClient()
  const outboxClient = supabase as unknown as SupabaseOutboxClient
  await outboxClient.from('email_outbox').insert({
    tenant_id: tenantId,
    event_type: eventType,
    recipient_email: recipientEmail,
    subject,
    payload,
    dedupe_key: dedupeKey,
  })
}

export async function startSubscriptionCheckout(): Promise<StartSubscriptionCheckoutResult> {
  try {
    const origin = await resolveServerOrigin()
    if (!origin) {
      return {
        success: false,
        error: {
          code: 'CHECKOUT_ORIGIN_UNAVAILABLE',
          message: 'Billing is temporarily unavailable. Please try again later.',
        },
      }
    }

    const context = await getTenantContext(true)
    if (!context.success) {
      return context
    }

    const result = await createStripeCheckoutSession({
      customerEmail: context.data.user.email!,
      tenantId: context.data.tenant.id,
      successUrl: `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/subscription?checkout=cancelled`,
    })

    if (!result.success) {
      return result
    }

    return {
      success: true,
      data: {
        url: result.data.url,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'CHECKOUT_START_FAILED',
        message: 'Could not start checkout. Please try again.',
      },
    }
  }
}

export async function finalizeSubscriptionActivation(sessionId: string): Promise<FinalizeSubscriptionActivationResult> {
  try {
    if (!sessionId) {
      return {
        success: false,
        error: {
          code: 'SESSION_ID_REQUIRED',
          message: 'Missing checkout session identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const stripeSession = await getStripeCheckoutSession(sessionId)
    if (!stripeSession.success) {
      return stripeSession
    }

    const session = stripeSession.data
    const sessionTenantId = session.metadata?.tenant_id ?? session.client_reference_id ?? null
    if (sessionTenantId !== context.data.tenant.id) {
      return {
        success: false,
        error: {
          code: 'CHECKOUT_TENANT_MISMATCH',
          message: 'Checkout session does not match your account.',
        },
      }
    }

    const isCompleted = session.status === 'complete' && session.mode === 'subscription' && session.payment_status === 'paid'
    if (!isCompleted) {
      return {
        success: false,
        error: {
          code: 'CHECKOUT_NOT_COMPLETED',
          message: 'Your payment was not completed. Please retry checkout.',
        },
      }
    }

    const { error: updateError } = await supabase
      .from('tenants')
      .update({
        plan_status: mapStripeSubscriptionStatus('active'),
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
      })
      .eq('id', context.data.tenant.id)

    if (updateError) {
      return {
        success: false,
        error: {
          code: 'TENANT_UPDATE_FAILED',
          message: 'Could not activate your subscription. Please contact support.',
        },
      }
    }

    if (context.data.user.email) {
      const dedupeKey = `billing-confirmation:${context.data.tenant.id}:${session.subscription ?? session.id}`
      await enqueueBillingEmail(
        context.data.tenant.id,
        context.data.user.email,
        'billing_confirmation',
        'Your Eventvico subscription is active',
        {
          sessionId: session.id,
          subscriptionId: session.subscription,
          customerId: session.customer,
        },
        dedupeKey
      )
    }

    return {
      success: true,
      data: {
        redirectTo: '/dashboard?billing=success',
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'ACTIVATION_FAILED',
        message: 'Could not finalize your subscription. Please try again.',
      },
    }
  }
}

export async function fetchSubscriptionOverview(): Promise<SubscriptionOverviewResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const tenant = context.data.tenant
    if (!tenant.stripe_subscription_id) {
      return {
        success: true,
        data: {
          planName: tenant.plan_status === 'trial' ? 'Trial Plan' : 'No Active Plan',
          billingPeriod: 'N/A',
          nextRenewalDate: null,
          lastPaymentStatus: tenant.plan_status,
          cancelAtPeriodEnd: false,
          cancelAtDate: null,
          isBillingUnavailable: false,
        },
      }
    }

    const subscriptionResult = await getStripeSubscription(tenant.stripe_subscription_id)
    if (!subscriptionResult.success) {
      return {
        success: true,
        data: {
          planName: 'Active Plan',
          billingPeriod: 'N/A',
          nextRenewalDate: null,
          lastPaymentStatus: tenant.plan_status,
          cancelAtPeriodEnd: false,
          cancelAtDate: null,
          isBillingUnavailable: true,
        },
      }
    }

    const subscription = subscriptionResult.data
    const recurring = subscription.items?.data?.[0]?.price?.recurring

    return {
      success: true,
      data: {
        planName: 'Pro Plan',
        billingPeriod: formatBillingPeriod(recurring?.interval ?? null, recurring?.interval_count ?? null),
        nextRenewalDate: formatDateFromUnix(subscription.current_period_end),
        lastPaymentStatus: subscription.latest_invoice?.status ?? subscription.status ?? 'unknown',
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        cancelAtDate: formatDateFromUnix(subscription.cancel_at),
        isBillingUnavailable: false,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'SUBSCRIPTION_OVERVIEW_FAILED',
        message: 'Could not load subscription details. Please refresh and try again.',
      },
    }
  }
}

export async function startBillingPortal(): Promise<StartBillingPortalResult> {
  try {
    const origin = await resolveServerOrigin()
    if (!origin) {
      return {
        success: false,
        error: {
          code: 'CHECKOUT_ORIGIN_UNAVAILABLE',
          message: 'Billing is temporarily unavailable. Please try again later.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const customerId = context.data.tenant.stripe_customer_id
    if (!customerId) {
      return {
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Billing account is not set up yet. Please complete checkout first.',
        },
      }
    }

    const result = await createStripeCustomerPortalSession({
      customerId,
      returnUrl: `${origin}/subscription?portal=updated`,
    })

    if (!result.success) {
      return result
    }

    return {
      success: true,
      data: {
        url: result.data.url,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'PORTAL_START_FAILED',
        message: 'Could not open billing portal. Please try again.',
      },
    }
  }
}

export async function cancelSubscription(): Promise<CancelSubscriptionResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const subscriptionId = context.data.tenant.stripe_subscription_id
    if (!subscriptionId) {
      return {
        success: false,
        error: {
          code: 'SUBSCRIPTION_NOT_FOUND',
          message: 'No active subscription was found for your studio.',
        },
      }
    }

    const cancelResult = await cancelStripeSubscriptionAtPeriodEnd(subscriptionId)
    if (!cancelResult.success) {
      return cancelResult
    }

    const subscription = cancelResult.data
    const cancelAtDate = formatDateFromUnix(subscription.cancel_at)

    const supabase = await createClient()
    await supabase
      .from('tenants')
      .update({
        plan_status: mapStripeSubscriptionStatus(subscription.status),
      })
      .eq('id', context.data.tenant.id)

    if (context.data.user.email) {
      const dedupeKey = `subscription-cancelled:${context.data.tenant.id}:${subscription.id}:${subscription.cancel_at ?? 'unknown'}`
      await enqueueBillingEmail(
        context.data.tenant.id,
        context.data.user.email,
        'subscription_cancellation_confirmation',
        'Your Eventvico subscription will cancel at period end',
        {
          subscriptionId: subscription.id,
          cancelAt: cancelAtDate,
        },
        dedupeKey
      )
    }

    return {
      success: true,
      data: {
        cancelAt: cancelAtDate,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'CANCEL_SUBSCRIPTION_FAILED',
        message: 'Could not cancel your subscription. Please try again.',
      },
    }
  }
}
