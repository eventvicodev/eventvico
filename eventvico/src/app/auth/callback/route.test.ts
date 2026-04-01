import { GET } from '@/app/auth/callback/route'
import { createClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

describe('auth callback route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('redirects to dashboard on successful code exchange', async () => {
    const exchangeCodeForSession = jest.fn().mockResolvedValue({ error: null })

    createClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession,
      },
    } as never)

    const request = new Request(
      'https://eventvico.example/auth/callback?code=oauth-code&redirectTo=/dashboard/settings'
    )
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://eventvico.example/dashboard/settings')
  })

  it('redirects to login with error context when oauth callback fails', async () => {
    const exchangeCodeForSession = jest.fn().mockResolvedValue({
      error: { message: 'exchange failed' },
    })

    createClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession,
      },
    } as never)

    const request = new Request(
      'https://eventvico.example/auth/callback?code=oauth-code&redirectTo=/dashboard'
    )
    const response = await GET(request)
    const location = response.headers.get('location') ?? ''

    expect(response.status).toBe(307)
    expect(location).toContain('/auth/login')
    expect(location).toContain('oauth_error=true')
    expect(location).toContain('redirectTo=%2Fdashboard')
  })

  it('redirects back to register surface when source=register callback fails', async () => {
    const exchangeCodeForSession = jest.fn().mockResolvedValue({
      error: { message: 'exchange failed' },
    })

    createClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession,
      },
    } as never)

    const request = new Request(
      'https://eventvico.example/auth/callback?code=oauth-code&redirectTo=/dashboard&source=register'
    )
    const response = await GET(request)
    const location = response.headers.get('location') ?? ''

    expect(response.status).toBe(307)
    expect(location).toContain('/auth/register')
    expect(location).toContain('oauth_error=true')
  })

  it('redirects to reset update mode for valid recovery link', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({ error: null })

    createClientMock.mockResolvedValue({
      auth: {
        verifyOtp,
      },
    } as never)

    const request = new Request(
      'https://eventvico.example/auth/callback?type=recovery&token_hash=valid-token'
    )
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://eventvico.example/auth/reset?mode=update')
    expect(verifyOtp).toHaveBeenCalledWith({
      type: 'recovery',
      token_hash: 'valid-token',
    })
  })

  it('redirects to reset page with expired status for invalid recovery token', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({ error: { message: 'expired token' } })

    createClientMock.mockResolvedValue({
      auth: {
        verifyOtp,
      },
    } as never)

    const request = new Request(
      'https://eventvico.example/auth/callback?type=recovery&token_hash=expired-token'
    )
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://eventvico.example/auth/reset?status=expired')
  })

  it('redirects to reset page with invalid status when recovery token hash is missing', async () => {
    createClientMock.mockResolvedValue({
      auth: {},
    } as never)

    const request = new Request('https://eventvico.example/auth/callback?type=recovery')
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://eventvico.example/auth/reset?status=invalid')
  })
})
