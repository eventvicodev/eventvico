'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { signInWithEmailPassword, startGoogleOAuth } from '@/lib/actions/auth'
import { type LoginInput } from '@/lib/schemas/auth'
import { useToast } from '@/components/ui/toast'

const fieldOrder: Array<keyof LoginInput> = ['email', 'password']

function getInputClass(hasError: boolean) {
  return [
    'mt-2 h-11 w-full rounded-md border bg-white px-3 text-sm text-neutral-900 transition',
    'placeholder:text-neutral-400',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
    hasError ? 'border-red-500' : 'border-neutral-300',
  ].join(' ')
}

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()
  const [nonFieldError, setNonFieldError] = useState<string | null>(null)

  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: { email: '', password: '' },
  })

  const focusFirstInvalidField = (fieldErrors: FieldErrors<LoginInput>) => {
    const firstField = fieldOrder.find((key) => Boolean(fieldErrors[key]))
    if (!firstField) return
    setFocus(firstField)
  }

  const onInvalid = (fieldErrors: FieldErrors<LoginInput>) => {
    setNonFieldError(null)
    focusFirstInvalidField(fieldErrors)
  }

  const onSubmit = async (values: LoginInput) => {
    setNonFieldError(null)

    const result = await signInWithEmailPassword({ ...values, redirectTo })

    if (result.success) {
      router.push(result.data.redirectTo)
      return
    }

    if (result.error.fields) {
      fieldOrder.forEach((fieldName) => {
        const messages = result.error.fields?.[fieldName]
        if (messages && messages.length > 0) {
          setError(fieldName, { type: 'server', message: messages[0] })
        }
      })
      focusFirstInvalidField({
        email: result.error.fields.email ? { type: 'server' } : undefined,
        password: result.error.fields.password ? { type: 'server' } : undefined,
      })
      return
    }

    setNonFieldError(result.error.message)
  }

  const executeGoogleAuth = useCallback(async () => {
    const result = await startGoogleOAuth({ redirectTo, source: 'login' })
    if (result.success) {
      window.location.assign(result.data.url)
      return { started: true as const }
    }
    return { started: false as const, message: result.error.message }
  }, [redirectTo])

  const handleGoogleAuth = useCallback(async () => {
    const outcome = await executeGoogleAuth()
    if (outcome.started) return
    addToast('error', outcome.message, {
      label: 'Retry',
      onClick: () => { void executeGoogleAuth() },
    })
  }, [addToast, executeGoogleAuth])

  useEffect(() => {
    const oauthError = searchParams.get('oauth_error')
    if (!oauthError) return
    const oauthMessage = searchParams.get('oauth_message') ?? 'Google sign-in failed. Please try again.'
    addToast('error', oauthMessage, {
      label: 'Retry',
      onClick: () => { void executeGoogleAuth() },
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

  const emailField = register('email', {
    validate: (value) => {
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
      return isValid || 'Please enter a valid email address'
    },
  })

  const passwordField = register('password', {
    validate: (value) => value.length > 0 || 'Password is required',
  })

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">Sign in to Eventvico</h1>
        <p className="mt-2 text-sm text-neutral-500">Sign in to your studio dashboard.</p>

        <Button
          type="button"
          variant="secondary"
          className="mt-5 h-11 w-full"
          onClick={() => { void handleGoogleAuth() }}
        >
          Continue with Google
        </Button>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-neutral-200" />
          <span className="text-xs text-neutral-400">or</span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="text-sm font-medium text-neutral-800">
              Email <span aria-hidden="true">*</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              className={getInputClass(Boolean(errors.email))}
              {...emailField}
            />
            {errors.email?.message ? (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-neutral-800">
                Password <span aria-hidden="true">*</span>
              </label>
              <Link
                href="/auth/reset"
                className="text-xs font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className={getInputClass(Boolean(errors.password))}
              {...passwordField}
            />
            {errors.password?.message ? (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            ) : null}
          </div>

          {nonFieldError ? (
            <p className="text-xs text-red-600" role="alert">{nonFieldError}</p>
          ) : null}

          <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-sm text-neutral-600">
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
