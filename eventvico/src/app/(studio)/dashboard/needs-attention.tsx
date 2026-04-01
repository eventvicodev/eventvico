'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { completeClientTaskActivity } from '@/lib/actions/clients'
import { useToast } from '@/components/ui/toast'

type Reminder = {
  activityId: string
  clientId: string
  clientName: string
  title: string
  dueAt: string
  isOverdue: boolean
}

type Props = {
  reminders: Reminder[]
}

function formatDueAt(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function NeedsAttention({ reminders }: Props) {
  const { addToast } = useToast()
  const [items, setItems] = useState(reminders)
  const [expanded, setExpanded] = useState(false)

  const hasItems = items.length > 0
  const needsCollapse = items.length >= 4
  const visibleItems = useMemo(
    () => (needsCollapse && !expanded ? items.slice(0, 3) : items),
    [expanded, items, needsCollapse]
  )

  if (!hasItems) return null

  const resolveReminder = async (activityId: string) => {
    const previous = items
    setItems((current) => current.filter((item) => item.activityId !== activityId))

    const result = await completeClientTaskActivity(activityId)
    if (!result.success) {
      setItems(previous)
      addToast('error', 'Update failed — changes reverted')
    }
  }

  return (
    <section
      aria-label="Needs attention reminders"
      className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <h2 className="text-sm font-semibold text-amber-900">Needs attention</h2>
      <ul className="mt-3 space-y-2">
        {visibleItems.map((item) => (
          <li key={item.activityId} className="rounded-md border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">{item.title}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  {item.clientName} · Due {formatDueAt(item.dueAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/clients/${item.clientId}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-2 text-xs font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                >
                  View
                </Link>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11 text-xs"
                  onClick={() => {
                    void resolveReminder(item.activityId)
                  }}
                >
                  Resolve
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {needsCollapse ? (
        <button
          type="button"
          className="mt-3 text-xs font-medium text-amber-900 underline underline-offset-2"
          onClick={() => {
            setExpanded((current) => !current)
          }}
        >
          {expanded ? 'Show less' : `Show all (${items.length})`}
        </button>
      ) : null}
    </section>
  )
}

