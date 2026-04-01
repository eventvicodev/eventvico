'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { startGoogleOAuth } from '@/lib/actions/auth'
import { useToast } from '@/components/ui/toast'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()

  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'

  const executeGoogleAuth = useCallback(async () => {
    const result = await startGoogleOAuth({
      redirectTo,
      source: 'login',
    })

    if (result.success) {
      window.location.assign(result.data.url)
      return { started: true as const }
    }

    return {
      started: false as const,
      message: result.error.message,
    }
  }, [redirectTo])

  const handleGoogleAuth = useCallback(async () => {
    const outcome = await executeGoogleAuth()
    if (outcome.started) return

    addToast('error', outcome.message, {
      label: 'Retry',
      onClick: () => {
        void executeGoogleAuth()
      },
    })
  }, [addToast, executeGoogleAuth])

  useEffect(() => {
    const oauthError = searchParams.get('oauth_error')
    if (!oauthError) return

    const oauthMessage = searchParams.get('oauth_message') ?? 'Google sign-in failed. Please try again.'
    addToast('error', oauthMessage, {
      label: 'Retry',
      onClick: () => {
        void executeGoogleAuth()
      },
    })

    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('oauth_error')
    nextParams.delete('oauth_message')

    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `/auth/login?${nextQuery}` : '/auth/login')
  }, [addToast, executeGoogleAuth, router, searchParams])

  useEffect(() => {
    const resetStatus = searchParams.get('reset')
    if (resetStatus !== 'success') return

    addToast('success', 'Password reset successful. Sign in with your new password.')

    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('reset')

    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `/auth/login?${nextQuery}` : '/auth/login')
  }, [addToast, router, searchParams])

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">Sign in to Eventvico</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Sign in to your studio dashboard.
        </p>

        <Button
          type="button"
          variant="secondary"
          className="mt-5 h-11 w-full"
          onClick={() => {
            void handleGoogleAuth()
          }}
        >
          Continue with Google
        </Button>

        <p className="mt-4 text-sm text-neutral-600">
          <Link
            href="/auth/reset"
            className="inline-flex min-h-11 items-center font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Forgot password?
          </Link>
        </p>

        <p className="mt-2 text-sm text-neutral-600">
          Don&apos;t have an account?{' '}
          <Link
            href="/auth/register"
            className="inline-flex min-h-11 items-center font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Create an account
          </Link>
        </p>
      </div>
    </main>
  )
}
