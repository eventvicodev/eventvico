import { redirect } from 'next/navigation'
import { finalizeSubscriptionActivation } from '@/lib/actions/subscription'

export default async function SubscriptionSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const params = await searchParams
  const sessionId = params.session_id ?? ''

  const result = await finalizeSubscriptionActivation(sessionId)
  if (result.success) {
    redirect(result.data.redirectTo)
  }

  redirect('/subscription?checkout=failed')
}

