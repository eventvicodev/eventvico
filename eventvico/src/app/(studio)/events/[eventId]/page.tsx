'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { fetchEventDetail, updateFulfillmentStatus } from '@/lib/actions/events'

type EventDetail = {
  event: {
    id: string
    name: string
    startAt: string
    endAt: string
    status: string
    venue: string | null
    clientId: string | null
    clientName: string | null
    linkedRecipeCount: number
    fulfillmentComplete: boolean
  }
  linkedRecipes: Array<{ id: string; name: string }>
  fulfillmentItems: Array<{ id: string; arrangementName: string; itemName: string; status: 'unprepared' | 'prepared' | 'packed' | 'delivered' }>
}

const statuses = ['unprepared', 'prepared', 'packed', 'delivered'] as const

export default function EventDetailPage({ params }: { params: { eventId: string } }) {
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [detail, setDetail] = useState<EventDetail | null>(null)

  const groupedChecklist = useMemo(() => {
    const map = new Map<string, Array<{ id: string; itemName: string; status: 'unprepared' | 'prepared' | 'packed' | 'delivered' }>>()
    for (const item of detail?.fulfillmentItems ?? []) {
      const existing = map.get(item.arrangementName) ?? []
      existing.push({ id: item.id, itemName: item.itemName, status: item.status })
      map.set(item.arrangementName, existing)
    }
    return map
  }, [detail?.fulfillmentItems])

  const load = async () => {
    setIsLoading(true)
    const result = await fetchEventDetail({ eventId: params.eventId })
    setIsLoading(false)

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    setDetail(result.data)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.eventId])

  const cycleStatus = async (
    itemId: string,
    current: 'unprepared' | 'prepared' | 'packed' | 'delivered'
  ) => {
    const currentIndex = statuses.indexOf(current)
    const next = statuses[(currentIndex + 1) % statuses.length]

    setDetail((existing) => {
      if (!existing) return existing
      return {
        ...existing,
        fulfillmentItems: existing.fulfillmentItems.map((item) => (
          item.id === itemId
            ? { ...item, status: next }
            : item
        )),
      }
    })

    const result = await updateFulfillmentStatus({ itemId, status: next })
    if (!result.success) {
      addToast('error', 'Update failed — changes reverted')
      await load()
      return
    }

    if (result.data.allDelivered) {
      addToast('success', 'Fulfillment complete')
    }
  }

  if (isLoading || !detail) {
    return (
      <main className="flex-1 p-6">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="mt-4 h-28 w-full" />
        <Skeleton className="mt-4 h-28 w-full" />
      </main>
    )
  }

  return (
    <main className="flex-1 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{detail.event.name}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {new Date(detail.event.startAt).toLocaleString()} · {detail.event.venue ?? 'Venue TBD'} · {detail.event.clientName ?? 'No client'}
          </p>
        </div>
        <Link href="/events" className="inline-flex h-11 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
          Back to events
        </Link>
      </div>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Linked Recipes</h2>
        {detail.linkedRecipes.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            No arrangements linked to this event yet — add recipes to generate the checklist.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-neutral-700">
            {detail.linkedRecipes.map((recipe) => <li key={recipe.id}>{recipe.name}</li>)}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Fulfillment Checklist</h2>
        {detail.event.fulfillmentComplete ? (
          <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Fulfillment Complete
          </p>
        ) : null}

        {detail.fulfillmentItems.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            No arrangements linked to this event yet — add recipes to generate the checklist.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {Array.from(groupedChecklist.entries()).map(([arrangement, items]) => (
              <div key={arrangement} className="rounded-md border border-neutral-200 p-3">
                <h3 className="text-sm font-medium text-neutral-900">{arrangement}</h3>
                <ul className="mt-2 space-y-2">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                      <span>{item.itemName}</span>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => { void cycleStatus(item.id, item.status) }}
                      >
                        {item.status}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
