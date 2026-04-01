import type { Database } from '@/types/supabase'

type TenantRow = Database['public']['Tables']['tenants']['Row']

const DAY_MS = 24 * 60 * 60 * 1000

export type TrialStatus = {
  isTrial: boolean
  isExpired: boolean
  daysRemaining: number | null
  showExpiringBanner: boolean
}

function parseTrialEnd(trialEndsAt: string | null): Date | null {
  if (!trialEndsAt) return null
  const end = new Date(trialEndsAt)
  if (Number.isNaN(end.getTime())) return null
  return end
}

export function calculateDaysRemaining(trialEndsAt: string | null, now = new Date()): number | null {
  const end = parseTrialEnd(trialEndsAt)
  if (!end) return null

  const days = Math.ceil((end.getTime() - now.getTime()) / DAY_MS)
  return Object.is(days, -0) ? 0 : days
}

export function getTrialStatus(tenant: Pick<TenantRow, 'plan_status' | 'trial_ends_at'>, now = new Date()): TrialStatus {
  const isTrial = tenant.plan_status === 'trial'
  const trialEnd = parseTrialEnd(tenant.trial_ends_at)
  const daysRemaining = calculateDaysRemaining(tenant.trial_ends_at, now)
  const isExpired = isTrial && trialEnd !== null && trialEnd.getTime() < now.getTime()
  const showExpiringBanner = isTrial && daysRemaining !== null && daysRemaining <= 3 && daysRemaining >= 0

  return {
    isTrial,
    isExpired,
    daysRemaining,
    showExpiringBanner,
  }
}

export function shouldRedirectToSubscription(
  tenant: Pick<TenantRow, 'plan_status' | 'trial_ends_at'> | null,
  now = new Date()
) {
  if (!tenant) return false
  return getTrialStatus(tenant, now).isExpired
}

export function shouldQueueTrialReminder(
  tenant: Pick<TenantRow, 'plan_status' | 'trial_ends_at'>,
  now = new Date()
) {
  const status = getTrialStatus(tenant, now)
  return status.isTrial && status.daysRemaining === 3
}
