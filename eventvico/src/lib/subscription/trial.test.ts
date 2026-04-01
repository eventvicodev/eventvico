import {
  calculateDaysRemaining,
  getTrialStatus,
  shouldQueueTrialReminder,
  shouldRedirectToSubscription,
} from '@/lib/subscription/trial'

describe('trial helpers', () => {
  const now = new Date('2026-03-31T12:00:00.000Z')

  it('calculates days remaining', () => {
    const days = calculateDaysRemaining('2026-04-03T12:00:00.000Z', now)
    expect(days).toBe(3)
  })

  it('marks trial as expiring when 3 days remain', () => {
    const status = getTrialStatus(
      { plan_status: 'trial', trial_ends_at: '2026-04-03T12:00:00.000Z' },
      now
    )

    expect(status.showExpiringBanner).toBe(true)
    expect(status.isExpired).toBe(false)
  })

  it('marks trial as expired and blocks studio access', () => {
    const tenant = { plan_status: 'trial', trial_ends_at: '2026-03-20T12:00:00.000Z' } as const
    expect(shouldRedirectToSubscription(tenant, now)).toBe(true)
  })

  it('marks trial as expired immediately after end timestamp (same day edge case)', () => {
    const tenant = { plan_status: 'trial', trial_ends_at: '2026-03-31T11:00:00.000Z' } as const
    expect(calculateDaysRemaining(tenant.trial_ends_at, now)).toBe(0)
    expect(shouldRedirectToSubscription(tenant, now)).toBe(true)
  })

  it('queues reminder only when trial has exactly 3 days remaining', () => {
    const tenant = { plan_status: 'trial', trial_ends_at: '2026-04-03T12:00:00.000Z' } as const
    expect(shouldQueueTrialReminder(tenant, now)).toBe(true)
    expect(
      shouldQueueTrialReminder(
        { plan_status: 'trial', trial_ends_at: '2026-04-04T12:00:00.000Z' },
        now
      )
    ).toBe(false)
  })
})
