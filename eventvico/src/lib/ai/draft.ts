type DraftSource = {
  pinterestUrl?: string
  imageDataUrl?: string
  styleNotes?: string
  budgetTarget?: number
}

export type DraftIngredient = {
  name: string
  unit: string
  stemCount: number
  quantity: number
  estimatedCost: number
  confidence: number
  unavailable: boolean
}

export function buildDraftIngredients(source: DraftSource): DraftIngredient[] {
  const hints = `${source.pinterestUrl ?? ''} ${source.styleNotes ?? ''}`.toLowerCase()

  const hasRustic = hints.includes('rustic') || hints.includes('boho')
  const hasPastel = hints.includes('pastel') || hints.includes('garden')
  const hasLuxury = hints.includes('luxury') || hints.includes('modern')

  const base: DraftIngredient[] = [
    {
      name: hasPastel ? 'Garden Rose' : 'White Rose',
      unit: 'stems',
      stemCount: hasLuxury ? 35 : 24,
      quantity: 1,
      estimatedCost: hasLuxury ? 4.5 : 3.2,
      confidence: 0.91,
      unavailable: false,
    },
    {
      name: hasRustic ? 'Eucalyptus' : 'Ranunculus',
      unit: 'stems',
      stemCount: hasRustic ? 20 : 18,
      quantity: 1,
      estimatedCost: hasRustic ? 1.25 : 2.75,
      confidence: 0.78,
      unavailable: false,
    },
    {
      name: hasLuxury ? 'Orchid Stem' : 'Baby Breath',
      unit: 'stems',
      stemCount: hasLuxury ? 10 : 14,
      quantity: 1,
      estimatedCost: hasLuxury ? 8.0 : 1.1,
      confidence: hasLuxury ? 0.63 : 0.69,
      unavailable: false,
    },
    {
      name: 'Ceramic Bud Vase',
      unit: 'pieces',
      stemCount: 0,
      quantity: 6,
      estimatedCost: 3.5,
      confidence: source.imageDataUrl ? 0.57 : 0.61,
      unavailable: false,
    },
  ]

  return base
}

export function draftItemCount(source: DraftSource): number {
  return buildDraftIngredients(source).length
}

export function buildBudgetAwareDraft(source: DraftSource): {
  ingredients: DraftIngredient[]
  budgetTarget: number | null
  estimatedTotal: number
  budgetTooLow: boolean
  recommendedMinimumBudget: number
} {
  const baseIngredients = buildDraftIngredients(source)
  const baseTotal = baseIngredients.reduce((sum, item) => sum + item.estimatedCost * item.quantity, 0)
  const budgetTarget = Number(source.budgetTarget)
  const hasBudget = Number.isFinite(budgetTarget) && budgetTarget > 0
  const recommendedMinimumBudget = Math.max(120, Math.ceil(baseTotal * 0.7))

  if (!hasBudget) {
    return {
      ingredients: baseIngredients,
      budgetTarget: null,
      estimatedTotal: Number(baseTotal.toFixed(2)),
      budgetTooLow: false,
      recommendedMinimumBudget,
    }
  }

  if (budgetTarget < recommendedMinimumBudget) {
    return {
      ingredients: [],
      budgetTarget,
      estimatedTotal: 0,
      budgetTooLow: true,
      recommendedMinimumBudget,
    }
  }

  const ratio = Math.min(1.4, Math.max(0.55, budgetTarget / baseTotal))
  const scaledIngredients = baseIngredients.map((item) => {
    if (item.unit !== 'stems') return item
    return {
      ...item,
      stemCount: Math.max(4, Math.round(item.stemCount * ratio)),
      quantity: Math.max(1, Number((item.quantity * Math.min(1.2, ratio)).toFixed(2))),
    }
  })
  const estimatedTotal = scaledIngredients.reduce((sum, item) => sum + item.estimatedCost * item.quantity, 0)

  return {
    ingredients: scaledIngredients,
    budgetTarget,
    estimatedTotal: Number(estimatedTotal.toFixed(2)),
    budgetTooLow: false,
    recommendedMinimumBudget,
  }
}
