import { buildBudgetAwareDraft } from '@/lib/ai/draft'

describe('buildBudgetAwareDraft', () => {
  it('returns guidance when budget is too low', () => {
    const result = buildBudgetAwareDraft({
      pinterestUrl: 'https://pinterest.com/board',
      budgetTarget: 40,
    })

    expect(result.budgetTooLow).toBe(true)
    expect(result.ingredients).toEqual([])
    expect(result.recommendedMinimumBudget).toBeGreaterThan(40)
  })

  it('scales ingredient plan to fit provided budget target', () => {
    const result = buildBudgetAwareDraft({
      styleNotes: 'modern luxury',
      budgetTarget: 500,
    })

    expect(result.budgetTooLow).toBe(false)
    expect(result.ingredients.length).toBeGreaterThan(0)
    expect(result.budgetTarget).toBe(500)
  })
})
