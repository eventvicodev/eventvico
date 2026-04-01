import {
  getAdjacentPipelineStage,
  isPipelineStage,
  pipelineStageOrder,
} from '@/lib/clients/pipeline'

describe('pipeline helpers', () => {
  it('exposes all stages in expected order', () => {
    expect(pipelineStageOrder).toEqual([
      'lead',
      'qualified',
      'proposal_sent',
      'revision',
      'booked',
      'in_fulfillment',
      'completed',
    ])
  })

  it('validates stage values', () => {
    expect(isPipelineStage('lead')).toBe(true)
    expect(isPipelineStage('invalid_stage')).toBe(false)
  })

  it('returns adjacent stages', () => {
    expect(getAdjacentPipelineStage('qualified', 'previous')).toBe('lead')
    expect(getAdjacentPipelineStage('qualified', 'next')).toBe('proposal_sent')
    expect(getAdjacentPipelineStage('lead', 'previous')).toBeNull()
    expect(getAdjacentPipelineStage('completed', 'next')).toBeNull()
  })
})

