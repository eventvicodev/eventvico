'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { confirmAIDraftRecipe } from '@/lib/actions/recipes'

type DraftIngredient = {
  name: string
  unit: string
  stemCount: number
  quantity: number
  estimatedCost: number
  confidence: number
  unavailable: boolean
}

const stages = ['Uploading', 'Detecting Flowers', 'Identifying Species', 'Building Draft'] as const

function confidenceBadge(item: DraftIngredient) {
  if (item.unavailable) return 'Unavailable'
  if (item.confidence >= 0.85) return ''
  if (item.confidence >= 0.6) return 'Review'
  return 'Confirm'
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

export default function RecipeAIAssistPage() {
  const supabase = useMemo(() => createClient(), [])
  const { addToast } = useToast()
  const [styleNotes, setStyleNotes] = useState('')
  const [budgetTarget, setBudgetTarget] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [imageName, setImageName] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [stageIndex, setStageIndex] = useState(0)
  const [status, setStatus] = useState<'idle' | 'pending' | 'processing' | 'completed' | 'failed'>('idle')
  const [timedOut, setTimedOut] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([])
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmedRecipeId, setConfirmedRecipeId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [estimatedTotal, setEstimatedTotal] = useState<number | null>(null)
  const [recommendedMinimumBudget, setRecommendedMinimumBudget] = useState<number | null>(null)
  const [budgetTooLow, setBudgetTooLow] = useState(false)

  const progressPercent = status === 'completed'
    ? 100
    : Math.min(95, Math.round(((stageIndex + 1) / stages.length) * 100))

  const total = useMemo(
    () => ingredients.reduce((sum, item) => sum + item.estimatedCost * item.quantity, 0),
    [ingredients]
  )

  const fetchStatus = async (currentJobId: string) => {
    const response = await fetch(`/api/ai/status/${currentJobId}`)
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? 'Could not load AI generation status.')
    }

    const nextStageIndex = Number(payload.data.stageIndex ?? 0)
    setStageIndex(nextStageIndex)
    setAnnouncement(`AI generation stage: ${payload.data.stage}`)
    setTimedOut(Boolean(payload.data.timedOut))
    setErrorMessage(payload.data.errorMessage ?? null)

    if (payload.data.status === 'completed') {
      setStatus('completed')
      setIngredients((payload.data.result?.ingredients ?? []) as DraftIngredient[])
      setEstimatedTotal(
        typeof payload.data.result?.estimatedTotal === 'number'
          ? payload.data.result.estimatedTotal
          : null
      )
      setRecommendedMinimumBudget(
        typeof payload.data.result?.recommendedMinimumBudget === 'number'
          ? payload.data.result.recommendedMinimumBudget
          : null
      )
      setBudgetTooLow(Boolean(payload.data.result?.budgetTooLow))
      setConfirmedRecipeId(null)
      addToast('success', `Draft generated — ${payload.data.itemCount ?? 0} ingredients identified`)
      return
    }

    if (payload.data.status === 'failed') {
      setStatus('failed')
      setErrorMessage(payload.data.errorMessage ?? 'Generation failed. You can retry or create manually.')
      return
    }

    setStatus(payload.data.status === 'pending' ? 'pending' : 'processing')
  }

  const startGeneration = async () => {
    setIsSubmitting(true)
    setErrorMessage(null)
    setTimedOut(false)
    setStatus('pending')
    setStageIndex(0)
    setIngredients([])
    setEstimatedTotal(null)
    setBudgetTooLow(false)
    setRecommendedMinimumBudget(null)

    const response = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        imageDataUrl: imageDataUrl || undefined,
        styleNotes: styleNotes || undefined,
        budgetTarget: budgetTarget ? Number(budgetTarget) : undefined,
      }),
    })

    const payload = await response.json()
    setIsSubmitting(false)

    if (!response.ok) {
      setStatus('failed')
      setErrorMessage(payload?.error?.message ?? 'Could not start AI generation.')
      return
    }

    setJobId(payload.data.jobId)
    setTenantId(payload.data.tenantId)
  }

  useEffect(() => {
    if (!jobId) return

    const timer = setInterval(() => {
      void fetchStatus(jobId).catch(() => {
        setStatus('failed')
        setErrorMessage('Could not check AI job progress. Retry or create recipe manually.')
      })
    }, 2_000)

    return () => {
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  useEffect(() => {
    if (!tenantId || !jobId) return
    const channel = supabase
      .channel(`ai-jobs-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_jobs',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const nextJob = payload.new as { id?: string } | null
          if (nextJob?.id === jobId) {
            void fetchStatus(jobId)
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, tenantId, jobId])

  const onImageSelected = async (file: File | null) => {
    if (!file) {
      setImageDataUrl('')
      setImageName('')
      return
    }

    setImageName(file.name)
    const reader = new FileReader()
    await new Promise<void>((resolve, reject) => {
      reader.onload = () => {
        setImageDataUrl(typeof reader.result === 'string' ? reader.result : '')
        resolve()
      }
      reader.onerror = () => reject(new Error('Could not read image file'))
      reader.readAsDataURL(file)
    }).catch(() => {
      setImageDataUrl('')
      setImageName('')
      setErrorMessage('Could not read selected image. Please try again.')
    })
  }

  const updateIngredient = (index: number, patch: Partial<DraftIngredient>) => {
    setIngredients((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    )
  }

  const confirmDraftRecipe = async () => {
    setIsConfirming(true)
    const result = await confirmAIDraftRecipe({
      recipeName: `AI Draft ${new Date().toLocaleDateString('en-US')}`,
      items: ingredients.map((item) => ({
        name: item.name,
        stemCount: item.stemCount,
        quantity: item.quantity,
      })),
    })
    setIsConfirming(false)

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    setConfirmedRecipeId(result.data.recipeId)
    addToast('success', 'Draft confirmed and saved')
  }

  return (
    <main className="flex-1 p-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">AI Recipe Assist</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Upload an inspiration image to generate a draft recipe with AI-detected flower species and stem counts.
        </p>

        <div className="mt-4">
          <label className="text-xs font-medium text-neutral-700">
            Inspiration image
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                void onImageSelected(file)
              }}
              className="mt-1 block h-11 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
            />
            {imageName ? <span className="mt-1 block text-xs text-neutral-500">{imageName}</span> : null}
          </label>
        </div>

        <label className="mt-3 block text-xs font-medium text-neutral-700">
          Style notes (optional)
          <textarea
            value={styleNotes}
            onChange={(event) => {
              setStyleNotes(event.target.value)
            }}
            rows={3}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="Romantic garden, soft pastel, elevated tablescape..."
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-neutral-700">
          Budget target (optional)
          <input
            type="number"
            min={1}
            step={1}
            value={budgetTarget}
            onChange={(event) => {
              setBudgetTarget(event.target.value)
            }}
            className="mt-1 h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
            placeholder="500"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => { void startGeneration() }} disabled={isSubmitting}>
            {isSubmitting ? 'Starting...' : 'Generate draft recipe'}
          </Button>
          <Link
            href="/recipes"
            className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Create recipe manually
          </Link>
        </div>

        {(status === 'pending' || status === 'processing' || status === 'completed' || timedOut) ? (
          <section className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <h2 className="text-sm font-semibold text-neutral-900">AI Generation Progress</h2>
            <p aria-live="polite" className="sr-only">{announcement}</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>

            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {stages.map((stage, index) => {
                const isDone = index < stageIndex || status === 'completed'
                const isActive = index === stageIndex && status !== 'completed'
                return (
                  <li key={stage} className="flex items-center gap-2 text-sm text-neutral-700">
                    <span
                      className={[
                        'inline-flex h-2.5 w-2.5 rounded-full',
                        isDone ? 'bg-emerald-500' : '',
                        isActive ? 'bg-brand-500 animate-pulse' : '',
                        !isDone && !isActive ? 'bg-neutral-300' : '',
                      ].join(' ')}
                    />
                    <span>{stage}</span>
                  </li>
                )
              })}
            </ul>

            {timedOut ? (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                AI generation is taking longer than expected. Progress is still active.
              </p>
            ) : null}
          </section>
        ) : null}

        {errorMessage ? (
          <section className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <p>{errorMessage}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => { void startGeneration() }}>
                Retry
              </Button>
              <Link
                href="/recipes"
                className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Create recipe manually
              </Link>
            </div>
          </section>
        ) : null}

        {status === 'completed' && ingredients.length > 0 ? (
          <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-neutral-900">Draft Ingredients</h2>
              <span className="text-sm font-medium text-neutral-900">{formatMoney(estimatedTotal ?? total)}</span>
            </div>
            {budgetTarget ? (
              <p className="mt-1 text-xs text-neutral-600">
                Est. {formatMoney(estimatedTotal ?? total)} / {formatMoney(Number(budgetTarget))} budget
              </p>
            ) : null}
            <p className="mt-1 text-xs text-neutral-600">
              This is your starting draft. Review and refine any item in the recipe builder.
            </p>

            <ul className="mt-3 space-y-2">
              {ingredients.map((item, index) => {
                const badge = confidenceBadge(item)
                return (
                  <li key={`${item.name}-${index}`} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-neutral-900">
                          {item.unavailable ? '⚠ ' : ''}{item.name}
                        </p>
                        <p className="text-xs text-neutral-600">
                          {item.stemCount > 0 ? `${item.stemCount} stems · ` : ''}{item.quantity} {item.unit} · {formatMoney(item.estimatedCost)} each
                        </p>
                      </div>
                      {badge ? (
                        <span className={[
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          badge === 'Review' ? 'bg-amber-100 text-amber-800' : '',
                          badge === 'Confirm' ? 'bg-red-100 text-red-800' : '',
                          badge === 'Unavailable' ? 'bg-neutral-200 text-neutral-700' : '',
                        ].join(' ')}>
                          {badge}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <label className="text-xs text-neutral-600">
                        Item name
                        <input
                          value={item.name}
                          onChange={(event) => {
                            updateIngredient(index, { name: event.target.value })
                          }}
                          className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-neutral-600">
                        Stem count
                        <input
                          type="number"
                          min={0}
                          value={item.stemCount}
                          onChange={(event) => {
                            updateIngredient(index, { stemCount: Math.max(0, Number(event.target.value)) })
                          }}
                          className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-neutral-600">
                        Quantity
                        <input
                          type="number"
                          min={0.01}
                          step={0.01}
                          value={item.quantity}
                          onChange={(event) => {
                            updateIngredient(index, { quantity: Math.max(0.01, Number(event.target.value)) })
                          }}
                          className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                        />
                      </label>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => { void confirmDraftRecipe() }} disabled={isConfirming}>
                {isConfirming ? 'Confirming...' : 'Confirm Recipe'}
              </Button>
              {confirmedRecipeId ? (
                <Link
                  href="/recipes"
                  className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  Open recipe builder
                </Link>
              ) : null}
            </div>
            {confirmedRecipeId ? (
              <p className="mt-2 text-xs text-emerald-700">
                Draft confirmed and saved. Recipe ID: {confirmedRecipeId}
              </p>
            ) : null}
          </section>
        ) : null}

        {status === 'completed' && budgetTooLow ? (
          <section className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Budget too low for available items — consider increasing to {formatMoney(recommendedMinimumBudget ?? 0)} for a minimum arrangement.
            <div className="mt-2">
              <Link
                href="/recipes"
                className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Create recipe manually
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
