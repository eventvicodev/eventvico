'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { registerStudioOwner, startGoogleOAuth } from '@/lib/actions/auth'
import {
  getPasswordRequirementMessages,
  passwordRequirements,
  type RegisterStudioInput,
} from '@/lib/schemas/auth'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'

const fieldOrder: Array<keyof RegisterStudioInput> = ['studioName', 'email', 'password']

function getInputClass(hasError: boolean) {
  return [
    'mt-2 h-11 w-full rounded-md border bg-white px-3 text-sm text-neutral-900 transition',
    'placeholder:text-neutral-400',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
    hasError ? 'border-red-500' : 'border-neutral-300',
  ].join(' ')
}

async function runGoogleOAuth(redirectTo: string) {
  const result = await startGoogleOAuth({
    redirectTo,
    source: 'register',
  })

  if (result.success) {
    window.location.assign(result.data.url)
    return { started: true as const }
  }

  return {
    started: false as const,
    message: result.error.message,
  }
}

export default function RegisterPage() {
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
  } = useForm<RegisterStudioInput>({
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: {
      studioName: '',
      email: '',
      password: '',
    },
  })

  const focusFirstInvalidField = (fieldErrors: FieldErrors<RegisterStudioInput>) => {
    const firstField = fieldOrder.find((key) => Boolean(fieldErrors[key]))
    if (!firstField) return

    setFocus(firstField)
    const element = document.getElementById(firstField)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const onInvalid = (fieldErrors: FieldErrors<RegisterStudioInput>) => {
    setNonFieldError(null)
    focusFirstInvalidField(fieldErrors)
  }

  const onSubmit = async (values: RegisterStudioInput) => {
    setNonFieldError(null)

    const result = await registerStudioOwner({ ...values, redirectTo })
    if (result.success) {
      addToast('success', 'Account created. Redirecting to your dashboard...')
      window.setTimeout(() => {
        router.push(result.data.redirectTo)
      }, 4000)
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
        studioName: result.error.fields.studioName ? { type: 'server' } : undefined,
        email: result.error.fields.email ? { type: 'server' } : undefined,
        password: result.error.fields.password ? { type: 'server' } : undefined,
      })
      return
    }

    setNonFieldError(result.error.message)
  }

  const handleGoogleAuth = async () => {
    const outcome = await runGoogleOAuth(redirectTo)
    if (outcome.started) return

    addToast('error', outcome.message, {
      label: 'Retry',
      onClick: () => {
        void runGoogleOAuth(redirectTo)
      },
    })
  }

  useEffect(() => {
    const oauthError = searchParams.get('oauth_error')
    if (!oauthError) return

    const oauthMessage = searchParams.get('oauth_message') ?? 'Google sign-in failed. Please try again.'
    addToast('error', oauthMessage, {
      label: 'Retry',
      onClick: () => {
        void runGoogleOAuth(redirectTo)
      },
    })

    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('oauth_error')
    nextParams.delete('oauth_message')

    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `/auth/register?${nextQuery}` : '/auth/register')
  }, [addToast, redirectTo, router, searchParams])

  const studioNameField = register('studioName', {
    validate: (value) => {
      const trimmed = value.trim()
      if (!trimmed) return 'Studio name is required'
      if (trimmed.length < 2) return 'Studio name is required'
      if (trimmed.length > 120) return 'Studio name must be 120 characters or fewer'
      return true
    },
  })

  const emailField = register('email', {
    validate: (value) => {
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
      return isValid || 'Please enter a valid email address'
    },
  })

  const passwordField = register('password', {
    validate: (value) => {
      const failures = getPasswordRequirementMessages(value)
      return failures.length > 0 ? failures[0] : true
    },
  })

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold text-neutral-900">Create your Eventvico account</h1>
        <p className="mt-2 text-sm text-neutral-600">Set up your studio workspace with email and password.</p>

        <Button
          type="button"
          variant="secondary"
          className="mt-6 h-11 w-full"
          onClick={() => {
            void handleGoogleAuth()
          }}
        >
          Continue with Google
        </Button>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="mt-4 space-y-4" noValidate>
          <div>
            <label htmlFor="studioName" className="text-sm font-medium text-neutral-800">
              Business name <span aria-hidden="true">*</span>
            </label>
            <input
              id="studioName"
              type="text"
              autoComplete="organization"
              autoFocus
              className={getInputClass(Boolean(errors.studioName))}
              {...studioNameField}
            />
            {errors.studioName?.message ? (
              <p className="mt-1 text-xs text-red-600">{errors.studioName.message}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="email" className="text-sm font-medium text-neutral-800">
              Email <span aria-hidden="true">*</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={getInputClass(Boolean(errors.email))}
              {...emailField}
            />
            {errors.email?.message ? (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="password" className="text-sm font-medium text-neutral-800">
              Password <span aria-hidden="true">*</span>
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className={getInputClass(Boolean(errors.password))}
              {...passwordField}
            />
            {errors.password?.message ? (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-neutral-600">
                {passwordRequirements.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            )}
          </div>

          {nonFieldError ? (
            <p className="text-xs text-red-600" role="alert">
              {nonFieldError}
            </p>
          ) : null}

          {isSubmitting ? (
            <div className="space-y-2">
              <Skeleton className="h-11 w-full" />
            </div>
          ) : null}

          <Button
            type="submit"
            className="h-11 w-full"
            disabled={isSubmitting}
          >
            Create account
          </Button>
        </form>

        <p className="mt-4 text-sm text-neutral-600">
          Already have an account?{' '}
          <Link
            href="/auth/login"
            className="inline-flex min-h-11 items-center font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
