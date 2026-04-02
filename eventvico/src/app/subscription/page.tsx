import { SubscriptionCheckout } from '@/app/subscription/subscription-checkout'
import { SubscriptionManagement } from '@/app/subscription/subscription-management'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function normalizeRedirectTo(redirectTo?: string): string {
  if (!redirectTo) return '/dashboard'
  if (!redirectTo.startsWith('/')) return '/dashboard'
  if (redirectTo.startsWith('//')) return '/dashboard'
  return redirectTo
}

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ trial_expired?: string; redirectTo?: string; checkout?: string; portal?: string }>
}) {
  const params = await searchParams
  const isTrialExpired = params.trial_expired === '1'
  const redirectTo = normalizeRedirectTo(params.redirectTo)
  const checkoutState = params.checkout ?? null
  const portalState = params.portal ?? null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user?.id) {
    const { data: profile } = await createAdminClient()
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.tenant_id) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('plan_status, stripe_subscription_id')
        .eq('id', profile.tenant_id)
        .maybeSingle()

      const showManagement =
        tenant?.plan_status === 'active' || tenant?.plan_status === 'past_due' || Boolean(tenant?.stripe_subscription_id)

      if (showManagement) {
        return <SubscriptionManagement portalState={portalState} />
      }
    }
  }

  return <SubscriptionCheckout isTrialExpired={isTrialExpired} redirectTo={redirectTo} checkoutState={checkoutState} />
}
