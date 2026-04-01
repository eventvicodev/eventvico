'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import {
  cancelSubscription,
  fetchSubscriptionOverview,
  startBillingPortal,
} from '@/lib/actions/subscription'

type Props = {
  portalState: string | null
}

type OverviewState = {
  planName: string
  billingPeriod: string
  nextRenewalDate: string | null
  lastPaymentStatus: string
  cancelAtPeriodEnd: boolean
  cancelAtDate: string | null
  isBillingUnavailable: boolean
}

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

export function SubscriptionManagement({ portalState }: Props) {
  const { addToast } = useToast()
  const [overview, setOverview] = useState<OverviewState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isOpeningPortal, setIsOpeningPortal] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function loadOverview() {
    setIsLoading(true)
    const result = await fetchSubscriptionOverview()
    setIsLoading(false)

    if (!result.success) {
      addToast('error', result.error.message, {
        label: 'Retry',
        onClick: () => {
          void loadOverview()
        },
      })
      return
    }

    setOverview(result.data)
  }

  useEffect(() => {
    void loadOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (portalState !== 'updated') return
    addToast('success', 'Billing details updated successfully.')
  }, [addToast, portalState])

  const cancellationText = useMemo(() => {
    if (!overview?.cancelAtPeriodEnd) return null
    return `Your subscription will end on ${formatDate(overview.cancelAtDate)}.`
  }, [overview])

  async function openBillingPortal() {
    setIsOpeningPortal(true)
    const result = await startBillingPortal()
    setIsOpeningPortal(false)

    if (!result.success) {
      addToast('error', result.error.message, {
        label: 'Retry',
        onClick: () => {
          void openBillingPortal()
        },
      })
      return
    }

    window.location.assign(result.data.url)
  }

  async function requestCancellation() {
    setIsCancelling(true)
    const result = await cancelSubscription()
    setIsCancelling(false)

    if (!result.success) {
      addToast('error', result.error.message, {
        label: 'Retry',
        onClick: () => {
          void requestCancellation()
        },
      })
      return
    }

    setConfirmCancel(false)
    addToast('warning', `Cancellation scheduled. Access continues until ${formatDate(result.data.cancelAt)}.`)
    await loadOverview()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">Billing & subscription</h1>
        <p className="mt-3 text-sm text-neutral-600">
          Review your current plan, update billing details, or schedule cancellation at period end.
        </p>

        {isLoading ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : (
          <div className="mt-6 rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-800">
            <p><span className="font-medium">Plan:</span> {overview?.planName ?? 'N/A'}</p>
            <p className="mt-2"><span className="font-medium">Billing period:</span> {overview?.billingPeriod ?? 'N/A'}</p>
            <p className="mt-2"><span className="font-medium">Next renewal:</span> {formatDate(overview?.nextRenewalDate ?? null)}</p>
            <p className="mt-2"><span className="font-medium">Last payment status:</span> {overview?.lastPaymentStatus ?? 'N/A'}</p>
          </div>
        )}

        {overview?.isBillingUnavailable ? (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Live Stripe billing details are temporarily unavailable. Your access remains active.
          </p>
        ) : null}

        {cancellationText ? (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {cancellationText}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Back to dashboard
          </Link>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 px-4"
            disabled={isOpeningPortal || isLoading}
            onClick={() => {
              void openBillingPortal()
            }}
          >
            {isOpeningPortal ? 'Opening portal…' : 'Update billing details'}
          </Button>
          <Button
            type="button"
            className="min-h-11 bg-red-600 px-4 hover:bg-red-700"
            disabled={isCancelling || isLoading || Boolean(overview?.cancelAtPeriodEnd)}
            onClick={() => {
              setConfirmCancel(true)
            }}
          >
            Cancel subscription
          </Button>
        </div>

        {confirmCancel ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <p>Cancel subscription at period end? You will keep access until the end of the current billing period.</p>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700"
                disabled={isCancelling}
                onClick={() => {
                  void requestCancellation()
                }}
              >
                {isCancelling ? 'Scheduling cancellation…' : 'Yes, cancel at period end'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isCancelling}
                onClick={() => {
                  setConfirmCancel(false)
                }}
              >
                Keep subscription
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}

