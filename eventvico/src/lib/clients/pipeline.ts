import type { PipelineStage } from '@/types/app'

export const pipelineStageOrder: PipelineStage[] = [
  'lead',
  'qualified',
  'proposal_sent',
  'revision',
  'booked',
  'in_fulfillment',
  'completed',
]

export const pipelineStageLabels: Record<PipelineStage, string> = {
  lead: 'Lead',
  qualified: 'Qualified',
  proposal_sent: 'Proposal Sent',
  revision: 'Revision',
  booked: 'Booked',
  in_fulfillment: 'In Fulfillment',
  completed: 'Completed',
}

export function isPipelineStage(value: string): value is PipelineStage {
  return pipelineStageOrder.includes(value as PipelineStage)
}

export function getAdjacentPipelineStage(stage: PipelineStage, direction: 'previous' | 'next'): PipelineStage | null {
  const index = pipelineStageOrder.indexOf(stage)
  if (index < 0) return null

  if (direction === 'previous') {
    return pipelineStageOrder[index - 1] ?? null
  }

  return pipelineStageOrder[index + 1] ?? null
}

