'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { startSubscriptionCheckout } from '@/lib/actions/subscription'

type Props = {
  isTrialExpired: boolean
  redirectTo: string
  checkoutState: string | null
}

export function SubscriptionCheckout({ isTrialExpired, redirectTo, checkoutState }: Props) {
  const { addToast } = useToast()
  const [isStartingCheckout, setIsStartingCheckout] = useState(false)

  async function beginCheckout() {
    setIsStartingCheckout(true)
    const result = await startSubscriptionCheckout()
    setIsStartingCheckout(false)

    if (result.success) {
      window.location.assign(result.data.url)
      return
    }

    addToast('error', result.error.message, {
      label: 'Retry',
      onClick: () => {
        void beginCheckout()
      },
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">Activate your subscription</h1>
        <p className="mt-3 text-sm text-neutral-600">
          {isTrialExpired
            ? 'Your 14-day free trial has ended. Activate a plan to continue using studio features.'
            : 'Choose a plan to continue with Eventvico.'}
        </p>

        {checkoutState === 'cancelled' ? (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Checkout was cancelled. You can retry any time.
          </p>
        ) : null}

        {checkoutState === 'failed' ? (
          <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            We could not confirm your payment. Please retry checkout.
          </p>
        ) : null}

        <div className="mt-6 rounded-md border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm text-neutral-700">
            Secure checkout is powered by Stripe. Eventvico never handles raw card details.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={redirectTo}
            className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Back to dashboard
          </Link>
          <Button
            type="button"
            className="min-h-11 px-4"
            disabled={isStartingCheckout}
            onClick={() => {
              void beginCheckout()
            }}
          >
            {isStartingCheckout ? 'Redirecting…' : 'Continue to checkout'}
          </Button>
        </div>
      </div>
    </main>
  )
}

