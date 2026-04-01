import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function normalizeAuthSource(source?: string | null): 'login' | 'register' {
  return source === 'register' ? 'register' : 'login'
}

function normalizeRedirectTo(redirectTo?: string | null): string {
  if (!redirectTo) return '/dashboard'
  if (!redirectTo.startsWith('/')) return '/dashboard'
  if (redirectTo.startsWith('//')) return '/dashboard'
  return redirectTo
}

function redirectToAuthWithError(requestUrl: URL, source: 'login' | 'register', message: string) {
  const redirectUrl = new URL(`/auth/${source}`, requestUrl.origin)
  const redirectTo = requestUrl.searchParams.get('redirectTo')

  redirectUrl.searchParams.set('oauth_error', 'true')
  redirectUrl.searchParams.set('oauth_message', message)

  if (redirectTo) {
    redirectUrl.searchParams.set('redirectTo', normalizeRedirectTo(redirectTo))
  }

  return NextResponse.redirect(redirectUrl)
}

function redirectToResetWithStatus(requestUrl: URL, status: 'expired' | 'invalid') {
  const redirectUrl = new URL('/auth/reset', requestUrl.origin)
  redirectUrl.searchParams.set('status', status)
  return NextResponse.redirect(redirectUrl)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const redirectTo = normalizeRedirectTo(url.searchParams.get('redirectTo'))
  const source = normalizeAuthSource(url.searchParams.get('source'))

  if (type === 'recovery') {
    if (error) {
      return redirectToResetWithStatus(url, 'expired')
    }

    const tokenHash = url.searchParams.get('token_hash')
    if (!tokenHash) {
      return redirectToResetWithStatus(url, 'invalid')
    }

    try {
      const supabase = await createClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: 'recovery',
        token_hash: tokenHash,
      })

      if (verifyError) {
        return redirectToResetWithStatus(url, 'expired')
      }

      const resetUrl = new URL('/auth/reset?mode=update', url.origin)
      return NextResponse.redirect(resetUrl)
    } catch {
      return redirectToResetWithStatus(url, 'expired')
    }
  }

  if (error) {
    return redirectToAuthWithError(url, source, 'Google sign-in was cancelled or failed. Please try again.')
  }

  if (!code) {
    return redirectToAuthWithError(url, source, 'Missing OAuth callback code. Please try again.')
  }

  try {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
      return redirectToAuthWithError(url, source, 'Could not complete Google sign-in. Please try again.')
    }

    const successUrl = new URL(redirectTo, url.origin)
    return NextResponse.redirect(successUrl)
  } catch {
    return redirectToAuthWithError(url, source, 'Could not complete Google sign-in. Please try again.')
  }
}
