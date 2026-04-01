'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import {
  exportEventsIcal,
  fetchEventFormOptions,
  fetchWeekEvents,
  upsertEvent,
} from '@/lib/actions/events'

type EventRow = {
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

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 16)
}

function weekDays(weekStartIso: string) {
  const start = new Date(weekStartIso)
  return Array.from({ length: 7 }).map((_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

export default function EventsPage() {
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [weekStart, setWeekStart] = useState<string>(() => new Date().toISOString())
  const [events, setEvents] = useState<EventRow[]>([])
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [recipes, setRecipes] = useState<Array<{ id: string; name: string }>>([])

  const [name, setName] = useState('')
  const [startAt, setStartAt] = useState(toDateInputValue(new Date()))
  const [endAt, setEndAt] = useState(toDateInputValue(new Date(Date.now() + 60 * 60 * 1000)))
  const [venue, setVenue] = useState('')
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState('scheduled')
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<string[]>([])

  const load = async (nextWeekStart?: string) => {
    const weekValue = nextWeekStart ?? weekStart
    setIsLoading(true)

    const [snapshot, formOptions] = await Promise.all([
      fetchWeekEvents({ weekStart: weekValue }),
      fetchEventFormOptions(),
    ])

    setIsLoading(false)

    if (!snapshot.success) {
      addToast('error', snapshot.error.message)
      return
    }

    if (!formOptions.success) {
      addToast('error', formOptions.error.message)
      return
    }

    setWeekStart(snapshot.data.weekStart)
    setEvents(snapshot.data.events)
    setClients(formOptions.data.clients)
    setRecipes(formOptions.data.recipes)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groupedByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>()
    for (const event of events) {
      const key = new Date(event.startAt).toDateString()
      const existing = map.get(key) ?? []
      existing.push(event)
      map.set(key, existing)
    }
    return map
  }, [events])

  const saveEvent = async () => {
    const result = await upsertEvent({
      name,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      venue,
      clientId: clientId || null,
      status,
      recipeIds: selectedRecipeIds,
    })

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', 'Event saved')
    setName('')
    setVenue('')
    setClientId('')
    setSelectedRecipeIds([])
    await load()
  }

  const exportIcal = async () => {
    const result = await exportEventsIcal({ eventIds: events.map((event) => event.id) })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    const blob = new Blob([result.data.content], { type: 'text/calendar' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = result.data.filename
    anchor.click()
    URL.revokeObjectURL(href)
    addToast('success', '.ics export ready')
  }

  const days = weekDays(weekStart)

  return (
    <main className="flex-1 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Events</h1>
          <p className="mt-1 text-sm text-neutral-600">Create events, view your week calendar, and track fulfillment.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => { void exportIcal() }}>Export iCal</Button>
          <Link href="/pipeline" className="inline-flex h-11 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
            View pipeline
          </Link>
        </div>
      </div>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">New Event</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input
            type="text"
            placeholder="Event name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 px-3 text-sm"
          />
          <select
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">Select client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(event) => {
              setStartAt(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 px-3 text-sm"
          />
          <input
            type="datetime-local"
            value={endAt}
            onChange={(event) => {
              setEndAt(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 px-3 text-sm"
          />
          <input
            type="text"
            placeholder="Venue"
            value={venue}
            onChange={(event) => {
              setVenue(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 px-3 text-sm"
          />
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="mt-3 rounded-md border border-neutral-300 p-3">
          <p className="text-xs font-medium text-neutral-700">Linked recipes</p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {recipes.map((recipe) => (
              <label key={recipe.id} className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={selectedRecipeIds.includes(recipe.id)}
                  onChange={(event) => {
                    setSelectedRecipeIds((current) => (
                      event.target.checked
                        ? [...current, recipe.id]
                        : current.filter((id) => id !== recipe.id)
                    ))
                  }}
                />
                {recipe.name}
              </label>
            ))}
          </div>
        </div>

        <Button type="button" className="mt-3" onClick={() => { void saveEvent() }}>
          Save event
        </Button>
      </section>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">Week Calendar</h2>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const previous = new Date(weekStart)
                previous.setDate(previous.getDate() - 7)
                void load(previous.toISOString())
              }}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = new Date(weekStart)
                next.setDate(next.getDate() + 7)
                void load(next.toISOString())
              }}
            >
              Next
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-7">
            {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-40" />)}
          </div>
        ) : events.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-600">
            Schedule your first event — link a client and recipes to get started.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-7">
            {days.map((day) => {
              const key = day.toDateString()
              const rows = groupedByDay.get(key) ?? []
              const isToday = day.toDateString() === new Date().toDateString()

              return (
                <div key={key} className={[
                  'min-h-40 rounded-md border p-2',
                  isToday ? 'border-brand-500 bg-brand-50' : 'border-neutral-300 bg-neutral-50',
                ].join(' ')}>
                  <p className="text-xs font-semibold text-neutral-700">{day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                  <div className="mt-2 space-y-2">
                    {rows.map((event) => (
                      <Link
                        key={event.id}
                        href={`/events/${event.id}`}
                        className="block rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700"
                      >
                        <p className="font-medium">{event.name}</p>
                        <p>{new Date(event.startAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                        <p>{event.fulfillmentComplete ? 'Fulfillment Complete' : event.status}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
