'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createStudioClient } from '@/lib/actions/clients'
import type { CreateClientInput } from '@/lib/schemas/clients'

const fieldOrder: Array<keyof CreateClientInput> = ['name', 'email', 'phone', 'eventDate', 'venue', 'guestCount', 'budget']

function getInputClass(hasError: boolean) {
  return [
    'mt-2 h-11 w-full rounded-md border bg-white px-3 text-sm text-neutral-900 transition',
    'placeholder:text-neutral-400',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
    hasError ? 'border-red-500' : 'border-neutral-300',
  ].join(' ')
}

export default function NewClientPage() {
  const router = useRouter()
  const [nonFieldError, setNonFieldError] = useState<string | null>(null)
  const [duplicateState, setDuplicateState] = useState<{ id: string; message: string } | null>(null)
  const [lastValues, setLastValues] = useState<CreateClientInput | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<CreateClientInput>({
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      eventDate: '',
      venue: '',
      guestCount: '',
      budget: '',
    },
  })

  const focusFirstInvalidField = (fieldErrors: FieldErrors<CreateClientInput>) => {
    const firstField = fieldOrder.find((key) => Boolean(fieldErrors[key]))
    if (!firstField) return
    setFocus(firstField)
    const element = document.getElementById(firstField)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const onInvalid = (fieldErrors: FieldErrors<CreateClientInput>) => {
    setNonFieldError(null)
    focusFirstInvalidField(fieldErrors)
  }

  const onSubmit = async (values: CreateClientInput) => {
    setNonFieldError(null)
    setDuplicateState(null)
    setLastValues(values)

    const result = await createStudioClient(values)
    if (result.success) {
      if ('status' in result.data && result.data.status === 'duplicate') {
        setDuplicateState({
          id: result.data.existingClientId,
          message: result.data.message,
        })
        return
      }

      if ('redirectTo' in result.data) {
        router.push(result.data.redirectTo)
        return
      }
    }

    if (!result.success && result.error.fields) {
      fieldOrder.forEach((fieldName) => {
        const messages = result.error.fields?.[fieldName]
        if (messages && messages.length > 0) {
          setError(fieldName, { type: 'server', message: messages[0] })
        }
      })
      focusFirstInvalidField({
        name: result.error.fields.name ? { type: 'server' } : undefined,
        email: result.error.fields.email ? { type: 'server' } : undefined,
        phone: result.error.fields.phone ? { type: 'server' } : undefined,
        eventDate: result.error.fields.eventDate ? { type: 'server' } : undefined,
        venue: result.error.fields.venue ? { type: 'server' } : undefined,
        guestCount: result.error.fields.guestCount ? { type: 'server' } : undefined,
        budget: result.error.fields.budget ? { type: 'server' } : undefined,
      })
      return
    }

    if (!result.success) {
      setNonFieldError(result.error.message)
    }
  }

  const handleCreateWithDuplicate = async () => {
    if (!lastValues) return
    const result = await createStudioClient({
      ...lastValues,
      allowDuplicateEmail: true,
    })
    if (result.success && 'redirectTo' in result.data) {
      router.push(result.data.redirectTo)
      return
    }
    if (!result.success) {
      setNonFieldError(result.error.message)
    }
  }

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">Register client</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Capture core client and event details to start pipeline tracking.
        </p>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="mt-6 grid gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2">
            <label htmlFor="name" className="text-sm font-medium text-neutral-800">
              Client name <span aria-hidden="true">*</span>
            </label>
            <input
              id="name"
              type="text"
              autoFocus
              className={getInputClass(Boolean(errors.name))}
              {...register('name', {
                validate: (value) => value.trim().length >= 2 || 'Client name is required',
              })}
            />
            {errors.name?.message ? <p className="mt-1 text-xs text-red-600">{errors.name.message}</p> : null}
          </div>

          <div>
            <label htmlFor="email" className="text-sm font-medium text-neutral-800">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={getInputClass(Boolean(errors.email))}
              {...register('email', {
                validate: (value) =>
                  !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || 'Please enter a valid email address',
              })}
            />
            {errors.email?.message ? <p className="mt-1 text-xs text-red-600">{errors.email.message}</p> : null}
          </div>

          <div>
            <label htmlFor="phone" className="text-sm font-medium text-neutral-800">Phone</label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              className={getInputClass(Boolean(errors.phone))}
              {...register('phone')}
            />
            {errors.phone?.message ? <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p> : null}
          </div>

          <div>
            <label htmlFor="eventDate" className="text-sm font-medium text-neutral-800">Event date</label>
            <input id="eventDate" type="date" className={getInputClass(Boolean(errors.eventDate))} {...register('eventDate')} />
            {errors.eventDate?.message ? <p className="mt-1 text-xs text-red-600">{errors.eventDate.message}</p> : null}
          </div>

          <div>
            <label htmlFor="venue" className="text-sm font-medium text-neutral-800">Venue</label>
            <input id="venue" type="text" className={getInputClass(Boolean(errors.venue))} {...register('venue')} />
            {errors.venue?.message ? <p className="mt-1 text-xs text-red-600">{errors.venue.message}</p> : null}
          </div>

          <div>
            <label htmlFor="guestCount" className="text-sm font-medium text-neutral-800">Guest count</label>
            <input id="guestCount" type="number" min={0} className={getInputClass(Boolean(errors.guestCount))} {...register('guestCount')} />
            {errors.guestCount?.message ? <p className="mt-1 text-xs text-red-600">{errors.guestCount.message}</p> : null}
          </div>

          <div>
            <label htmlFor="budget" className="text-sm font-medium text-neutral-800">Budget</label>
            <input id="budget" type="number" min={0} step="0.01" className={getInputClass(Boolean(errors.budget))} {...register('budget')} />
            {errors.budget?.message ? <p className="mt-1 text-xs text-red-600">{errors.budget.message}</p> : null}
          </div>

          {duplicateState ? (
            <div className="sm:col-span-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>{duplicateState.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/clients/${duplicateState.id}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-amber-500 px-3 text-sm font-medium hover:bg-amber-100"
                >
                  View existing client
                </Link>
                <Button type="button" variant="secondary" onClick={() => { void handleCreateWithDuplicate() }}>
                  Create anyway
                </Button>
              </div>
            </div>
          ) : null}

          {nonFieldError ? <p className="sm:col-span-2 text-xs text-red-600">{nonFieldError}</p> : null}

          {isSubmitting ? (
            <div className="sm:col-span-2 space-y-2">
              <Skeleton className="h-11 w-full" />
            </div>
          ) : null}

          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <Button type="submit" className="h-11" disabled={isSubmitting}>
              Create client
            </Button>
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  )
}

