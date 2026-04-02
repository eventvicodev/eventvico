'use server'

import { createClient } from '@/lib/supabase/server'
import { getPasswordRequirementMessages, loginSchema, registerStudioSchema } from '@/lib/schemas/auth'
import type { ActionResult } from '@/types/app'
import { headers } from 'next/headers'

type RegisterStudioOwnerResult = ActionResult<{ redirectTo: string }>
type SignInResult = ActionResult<{ redirectTo: string }>
type StartGoogleOAuthResult = ActionResult<{ url: string }>
type RequestPasswordResetResult = ActionResult<{ message: string }>
type CompletePasswordResetResult = ActionResult<{ redirectTo: string }>
type RegisterStudioOwnerInput = {
  studioName: string
  email: string
  password: string
  redirectTo?: string
}
type StartGoogleOAuthInput = {
  redirectTo?: string
  source?: 'login' | 'register'
}
type RequestPasswordResetInput = {
  email: string
}
type CompletePasswordResetInput = {
  password: string
  confirmPassword: string
}

function mapZodFieldErrors(input: unknown): Record<string, string[]> | undefined {
  const parsed = registerStudioSchema.safeParse(input)
  if (parsed.success) {
    return undefined
  }

  const fields = parsed.error.flatten().fieldErrors
  const mapped: Record<string, string[]> = {}

  Object.entries(fields).forEach(([key, value]) => {
    if (value && value.length > 0) {
      mapped[key] = value
    }
  })

  return Object.keys(mapped).length > 0 ? mapped : undefined
}

function normalizeRedirectTo(redirectTo?: string): string {
  if (!redirectTo) return '/dashboard'
  if (!redirectTo.startsWith('/')) return '/dashboard'
  if (redirectTo.startsWith('//')) return '/dashboard'
  return redirectTo
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function normalizeAuthSource(source?: string): 'login' | 'register' {
  return source === 'register' ? 'register' : 'login'
}

async function resolveServerOrigin(): Promise<string | null> {
  const headerStore = await headers()
  const forwardedProtoRaw = headerStore.get('x-forwarded-proto')
  const forwardedProto = forwardedProtoRaw?.split(',')[0]?.trim()
  const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https'
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host')

  if (host) {
    return `${protocol}://${host}`
  }

  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL
  if (configuredOrigin) {
    return normalizeOrigin(configuredOrigin)
  }

  return null
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || !error) return undefined
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode.toLowerCase() : undefined
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || !error) return undefined
  const maybeStatus = (error as { status?: unknown }).status
  return typeof maybeStatus === 'number' ? maybeStatus : undefined
}

function getErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || !error) return ''
  const maybeMessage = (error as { message?: unknown }).message
  return typeof maybeMessage === 'string' ? maybeMessage : ''
}

function isDuplicateEmailError(error: unknown) {
  const code = getErrorCode(error)
  if (code && (code.includes('already_exists') || code.includes('already_registered') || code.includes('user_already_exists'))) {
    return true
  }

  const status = getErrorStatus(error)
  if (status === 409) return true

  const normalized = getErrorMessage(error).toLowerCase()
  if (!normalized) return false

  return (
    normalized.includes('already registered') ||
    normalized.includes('already exists') ||
    normalized.includes('already been registered') ||
    normalized.includes('already in use')
  )
}

function isWeakPasswordError(error: unknown) {
  const code = getErrorCode(error)
  if (code && (code.includes('weak_password') || code.includes('password'))) {
    return true
  }

  const status = getErrorStatus(error)
  if (status === 422) return true

  const normalized = getErrorMessage(error).toLowerCase()
  if (!normalized) return false

  return normalized.includes('password') && (
    normalized.includes('least') ||
    normalized.includes('weak') ||
    normalized.includes('uppercase') ||
    normalized.includes('lowercase') ||
    normalized.includes('number')
  )
}

function mapResetPasswordErrors(password: string, confirmPassword: string): Record<string, string[]> | undefined {
  const fields: Record<string, string[]> = {}
  const passwordErrors = getPasswordRequirementMessages(password)

  if (passwordErrors.length > 0) {
    fields.password = [passwordErrors[0]]
  }
  if (!confirmPassword) {
    fields.confirmPassword = ['Please confirm your new password']
  } else if (password !== confirmPassword) {
    fields.confirmPassword = ['Passwords do not match']
  }

  return Object.keys(fields).length > 0 ? fields : undefined
}

export async function registerStudioOwner(input: unknown): Promise<RegisterStudioOwnerResult> {
  try {
    const parsedInput = registerStudioSchema.safeParse(input)
    if (!parsedInput.success) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please correct the highlighted fields',
          fields: mapZodFieldErrors(input),
        },
      }
    }

    const supabase = await createClient()
    const { studioName, email, password } = parsedInput.data
    const redirectTo = normalizeRedirectTo((input as RegisterStudioOwnerInput | undefined)?.redirectTo)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          studio_name: studioName,
        },
      },
    })

    const noIdentityFound = data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0

    if (isDuplicateEmailError(error) || noIdentityFound) {
      return {
        success: false,
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'Email is already registered',
          fields: {
            email: ['An account with this email already exists'],
          },
        },
      }
    }

    if (isWeakPasswordError(error)) {
      return {
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message: 'Password does not meet requirements',
          fields: {
            password: getPasswordRequirementMessages(password),
          },
        },
      }
    }

    if (error) {
      return {
        success: false,
        error: {
          code: 'AUTH_SIGNUP_FAILED',
          message: getErrorMessage(error) || 'Could not complete registration. Please try again.',
        },
      }
    }

    if (!data?.user || !data.session) {
      return {
        success: false,
        error: {
          code: 'AUTH_SESSION_MISSING',
          message: 'Registration completed but sign-in session was not created. Please sign in.',
        },
      }
    }

    return {
      success: true,
      data: {
        redirectTo,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'AUTH_SIGNUP_FAILED',
        message: 'Could not complete registration. Please try again.',
      },
    }
  }
}

export async function signInWithEmailPassword(input: unknown): Promise<SignInResult> {
  try {
    const parsed = loginSchema.safeParse(input)
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please correct the highlighted fields',
          fields: Object.fromEntries(
            Object.entries(fields).filter(([, v]) => v && v.length > 0)
          ),
        },
      }
    }

    const { email, password } = parsed.data
    const redirectTo = normalizeRedirectTo((input as { redirectTo?: string } | undefined)?.redirectTo)

    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      const normalized = getErrorMessage(error).toLowerCase()
      const isInvalidCredentials =
        normalized.includes('invalid login') ||
        normalized.includes('invalid credentials') ||
        normalized.includes('email not confirmed') ||
        getErrorCode(error) === 'invalid_credentials'

      if (isInvalidCredentials) {
        return {
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Incorrect email or password',
          },
        }
      }

      return {
        success: false,
        error: {
          code: 'AUTH_SIGNIN_FAILED',
          message: getErrorMessage(error) || 'Could not sign in. Please try again.',
        },
      }
    }

    return {
      success: true,
      data: { redirectTo },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'AUTH_SIGNIN_FAILED',
        message: 'Could not sign in. Please try again.',
      },
    }
  }
}

export async function startGoogleOAuth(input: unknown): Promise<StartGoogleOAuthResult> {
  try {
    const parsed = input as StartGoogleOAuthInput | undefined
    const origin = await resolveServerOrigin()
    const redirectTo = normalizeRedirectTo(parsed?.redirectTo)
    const source = normalizeAuthSource(parsed?.source)

    if (!origin) {
      return {
        success: false,
        error: {
          code: 'AUTH_OAUTH_INVALID_ORIGIN',
          message: 'Could not start Google sign-in. Please refresh and try again.',
        },
      }
    }

    const callbackUrl = new URL('/auth/callback', origin)
    callbackUrl.searchParams.set('redirectTo', redirectTo)
    callbackUrl.searchParams.set('source', source)

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl.toString(),
        queryParams: {
          prompt: 'select_account',
        },
      },
    })

    if (error || !data?.url) {
      return {
        success: false,
        error: {
          code: 'AUTH_OAUTH_START_FAILED',
          message: getErrorMessage(error) || 'Could not start Google sign-in. Please try again.',
        },
      }
    }

    return {
      success: true,
      data: {
        url: data.url,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'AUTH_OAUTH_START_FAILED',
        message: 'Could not start Google sign-in. Please try again.',
      },
    }
  }
}

export async function requestPasswordReset(input: unknown): Promise<RequestPasswordResetResult> {
  const neutralMessage = "If that email is registered, you'll receive reset instructions"

  try {
    const parsed = input as RequestPasswordResetInput | undefined
    const email = parsed?.email?.trim().toLowerCase() ?? ''
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    if (!validEmail) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please enter a valid email address',
          fields: { email: ['Please enter a valid email address'] },
        },
      }
    }

    const origin = await resolveServerOrigin()
    if (!origin) {
      return {
        success: true,
        data: {
          message: neutralMessage,
        },
      }
    }

    const supabase = await createClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?type=recovery`,
    })

    return {
      success: true,
      data: {
        message: neutralMessage,
      },
    }
  } catch {
    return {
      success: true,
      data: {
        message: neutralMessage,
      },
    }
  }
}

export async function completePasswordReset(input: unknown): Promise<CompletePasswordResetResult> {
  try {
    const parsed = input as CompletePasswordResetInput | undefined
    const password = parsed?.password ?? ''
    const confirmPassword = parsed?.confirmPassword ?? ''
    const validationFields = mapResetPasswordErrors(password, confirmPassword)

    if (validationFields) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please correct the highlighted fields',
          fields: validationFields,
        },
      }
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      return {
        success: false,
        error: {
          code: 'AUTH_PASSWORD_RESET_FAILED',
          message: getErrorMessage(error) || 'Could not reset password. Please request a new reset link.',
        },
      }
    }

    // Revoke all sessions after password change.
    await supabase.auth.signOut({ scope: 'global' })

    return {
      success: true,
      data: {
        redirectTo: '/auth/login?reset=success',
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'AUTH_PASSWORD_RESET_FAILED',
        message: 'Could not reset password. Please request a new reset link.',
      },
    }
  }
}
