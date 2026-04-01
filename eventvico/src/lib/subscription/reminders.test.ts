import { enqueueDueTaskReminderIfNeeded, enqueueTrialReminderIfNeeded } from '@/lib/subscription/reminders'

describe('enqueueTrialReminderIfNeeded', () => {
  it('inserts outbox row when trial has 3 days remaining', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: jest.fn().mockReturnValue({ insert }),
    }

    const created = await enqueueTrialReminderIfNeeded({
      supabase,
      tenant: {
        id: 'tenant-1',
        name: 'Bloom',
        plan_status: 'trial',
        trial_ends_at: '2026-04-03T12:00:00.000Z',
      },
      recipientEmail: 'owner@example.com',
      now: new Date('2026-03-31T12:00:00.000Z'),
    })

    expect(created).toBe(true)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on duplicate dedupe key', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { code: '23505' } })
    const supabase = {
      from: jest.fn().mockReturnValue({ insert }),
    }

    const created = await enqueueTrialReminderIfNeeded({
      supabase,
      tenant: {
        id: 'tenant-1',
        name: 'Bloom',
        plan_status: 'trial',
        trial_ends_at: '2026-04-03T12:00:00.000Z',
      },
      recipientEmail: 'owner@example.com',
      now: new Date('2026-03-31T12:00:00.000Z'),
    })

    expect(created).toBe(false)
  })
})

describe('enqueueDueTaskReminderIfNeeded', () => {
  it('enqueues due reminder email when due date has passed', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: jest.fn().mockReturnValue({ insert }),
    }

    const queued = await enqueueDueTaskReminderIfNeeded({
      supabase,
      tenantId: 'tenant-1',
      tenantName: 'Bloom',
      activityId: 'activity-1',
      dueAt: '2026-03-31T08:00:00.000Z',
      title: 'Follow-up call',
      recipientEmail: 'owner@example.com',
      now: new Date('2026-03-31T12:00:00.000Z'),
    })

    expect(queued).toBe(true)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('does not enqueue when reminder is not yet due', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: jest.fn().mockReturnValue({ insert }),
    }

    const queued = await enqueueDueTaskReminderIfNeeded({
      supabase,
      tenantId: 'tenant-1',
      tenantName: 'Bloom',
      activityId: 'activity-1',
      dueAt: '2026-04-01T08:00:00.000Z',
      title: 'Follow-up call',
      recipientEmail: 'owner@example.com',
      now: new Date('2026-03-31T12:00:00.000Z'),
    })

    expect(queued).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })
})
