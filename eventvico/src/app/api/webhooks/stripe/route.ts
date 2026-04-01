import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { mapStripeSubscriptionStatus } from '@/lib/subscription/billing'

type StripeWebhookEvent = {
  id: string
  type: string
  data: {
    object: Record<string, unknown>
  }
}

type TenantLookup = {
  id: string
  name: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

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

function verifyStripeSignature(rawBody: string, signatureHeader: string | null, webhookSecret: string) {
  if (!signatureHeader) return false

  const items = signatureHeader.split(',').map((entry) => entry.trim())
  const timestamp = items.find((entry) => entry.startsWith('t='))?.slice(2)
  const signature = items.find((entry) => entry.startsWith('v1='))?.slice(3)
  if (!timestamp || !signature) return false

  const payload = `${timestamp}.${rawBody}`
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex')

  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  if (expectedBuffer.length !== signatureBuffer.length) return false
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
}

async function updateTenantByStripeReference(data: {
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  planStatus: 'trial' | 'active' | 'past_due' | 'cancelled'
}) {
  const supabase = createAdminClient()
  const touchedTenantIds = new Set<string>()

  if (data.stripeSubscriptionId) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('stripe_subscription_id', data.stripeSubscriptionId)
      .maybeSingle()

    if (tenant?.id) touchedTenantIds.add(tenant.id)

    await supabase
      .from('tenants')
      .update({
        plan_status: data.planStatus,
        stripe_subscription_id: data.stripeSubscriptionId,
        stripe_customer_id: data.stripeCustomerId ?? null,
      })
      .eq('stripe_subscription_id', data.stripeSubscriptionId)
  }

  if (data.stripeCustomerId) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('stripe_customer_id', data.stripeCustomerId)
      .maybeSingle()

    if (tenant?.id) touchedTenantIds.add(tenant.id)

    await supabase
      .from('tenants')
      .update({
        plan_status: data.planStatus,
        stripe_customer_id: data.stripeCustomerId,
      })
      .eq('stripe_customer_id', data.stripeCustomerId)
  }

  return Array.from(touchedTenantIds)
}

async function getTenantByStripeReference(
  stripeSubscriptionId?: string | null,
  stripeCustomerId?: string | null
): Promise<TenantLookup | null> {
  const supabase = createAdminClient()

  if (stripeSubscriptionId) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name, stripe_customer_id, stripe_subscription_id')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .maybeSingle()

    if (tenant) {
      return tenant
    }
  }

  if (stripeCustomerId) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name, stripe_customer_id, stripe_subscription_id')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle()

    if (tenant) {
      return tenant
    }
  }

  return null
}

async function listTenantOwnerEmails(tenantId: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data: owners } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')

  if (!owners || owners.length === 0) return []

  const emails: string[] = []
  await Promise.all(
    owners.map(async (owner) => {
      const { data } = await supabase.auth.admin.getUserById(owner.id)
      const email = data.user?.email
      if (email) emails.push(email)
    })
  )

  return Array.from(new Set(emails))
}

async function enqueueBillingLifecycleEmail(input: {
  tenantId: string
  tenantName: string
  recipientEmails: string[]
  eventType: string
  subject: string
  payload: Record<string, unknown>
  dedupeSuffix: string
}) {
  if (input.recipientEmails.length === 0) return

  const supabase = createAdminClient() as unknown as SupabaseOutboxClient
  await Promise.all(
    input.recipientEmails.map(async (email) => {
      const dedupeKey = `${input.eventType}:${input.tenantId}:${input.dedupeSuffix}:${email}`
      await supabase.from('email_outbox').insert({
        tenant_id: input.tenantId,
        event_type: input.eventType,
        recipient_email: email,
        subject: input.subject,
        payload: {
          tenantName: input.tenantName,
          ...input.payload,
        },
        dedupe_key: dedupeKey,
      })
    })
  )
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json(
      { error: { code: 'STRIPE_WEBHOOK_NOT_CONFIGURED', message: 'Webhook secret is missing' } },
      { status: 503 }
    )
  }

  const rawBody = await request.text()
  const signatureHeader = request.headers.get('stripe-signature')

  if (!verifyStripeSignature(rawBody, signatureHeader, webhookSecret)) {
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message: 'Invalid Stripe signature' } },
      { status: 400 }
    )
  }

  let event: StripeWebhookEvent
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON payload' } }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const obj = event.data.object
      const stripeSubscriptionId = typeof obj.subscription === 'string' ? obj.subscription : null
      const stripeCustomerId = typeof obj.customer === 'string' ? obj.customer : null
      const tenantIds = await updateTenantByStripeReference({
        stripeSubscriptionId,
        stripeCustomerId,
        planStatus: 'active',
      })

      const tenant = await getTenantByStripeReference(stripeSubscriptionId, stripeCustomerId)
      const resolvedTenantId = tenant?.id ?? tenantIds[0]
      if (resolvedTenantId) {
        const ownerEmails = await listTenantOwnerEmails(resolvedTenantId)
        await enqueueBillingLifecycleEmail({
          tenantId: resolvedTenantId,
          tenantName: tenant?.name ?? 'Eventvico Studio',
          recipientEmails: ownerEmails,
          eventType: 'billing_confirmation',
          subject: 'Payment received for your Eventvico subscription',
          payload: {
            subscriptionId: stripeSubscriptionId,
            customerId: stripeCustomerId,
          },
          dedupeSuffix: `${stripeSubscriptionId ?? 'unknown'}:${event.id}`,
        })
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const obj = event.data.object
      const stripeSubscriptionId = typeof obj.id === 'string' ? obj.id : null
      const stripeCustomerId = typeof obj.customer === 'string' ? obj.customer : null
      const stripeStatus = typeof obj.status === 'string' ? obj.status : null
      const cancelAtPeriodEnd = obj.cancel_at_period_end === true
      const cancelAt = typeof obj.cancel_at === 'number' ? obj.cancel_at : null
      const currentPeriodEnd = typeof obj.current_period_end === 'number' ? obj.current_period_end : null

      const planStatus = mapStripeSubscriptionStatus(stripeStatus)
      const tenantIds = await updateTenantByStripeReference({
        stripeSubscriptionId,
        stripeCustomerId,
        planStatus,
      })

      const tenant = await getTenantByStripeReference(stripeSubscriptionId, stripeCustomerId)
      if (!tenant && tenantIds.length === 0) {
        return NextResponse.json({ received: true })
      }

      const resolvedTenantId = tenant?.id ?? tenantIds[0]
      if (!resolvedTenantId) {
        return NextResponse.json({ received: true })
      }

      const ownerEmails = await listTenantOwnerEmails(resolvedTenantId)
      const tenantName = tenant?.name ?? 'Eventvico Studio'

      if (planStatus === 'past_due') {
        await enqueueBillingLifecycleEmail({
          tenantId: resolvedTenantId,
          tenantName,
          recipientEmails: ownerEmails,
          eventType: 'payment_failed',
          subject: 'Payment failed for your Eventvico subscription',
          payload: {
            subscriptionId: stripeSubscriptionId,
            customerId: stripeCustomerId,
            status: stripeStatus,
          },
          dedupeSuffix: `${stripeSubscriptionId ?? 'unknown'}:${currentPeriodEnd ?? 'unknown'}`,
        })
      }

      if (cancelAtPeriodEnd) {
        await enqueueBillingLifecycleEmail({
          tenantId: resolvedTenantId,
          tenantName,
          recipientEmails: ownerEmails,
          eventType: 'subscription_cancellation_confirmation',
          subject: 'Your Eventvico subscription cancellation is scheduled',
          payload: {
            subscriptionId: stripeSubscriptionId,
            customerId: stripeCustomerId,
            cancelAt,
            currentPeriodEnd,
          },
          dedupeSuffix: `${stripeSubscriptionId ?? 'unknown'}:${cancelAt ?? 'unknown'}`,
        })
      }
    }

    return NextResponse.json({ received: true })
  } catch {
    return NextResponse.json(
      { error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'Could not process Stripe webhook event' } },
      { status: 500 }
    )
  }
}
