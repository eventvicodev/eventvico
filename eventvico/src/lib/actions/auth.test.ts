import {
  completePasswordReset,
  registerStudioOwner,
  requestPasswordReset,
  startGoogleOAuth,
} from '@/lib/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))
jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>
const headersMock = headers as jest.MockedFunction<typeof headers>

beforeEach(() => {
  jest.clearAllMocks()
  headersMock.mockResolvedValue(
    new Headers({
      host: 'eventvico.example',
      'x-forwarded-proto': 'https',
    }) as never
  )
})

describe('registerStudioOwner', () => {
  it('maps duplicate email to inline email field error', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', message: 'User already registered', status: 409 },
    })

    createClientMock.mockResolvedValue({
      auth: {
        signUp,
      },
    } as never)

    const result = await registerStudioOwner({
      studioName: 'Bloom Studio',
      email: 'owner@example.com',
      password: 'StrongPass1',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.fields?.email).toEqual(['An account with this email already exists'])
    }
  })

  it('maps weak password to inline password field errors', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'weak_password', message: 'Password should include uppercase, lowercase, and numbers', status: 422 },
    })

    createClientMock.mockResolvedValue({
      auth: {
        signUp,
      },
    } as never)

    const result = await registerStudioOwner({
      studioName: 'Bloom Studio',
      email: 'owner@example.com',
      password: 'weak',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.fields?.password?.length).toBeGreaterThan(0)
    }
  })

  it('returns session-missing error when user exists but no session is issued', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: 'identity-1' }] }, session: null },
      error: null,
    })

    createClientMock.mockResolvedValue({
      auth: {
        signUp,
      },
    } as never)

    const result = await registerStudioOwner({
      studioName: 'Bloom Studio',
      email: 'owner@example.com',
      password: 'StrongPass1',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUTH_SESSION_MISSING')
    }
  })

  it('passes safe redirectTo through to success result', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: {
        user: { id: 'user-1', identities: [{ id: 'identity-1' }] },
        session: { access_token: 'token' },
      },
      error: null,
    })

    createClientMock.mockResolvedValue({
      auth: {
        signUp,
      },
    } as never)

    const result = await registerStudioOwner({
      studioName: 'Bloom Studio',
      email: 'owner@example.com',
      password: 'StrongPass1',
      redirectTo: '/dashboard/settings',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.redirectTo).toBe('/dashboard/settings')
    }
  })

  it('starts google oauth and returns provider url', async () => {
    const signInWithOAuth = jest.fn().mockResolvedValue({
      data: { url: 'https://accounts.google.com/o/oauth2/v2/auth' },
      error: null,
    })

    createClientMock.mockResolvedValue({
      auth: {
        signInWithOAuth,
      },
    } as never)

    const result = await startGoogleOAuth({
      redirectTo: '/dashboard',
      source: 'login',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.url).toContain('google.com')
    }
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        options: expect.objectContaining({
          redirectTo: expect.stringContaining('/auth/callback?'),
        }),
      })
    )
  })

  it('returns oauth start error when supabase oauth init fails', async () => {
    const signInWithOAuth = jest.fn().mockResolvedValue({
      data: { url: null },
      error: { message: 'provider unavailable' },
    })

    createClientMock.mockResolvedValue({
      auth: {
        signInWithOAuth,
      },
    } as never)

    const result = await startGoogleOAuth({
      redirectTo: '/dashboard',
      source: 'register',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUTH_OAUTH_START_FAILED')
    }
  })
})

describe('requestPasswordReset', () => {
  it('returns validation error for invalid email address', async () => {
    const result = await requestPasswordReset({ email: 'invalid-email' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.fields?.email).toEqual(['Please enter a valid email address'])
    }
  })

  it('returns the same neutral response for existing and non-existing accounts', async () => {
    const resetPasswordForEmail = jest
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockRejectedValueOnce(new Error('user not found'))

    createClientMock.mockResolvedValue({
      auth: {
        resetPasswordForEmail,
      },
    } as never)

    const existingResult = await requestPasswordReset({ email: 'owner@example.com' })
    const missingResult = await requestPasswordReset({ email: 'missing@example.com' })

    expect(existingResult.success).toBe(true)
    expect(missingResult.success).toBe(true)

    if (existingResult.success && missingResult.success) {
      expect(existingResult.data.message).toBe("If that email is registered, you'll receive reset instructions")
      expect(missingResult.data.message).toBe("If that email is registered, you'll receive reset instructions")
    }
  })
})

describe('completePasswordReset', () => {
  it('returns inline validation errors when confirmation does not match', async () => {
    const result = await completePasswordReset({
      password: 'StrongPass1',
      confirmPassword: 'Mismatch123',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.fields?.confirmPassword).toEqual(['Passwords do not match'])
    }
  })

  it('updates password and signs out all sessions', async () => {
    const updateUser = jest.fn().mockResolvedValue({ error: null })
    const signOut = jest.fn().mockResolvedValue({ error: null })

    createClientMock.mockResolvedValue({
      auth: {
        updateUser,
        signOut,
      },
    } as never)

    const result = await completePasswordReset({
      password: 'StrongPass1',
      confirmPassword: 'StrongPass1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.redirectTo).toBe('/auth/login?reset=success')
    }
    expect(updateUser).toHaveBeenCalledWith({ password: 'StrongPass1' })
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' })
  })

  it('returns reset error when password update fails', async () => {
    const updateUser = jest.fn().mockResolvedValue({ error: { message: 'invalid recovery token' } })
    const signOut = jest.fn()

    createClientMock.mockResolvedValue({
      auth: {
        updateUser,
        signOut,
      },
    } as never)

    const result = await completePasswordReset({
      password: 'StrongPass1',
      confirmPassword: 'StrongPass1',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUTH_PASSWORD_RESET_FAILED')
    }
    expect(signOut).not.toHaveBeenCalled()
  })
})
