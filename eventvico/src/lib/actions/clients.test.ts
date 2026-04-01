import { createStudioClient } from '@/lib/actions/clients'
import { createClient } from '@/lib/supabase/server'
import {
  completeClientTaskActivity,
  createClientActivity,
  fetchClientsDirectory,
  fetchDashboardOverview,
  fetchPipelineClients,
  listFollowUpReminders,
  listClientActivities,
  updateClientPipelineStage,
} from '@/lib/actions/clients'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('createStudioClient', () => {
  it('creates a client in lead stage and returns detail redirect', async () => {
    const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'client-1' }, error: null })
    const insertSelect = jest.fn().mockReturnValue({ single: insertSingle })
    const insert = jest.fn().mockReturnValue({ select: insertSelect })

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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null }),
                }),
              }),
            }),
            insert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createStudioClient({
      name: 'Ariana Event',
      email: 'client@example.com',
      phone: '123-456-7890',
      eventDate: '2026-04-21',
      venue: 'Grand Hall',
      guestCount: '150',
      budget: '4200.50',
    })

    expect(result.success).toBe(true)
    if (result.success && 'redirectTo' in result.data) {
      expect(result.data.redirectTo).toBe('/clients/client-1')
    }

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        created_by: 'user-1',
        pipeline_stage: 'lead',
      })
    )
  })

  it('returns duplicate warning when email already exists in same tenant', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 'existing-client-1' } }),
                }),
              }),
            }),
            insert: jest.fn(),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createStudioClient({
      name: 'Ariana Event',
      email: 'client@example.com',
      phone: '',
    })

    expect(result.success).toBe(true)
    if (result.success && 'status' in result.data) {
      expect(result.data.status).toBe('duplicate')
      expect(result.data.existingClientId).toBe('existing-client-1')
    }
  })

  it('allows duplicate creation when explicitly requested', async () => {
    const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'client-2' }, error: null })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 'existing-client-1' } }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: insertSingle,
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createStudioClient({
      name: 'Ariana Event',
      email: 'client@example.com',
      phone: '',
      allowDuplicateEmail: true,
    })

    expect(result.success).toBe(true)
    if (result.success && 'redirectTo' in result.data) {
      expect(result.data.redirectTo).toBe('/clients/client-2')
    }
  })
})

describe('pipeline actions', () => {
  it('fetches tenant-scoped pipeline clients', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'client-1',
                      name: 'Ariana Event',
                      event_date: '2026-06-20',
                      budget: 2500,
                      pipeline_stage: 'lead',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchPipelineClients()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.clients[0].stage).toBe('lead')
    }
  })

  it('updates pipeline stage with tenant scoping', async () => {
    const updateEqTenant = jest.fn().mockResolvedValue({ error: null })
    const updateEqId = jest.fn().mockReturnValue({ eq: updateEqTenant })
    const update = jest.fn().mockReturnValue({ eq: updateEqId })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            update,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await updateClientPipelineStage({
      clientId: 'client-1',
      stage: 'qualified',
    })

    expect(result.success).toBe(true)
    expect(update).toHaveBeenCalledWith({ pipeline_stage: 'qualified' })
    expect(updateEqId).toHaveBeenCalledWith('id', 'client-1')
    expect(updateEqTenant).toHaveBeenCalledWith('tenant_id', 'tenant-1')
  })

  it('rejects invalid stage updates', async () => {
    const result = await updateClientPipelineStage({
      clientId: 'client-1',
      stage: 'invalid_stage',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
    }
  })
})

describe('client directory action', () => {
  it('filters clients by search text, stage, status, and event date window', async () => {
    const inFourDays = new Date()
    inFourDays.setDate(inFourDays.getDate() + 4)
    const inFourDaysIso = inFourDays.toISOString().slice(0, 10)

    const inThirtyDays = new Date()
    inThirtyDays.setDate(inThirtyDays.getDate() + 30)
    const inThirtyDaysIso = inThirtyDays.toISOString().slice(0, 10)

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'client-1',
                      name: 'Ariana Event',
                      event_date: inFourDaysIso,
                      pipeline_stage: 'qualified',
                      created_at: '2026-03-31T10:00:00.000Z',
                    },
                    {
                      id: 'client-2',
                      name: 'Brian Event',
                      event_date: inThirtyDaysIso,
                      pipeline_stage: 'qualified',
                      created_at: '2026-03-31T09:00:00.000Z',
                    },
                    {
                      id: 'client-3',
                      name: 'Ariana Past',
                      event_date: '2020-01-01',
                      pipeline_stage: 'qualified',
                      created_at: '2026-03-31T08:00:00.000Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchClientsDirectory({
      search: 'ariana',
      stage: 'qualified',
      status: 'upcoming',
      eventDateFrom: inFourDaysIso,
      eventDateTo: inFourDaysIso,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.clients.length).toBe(1)
      expect(result.data.clients[0].id).toBe('client-1')
    }
  })

  it('returns unscheduled clients when status filter is unscheduled', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'client-1',
                      name: 'No Date Client',
                      event_date: null,
                      pipeline_stage: 'lead',
                      created_at: '2026-03-31T10:00:00.000Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchClientsDirectory({
      status: 'unscheduled',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.clients.length).toBe(1)
      expect(result.data.clients[0].status).toBe('unscheduled')
    }
  })
})

describe('dashboard overview action', () => {
  it('returns stage counts, upcoming events, and pending quote count', async () => {
    const inTwoDays = new Date()
    inTwoDays.setDate(inTwoDays.getDate() + 2)
    const inTwoDaysIso = inTwoDays.toISOString().slice(0, 10)

    const inThreeDays = new Date()
    inThreeDays.setDate(inThreeDays.getDate() + 3)
    const inThreeDaysIso = inThreeDays.toISOString().slice(0, 10)

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  {
                    id: 'client-proposal',
                    name: 'Ariana Event',
                    event_date: inTwoDaysIso,
                    venue: 'Main Hall',
                    pipeline_stage: 'proposal_sent',
                  },
                  {
                    id: 'client-revision',
                    name: 'Hanna Wedding',
                    event_date: inThreeDaysIso,
                    venue: null,
                    pipeline_stage: 'revision',
                  },
                  {
                    id: 'client-completed',
                    name: 'Legacy Client',
                    event_date: null,
                    venue: null,
                    pipeline_stage: 'completed',
                  },
                ],
                error: null,
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchDashboardOverview()
    expect(result.success).toBe(true)

    if (result.success) {
      const proposalStage = result.data.pipelineSummary.find((item) => item.stage === 'proposal_sent')
      const revisionStage = result.data.pipelineSummary.find((item) => item.stage === 'revision')
      const completedStage = result.data.pipelineSummary.find((item) => item.stage === 'completed')

      expect(proposalStage?.count).toBe(1)
      expect(revisionStage?.count).toBe(1)
      expect(completedStage?.count).toBe(1)
      expect(result.data.pendingQuotes.count).toBe(2)
      expect(result.data.upcomingEvents.length).toBeGreaterThan(0)
    }
  })

  it('returns empty upcoming events when none fall in the next 7 days', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  {
                    id: 'client-1',
                    name: 'Far Future Event',
                    event_date: '2099-03-20',
                    venue: 'Garden',
                    pipeline_stage: 'lead',
                  },
                ],
                error: null,
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await fetchDashboardOverview()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.upcomingEvents).toEqual([])
      expect(result.data.pendingQuotes.count).toBe(0)
    }
  })
})

describe('activity actions', () => {
  it('creates activity for client in same tenant', async () => {
    const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'activity-1' }, error: null })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 'client-1' } }),
                }),
              }),
            }),
          }
        }
        if (table === 'client_activities') {
          return {
            insert: () => ({
              select: () => ({
                single: insertSingle,
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await createClientActivity({
      clientId: '123e4567-e89b-12d3-a456-426614174000',
      activityType: 'call',
      summary: 'Initial discovery call',
      note: 'Discussed event style and budget baseline.',
      dueAt: '',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activityId).toBe('activity-1')
    }
  })

  it('lists activities in reverse chronological order and maps logged-by names', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
              in: async () => ({
                data: [{ id: 'user-2', full_name: 'Alex Green' }],
              }),
            }),
          }
        }
        if (table === 'client_activities') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({
                    data: [
                      {
                        id: 'activity-1',
                        client_id: 'client-1',
                        activity_type: 'note',
                        summary: 'Follow-up note',
                        note: 'Client requested peonies.',
                        due_at: null,
                        task_status: 'open',
                        completed_at: null,
                        created_at: '2026-03-31T10:00:00.000Z',
                        logged_by: 'user-2',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await listClientActivities('client-1')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activities[0].loggedBy.name).toBe('Alex Green')
    }
  })

  it('marks task activity complete', async () => {
    const updateSingle = jest.fn().mockResolvedValue({
      data: { id: 'activity-1', task_status: 'completed' },
      error: null,
    })
    const updateEqType = jest.fn().mockReturnValue({ select: () => ({ single: updateSingle }) })
    const updateEqTenant = jest.fn().mockReturnValue({ eq: updateEqType })
    const updateEqId = jest.fn().mockReturnValue({ eq: updateEqTenant })
    const update = jest.fn().mockReturnValue({ eq: updateEqId })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'client_activities') {
          return {
            update,
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await completeClientTaskActivity('activity-1')
    expect(result.success).toBe(true)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        task_status: 'completed',
      })
    )
  })

  it('lists follow-up reminders for current user tasks', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
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
        if (table === 'client_activities') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      not: () => ({
                        order: async () => ({
                          data: [
                            {
                              id: 'activity-1',
                              client_id: 'client-1',
                              summary: 'Follow-up call',
                              due_at: '2026-03-31T09:00:00.000Z',
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'clients') {
          return {
            select: () => ({
              in: async () => ({
                data: [{ id: 'client-1', name: 'Ariana Event' }],
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const result = await listFollowUpReminders()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reminders.length).toBe(1)
      expect(result.data.reminders[0].clientName).toBe('Ariana Event')
    }
  })
})
