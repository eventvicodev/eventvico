'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/toast'

export function BillingStatusToast() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { addToast } = useToast()

  useEffect(() => {
    const billing = searchParams.get('billing')
    if (billing !== 'success') return

    addToast('success', 'Subscription activated successfully.')

    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('billing')
    const nextQuery = nextParams.toString()

    router.replace(nextQuery ? `/dashboard?${nextQuery}` : '/dashboard')
  }, [addToast, router, searchParams])

  return null
}

