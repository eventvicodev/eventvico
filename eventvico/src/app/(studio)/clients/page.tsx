'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { fetchClientsDirectory } from '@/lib/actions/clients'
import { pipelineStageLabels, pipelineStageOrder } from '@/lib/clients/pipeline'

type ClientItem = {
  id: string
  name: string
  eventDate: string | null
  stage: (typeof pipelineStageOrder)[number]
  status: 'upcoming' | 'past' | 'unscheduled'
}

function getInputClass() {
  return [
    'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900',
    'placeholder:text-neutral-400',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
  ].join(' ')
}

function formatEventDate(value: string | null) {
  if (!value) return 'No event date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

function statusLabel(status: ClientItem['status']) {
  if (status === 'past') return 'Past'
  if (status === 'unscheduled') return 'Unscheduled'
  return 'Upcoming'
}

export default function ClientsIndexPage() {
  const { addToast } = useToast()
  const [clients, setClients] = useState<ClientItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [stage, setStage] = useState('')
  const [status, setStatus] = useState('')
  const [eventDateFrom, setEventDateFrom] = useState('')
  const [eventDateTo, setEventDateTo] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim())
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      const result = await fetchClientsDirectory({
        search: debouncedSearch,
        stage,
        status,
        eventDateFrom,
        eventDateTo,
      })
      setIsLoading(false)

      if (!result.success) {
        setClients([])
        addToast('error', result.error.message)
        return
      }
      setClients(result.data.clients)
    }

    void load()
  }, [addToast, debouncedSearch, eventDateFrom, eventDateTo, stage, status])

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = []
    if (debouncedSearch) chips.push({ key: 'search', label: `Search: ${debouncedSearch}` })
    if (stage) chips.push({ key: 'stage', label: `Stage: ${pipelineStageLabels[stage as (typeof pipelineStageOrder)[number]]}` })
    if (status) chips.push({ key: 'status', label: `Status: ${statusLabel(status as ClientItem['status'])}` })
    if (eventDateFrom) chips.push({ key: 'eventDateFrom', label: `From: ${eventDateFrom}` })
    if (eventDateTo) chips.push({ key: 'eventDateTo', label: `To: ${eventDateTo}` })
    return chips
  }, [debouncedSearch, eventDateFrom, eventDateTo, stage, status])

  const hasActiveFilters = activeFilters.length > 0

  const clearAllFilters = () => {
    setSearchInput('')
    setDebouncedSearch('')
    setStage('')
    setStatus('')
    setEventDateFrom('')
    setEventDateTo('')
  }

  const clearOneFilter = (key: string) => {
    if (key === 'search') setSearchInput('')
    if (key === 'stage') setStage('')
    if (key === 'status') setStatus('')
    if (key === 'eventDateFrom') setEventDateFrom('')
    if (key === 'eventDateTo') setEventDateTo('')
  }

  return (
    <main className="flex-1 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Clients</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Search and filter your pipeline by name, date, stage, and status.
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex min-h-11 items-center rounded-md border border-brand-500 bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Add client
        </Link>
      </div>

      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-5">
          <input
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value)
            }}
            placeholder="Search by client name"
            className={`${getInputClass()} lg:col-span-2`}
            aria-label="Search clients"
          />

          <select
            value={stage}
            onChange={(event) => {
              setStage(event.target.value)
            }}
            className={getInputClass()}
            aria-label="Filter by stage"
          >
            <option value="">All stages</option>
            {pipelineStageOrder.map((pipelineStage) => (
              <option key={pipelineStage} value={pipelineStage}>
                {pipelineStageLabels[pipelineStage]}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
            }}
            className={getInputClass()}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="unscheduled">Unscheduled</option>
          </select>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              value={eventDateFrom}
              onChange={(event) => {
                setEventDateFrom(event.target.value)
              }}
              className={getInputClass()}
              aria-label="Filter event date from"
            />
            <input
              type="date"
              value={eventDateTo}
              onChange={(event) => {
                setEventDateTo(event.target.value)
              }}
              className={getInputClass()}
              aria-label="Filter event date to"
            />
          </div>
        </div>

        {hasActiveFilters ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeFilters.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => {
                  clearOneFilter(chip.key)
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-neutral-300 bg-neutral-100 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                {chip.label} x
              </button>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={clearAllFilters}>
              Clear all
            </Button>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : clients.length === 0 ? (
          hasActiveFilters ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-4">
              <p className="text-sm text-neutral-600">
                No clients match your search — try adjusting your filters
              </p>
              <Button type="button" variant="secondary" className="mt-3 min-h-11" onClick={clearAllFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-neutral-300 p-4">
              <p className="text-sm text-neutral-600">
                Add your first client to start building your pipeline
              </p>
              <Link
                href="/clients/new"
                className="mt-3 inline-flex min-h-11 items-center rounded-md border border-brand-500 bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Add client
              </Link>
            </div>
          )
        ) : (
          <ul className="space-y-2">
            {clients.map((client) => (
              <li key={client.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{client.name}</p>
                    <p className="mt-1 text-xs text-neutral-600">
                      {formatEventDate(client.eventDate)} · {pipelineStageLabels[client.stage]} · {statusLabel(client.status)}
                    </p>
                  </div>
                  <Link
                    href={`/clients/${client.id}`}
                    className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                  >
                    View
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
