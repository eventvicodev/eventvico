'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { completePasswordReset, requestPasswordReset } from '@/lib/actions/auth'
import { getPasswordRequirementMessages, passwordRequirements } from '@/lib/schemas/auth'

type RequestResetInput = {
  email: string
}

type CompleteResetInput = {
  password: string
  confirmPassword: string
}

function getInputClass(hasError: boolean) {
  return [
    'mt-2 h-11 w-full rounded-md border bg-white px-3 text-sm text-neutral-900 transition',
    'placeholder:text-neutral-400',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
    hasError ? 'border-red-500' : 'border-neutral-300',
  ].join(' ')
}

function getStatusMessage(status: string | null) {
  if (status === 'expired') return 'This reset link has expired. Request a new link below.'
  if (status === 'invalid') return 'This reset link is invalid. Request a new link below.'
  return null
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()
  const [nonFieldError, setNonFieldError] = useState<string | null>(null)
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null)
  const mode = searchParams.get('mode') === 'update' ? 'update' : 'request'
  const statusMessage = getStatusMessage(searchParams.get('status'))

  const {
    register: registerRequest,
    handleSubmit: handleRequestSubmit,
    setError: setRequestError,
    formState: { errors: requestErrors, isSubmitting: isRequestSubmitting },
  } = useForm<RequestResetInput>({
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: { email: '' },
  })

  const {
    register: registerComplete,
    handleSubmit: handleCompleteSubmit,
    setError: setCompleteError,
    formState: { errors: completeErrors, isSubmitting: isCompleteSubmitting },
  } = useForm<CompleteResetInput>({
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  const onSubmitRequest = async (values: RequestResetInput) => {
    setNonFieldError(null)
    setConfirmationMessage(null)

    const result = await requestPasswordReset(values)
    if (result.success) {
      setConfirmationMessage(result.data.message)
      return
    }

    if (result.error.fields?.email?.[0]) {
      setRequestError('email', { type: 'server', message: result.error.fields.email[0] })
      return
    }

    setNonFieldError(result.error.message)
  }

  const onSubmitComplete = async (values: CompleteResetInput) => {
    setNonFieldError(null)

    const result = await completePasswordReset(values)
    if (result.success) {
      addToast('success', 'Password reset successful. Please sign in again.')
      router.push(result.data.redirectTo)
      return
    }

    if (result.error.fields?.password?.[0]) {
      setCompleteError('password', { type: 'server', message: result.error.fields.password[0] })
    }
    if (result.error.fields?.confirmPassword?.[0]) {
      setCompleteError('confirmPassword', { type: 'server', message: result.error.fields.confirmPassword[0] })
    }
    if (!result.error.fields) {
      setNonFieldError(result.error.message)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold text-neutral-900">
          {mode === 'update' ? 'Set a new password' : 'Reset your password'}
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          {mode === 'update'
            ? 'Enter a new password for your account.'
            : 'Enter your account email to receive a password reset link.'}
        </p>

        {statusMessage ? (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            {statusMessage}
          </p>
        ) : null}

        {confirmationMessage ? (
          <p className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">
            {confirmationMessage}
          </p>
        ) : null}

        {mode === 'update' ? (
          <form onSubmit={handleCompleteSubmit(onSubmitComplete)} className="mt-4 space-y-4" noValidate>
            <div>
              <label htmlFor="password" className="text-sm font-medium text-neutral-800">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className={getInputClass(Boolean(completeErrors.password))}
                {...registerComplete('password', {
                  validate: (value) => {
                    const failures = getPasswordRequirementMessages(value)
                    return failures.length > 0 ? failures[0] : true
                  },
                })}
              />
              {completeErrors.password?.message ? (
                <p className="mt-1 text-xs text-red-600">{completeErrors.password.message}</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs text-neutral-600">
                  {passwordRequirements.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="text-sm font-medium text-neutral-800">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className={getInputClass(Boolean(completeErrors.confirmPassword))}
                {...registerComplete('confirmPassword', {
                  validate: (value, formValues) => value === formValues.password || 'Passwords do not match',
                })}
              />
              {completeErrors.confirmPassword?.message ? (
                <p className="mt-1 text-xs text-red-600">{completeErrors.confirmPassword.message}</p>
              ) : null}
            </div>

            {nonFieldError ? (
              <p className="text-xs text-red-600" role="alert">
                {nonFieldError}
              </p>
            ) : null}

            <Button type="submit" className="h-11 w-full" disabled={isCompleteSubmitting}>
              Update password
            </Button>
          </form>
        ) : (
          <form onSubmit={handleRequestSubmit(onSubmitRequest)} className="mt-4 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="text-sm font-medium text-neutral-800">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={getInputClass(Boolean(requestErrors.email))}
                {...registerRequest('email', {
                  validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || 'Please enter a valid email address',
                })}
              />
              {requestErrors.email?.message ? (
                <p className="mt-1 text-xs text-red-600">{requestErrors.email.message}</p>
              ) : null}
            </div>

            <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
              If you sign in with Google, password recovery is managed in your Google account security settings.
            </p>

            {nonFieldError ? (
              <p className="text-xs text-red-600" role="alert">
                {nonFieldError}
              </p>
            ) : null}

            <Button type="submit" className="h-11 w-full" disabled={isRequestSubmitting}>
              Send reset link
            </Button>
          </form>
        )}

        <p className="mt-4 text-sm text-neutral-600">
          Remembered your password?{' '}
          <Link
            href="/auth/login"
            className="inline-flex min-h-11 items-center font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
