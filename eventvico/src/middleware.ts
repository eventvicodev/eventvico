import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { createAdminClient } from '@/lib/supabase/admin'
import { shouldRedirectToSubscription } from '@/lib/subscription/trial'

const AI_RATE_LIMIT_PER_MINUTE = 10
const AI_RATE_LIMIT_WINDOW_MS = 60_000
const aiRateLimitWindow = new Map<string, { count: number; startedAt: number }>()

function consumeAIRateLimit(key: string, now: number) {
  const current = aiRateLimitWindow.get(key)
  if (!current || now - current.startedAt >= AI_RATE_LIMIT_WINDOW_MS) {
    aiRateLimitWindow.set(key, { count: 1, startedAt: now })
    return { limited: false, remaining: AI_RATE_LIMIT_PER_MINUTE - 1 }
  }

  if (current.count >= AI_RATE_LIMIT_PER_MINUTE) {
    return { limited: true, remaining: 0 }
  }

  current.count += 1
  aiRateLimitWindow.set(key, current)
  return { limited: false, remaining: AI_RATE_LIMIT_PER_MINUTE - current.count }
}

function isStudioPath(pathname: string) {
  const protectedPrefixes = [
    '/dashboard',
    '/clients',
    '/events',
    '/inventory',
    '/recipes',
    '/quotes',
    '/pipeline',
    '/calendar',
    '/team',
    '/settings',
  ]

  return protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = await updateSession(request)

  const { pathname } = request.nextUrl
  if (pathname.startsWith('/api/ai/')) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    let rateLimitKey = `ip:${forwardedFor ?? 'unknown'}`
    if (user?.id) {
      const { data: profile } = await createAdminClient()
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle()
      if (profile?.tenant_id) {
        rateLimitKey = `tenant:${profile.tenant_id}`
      }
    }

    const { limited, remaining } = consumeAIRateLimit(rateLimitKey, Date.now())
    if (limited) {
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'AI generation limit reached. Try again in about a minute.',
          },
        },
        {
          status: 429,
          headers: {
            'x-ratelimit-limit': String(AI_RATE_LIMIT_PER_MINUTE),
            'x-ratelimit-remaining': '0',
          },
        }
      )
    }

    response.headers.set('x-ratelimit-limit', String(AI_RATE_LIMIT_PER_MINUTE))
    response.headers.set('x-ratelimit-remaining', String(remaining))
    return response
  }

  if (!isStudioPath(pathname)) return response

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  const adminSupabase = createAdminClient()

  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.tenant_id) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectTo', pathname)
    redirectUrl.searchParams.set('auth_error', 'tenant_profile_missing')
    return NextResponse.redirect(redirectUrl)
  }

  const { data: tenant } = await adminSupabase
    .from('tenants')
    .select('plan_status, trial_ends_at')
    .eq('id', profile.tenant_id)
    .maybeSingle()

  if (shouldRedirectToSubscription(tenant)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/subscription'
    redirectUrl.searchParams.set('trial_expired', '1')
    redirectUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  if (!tenant) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectTo', pathname)
    redirectUrl.searchParams.set('auth_error', 'tenant_record_missing')
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export function __resetAIRateLimiterForTests() {
  aiRateLimitWindow.clear()
}

export const config = {
  matcher: [
    '/api/ai/:path*',
    // Skip API routes and static assets.
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
