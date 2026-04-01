'use client'

import { useMemo, useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { updateClientPipelineStage } from '@/lib/actions/clients'
import {
  getAdjacentPipelineStage,
  pipelineStageLabels,
  pipelineStageOrder,
} from '@/lib/clients/pipeline'
import type { PipelineStage } from '@/types/app'

type PipelineClient = {
  id: string
  name: string
  eventDate: string | null
  budget: number | null
  stage: PipelineStage
}

type Props = {
  initialClients: PipelineClient[]
}

function formatBudget(value: number | null) {
  if (value === null) return 'Budget TBD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function PipelineBoard({ initialClients }: Props) {
  const { addToast } = useToast()
  const [clients, setClients] = useState<PipelineClient[]>(initialClients)
  const [draggingClientId, setDraggingClientId] = useState<string | null>(null)
  const [liveMessage, setLiveMessage] = useState('')
  const [touchStartXById, setTouchStartXById] = useState<Record<string, number>>({})

  const grouped = useMemo(() => {
    return pipelineStageOrder.reduce<Record<PipelineStage, PipelineClient[]>>((acc, stage) => {
      acc[stage] = clients.filter((client) => client.stage === stage)
      return acc
    }, {} as Record<PipelineStage, PipelineClient[]>)
  }, [clients])

  const applyOptimisticStage = (clientId: string, stage: PipelineStage) => {
    setClients((current) =>
      current.map((client) => (client.id === clientId ? { ...client, stage } : client))
    )
  }

  const commitStageChange = async (clientId: string, nextStage: PipelineStage, previousStage: PipelineStage) => {
    applyOptimisticStage(clientId, nextStage)
    setLiveMessage(`Moved client to ${pipelineStageLabels[nextStage]}`)

    const result = await updateClientPipelineStage({
      clientId,
      stage: nextStage,
    })

    if (!result.success) {
      applyOptimisticStage(clientId, previousStage)
      setLiveMessage(`Update failed. Reverted to ${pipelineStageLabels[previousStage]}`)
      addToast('error', 'Update failed — changes reverted')
    }
  }

  return (
    <main className="flex-1 p-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Pipeline</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Track every client from lead through fulfillment.
      </p>

      <p className="sr-only" aria-live="polite">{liveMessage}</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {pipelineStageOrder.map((stage) => {
          const stageClients = grouped[stage]

          return (
            <section
              key={stage}
              aria-label={`${pipelineStageLabels[stage]} column`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggingClientId) return
                const current = clients.find((client) => client.id === draggingClientId)
                if (!current || current.stage === stage) return
                void commitStageChange(current.id, stage, current.stage)
                setDraggingClientId(null)
              }}
              className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <header className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-800">{pipelineStageLabels[stage]}</h2>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">{stageClients.length}</span>
              </header>

              <div className="mt-4 space-y-3">
                {stageClients.length === 0 ? (
                  <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-600">
                    No clients here yet. Move a client into this stage to keep your pipeline current.
                  </p>
                ) : null}

                {stageClients.map((client) => (
                  <article
                    key={client.id}
                    draggable
                    tabIndex={0}
                    onDragStart={() => {
                      setDraggingClientId(client.id)
                    }}
                    onTouchStart={(event) => {
                      const point = event.touches[0]
                      setTouchStartXById((current) => ({ ...current, [client.id]: point.clientX }))
                    }}
                    onTouchEnd={(event) => {
                      const startX = touchStartXById[client.id]
                      if (typeof startX !== 'number') return
                      const endX = event.changedTouches[0].clientX
                      const delta = endX - startX
                      const direction = delta > 40 ? 'previous' : delta < -40 ? 'next' : null
                      if (!direction) return
                      const nextStage = getAdjacentPipelineStage(client.stage, direction)
                      if (!nextStage) return
                      void commitStageChange(client.id, nextStage, client.stage)
                    }}
                    onKeyDown={(event) => {
                      const direction =
                        event.key === 'ArrowLeft'
                          ? 'previous'
                          : event.key === 'ArrowRight'
                            ? 'next'
                            : null
                      if (!direction) return
                      const nextStage = getAdjacentPipelineStage(client.stage, direction)
                      if (!nextStage) return
                      event.preventDefault()
                      void commitStageChange(client.id, nextStage, client.stage)
                    }}
                    className="rounded-md border border-neutral-200 bg-neutral-50 p-3 outline-none transition hover:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <p className="text-sm font-medium text-neutral-900">{client.name}</p>
                    <p className="mt-1 text-xs text-neutral-600">
                      {client.eventDate ?? 'No event date'} · {formatBudget(client.budget)}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}

