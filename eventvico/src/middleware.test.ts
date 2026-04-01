import { NextRequest, NextResponse } from 'next/server'
import { __resetAIRateLimiterForTests, middleware } from '@/middleware'
import { updateSession } from '@/lib/supabase/middleware'

jest.mock('@/lib/supabase/middleware', () => ({
  updateSession: jest.fn(),
}))

const updateSessionMock = updateSession as jest.MockedFunction<typeof updateSession>

beforeEach(() => {
  jest.clearAllMocks()
  __resetAIRateLimiterForTests()
})

function makeSupabaseMock(options: {
  userId?: string | null
  tenantId?: string | null
  planStatus?: 'trial' | 'active' | 'past_due' | 'cancelled'
  trialEndsAt?: string | null
}) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: options.userId ? { id: options.userId } : null },
      }),
    },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.tenantId ? { tenant_id: options.tenantId } : null,
              }),
            }),
          }),
        }
      }

      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.tenantId
                  ? {
                      plan_status: options.planStatus ?? 'trial',
                      trial_ends_at: options.trialEndsAt ?? null,
                    }
                  : null,
              }),
            }),
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('middleware trial gating', () => {
  it('redirects unauthenticated access on protected studio route to login', async () => {
    const request = new NextRequest('https://eventvico.example/events')
    updateSessionMock.mockResolvedValue({
      supabase: makeSupabaseMock({
        userId: null,
      }) as never,
      response: NextResponse.next({ request }),
    })

    const response = await middleware(request)
    const location = response.headers.get('location') ?? ''

    expect(response.status).toBe(307)
    expect(location).toContain('/auth/login')
    expect(location).toContain('redirectTo=%2Fevents')
  })

  it('redirects to login when tenant profile linkage is missing', async () => {
    const request = new NextRequest('https://eventvico.example/dashboard')
    updateSessionMock.mockResolvedValue({
      supabase: makeSupabaseMock({
        userId: 'user-1',
        tenantId: null,
      }) as never,
      response: NextResponse.next({ request }),
    })

    const response = await middleware(request)
    const location = response.headers.get('location') ?? ''

    expect(response.status).toBe(307)
    expect(location).toContain('/auth/login')
    expect(location).toContain('auth_error=tenant_profile_missing')
  })

  it('redirects expired trial users to subscription page', async () => {
    const request = new NextRequest('https://eventvico.example/dashboard')
    updateSessionMock.mockResolvedValue({
      supabase: makeSupabaseMock({
        userId: 'user-1',
        tenantId: 'tenant-1',
        planStatus: 'trial',
        trialEndsAt: '2000-01-01T00:00:00.000Z',
      }) as never,
      response: NextResponse.next({ request }),
    })

    const response = await middleware(request)
    const location = response.headers.get('location') ?? ''

    expect(response.status).toBe(307)
    expect(location).toContain('/subscription')
    expect(location).toContain('trial_expired=1')
  })

  it('allows active trial users through to dashboard', async () => {
    const request = new NextRequest('https://eventvico.example/dashboard')
    updateSessionMock.mockResolvedValue({
      supabase: makeSupabaseMock({
        userId: 'user-1',
        tenantId: 'tenant-1',
        planStatus: 'trial',
        trialEndsAt: '2999-01-01T00:00:00.000Z',
      }) as never,
      response: NextResponse.next({ request }),
    })

    const response = await middleware(request)
    expect(response.status).toBe(200)
  })

  it('does not guard public auth or subscription routes', async () => {
    const request = new NextRequest('https://eventvico.example/auth/login')
    updateSessionMock.mockResolvedValue({
      supabase: makeSupabaseMock({
        userId: null,
      }) as never,
      response: NextResponse.next({ request }),
    })

    const response = await middleware(request)
    expect(response.status).toBe(200)
  })

  it('does not guard non-protected public routes', async () => {
    const request = new NextRequest('https://eventvico.example/pricing')
    updateSessionMock.mockResolvedValue({
      supabase: makeSupabaseMock({
        userId: null,
      }) as never,
      response: NextResponse.next({ request }),
    })

    const response = await middleware(request)
    expect(response.status).toBe(200)
  })

  it('rate limits /api/ai/* routes to 10 requests per tenant per minute', async () => {
    for (let index = 0; index < 10; index += 1) {
      const request = new NextRequest('https://eventvico.example/api/ai/generate')
      updateSessionMock.mockResolvedValue({
        supabase: makeSupabaseMock({
          userId: 'user-1',
          tenantId: 'tenant-rate-limit',
        }) as never,
        response: NextResponse.next({ request }),
      })

      const response = await middleware(request)
      expect(response.status).toBe(200)
    }

    const blockedRequest = new NextRequest('https://eventvico.example/api/ai/generate')
    updateSessionMock.mockResolvedValue({
      supabase: makeSupabaseMock({
        userId: 'user-1',
        tenantId: 'tenant-rate-limit',
      }) as never,
      response: NextResponse.next({ request: blockedRequest }),
    })

    const blockedResponse = await middleware(blockedRequest)
    expect(blockedResponse.status).toBe(429)
  })
})
