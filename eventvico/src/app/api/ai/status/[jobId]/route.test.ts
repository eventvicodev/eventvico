import { createClient } from '@/lib/supabase/server'
import { GET } from '@/app/api/ai/status/[jobId]/route'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/ai/status/[jobId]', () => {
  it('returns not found when job does not exist', async () => {
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
        if (table === 'ai_jobs') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const response = await GET(
      new Request('https://eventvico.example/api/ai/status/job-404'),
      { params: Promise.resolve({ jobId: 'job-404' }) }
    )

    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload.error.code).toBe('AI_JOB_NOT_FOUND')
  })

  it('returns completed payload with item count', async () => {
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
        if (table === 'ai_jobs') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'job-1',
                      status: 'completed',
                      source_payload: {},
                      result_payload: { itemCount: 3, ingredients: [{ name: 'Rose' }] },
                      error_message: null,
                      created_at: '2026-04-01T12:00:00.000Z',
                    },
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const response = await GET(
      new Request('https://eventvico.example/api/ai/status/job-1'),
      { params: Promise.resolve({ jobId: 'job-1' }) }
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.status).toBe('completed')
    expect(payload.data.itemCount).toBe(3)
  })
})
