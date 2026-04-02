import { NextResponse } from 'next/server'
import { buildBudgetAwareDraft } from '@/lib/ai/draft'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Stage labels match the 3-stage hybrid pipeline (ADR-001):
//   Stage 1 — YOLO11m: detect flower regions (Detecting Flowers)
//   Stage 2 — Groq Llama 4 Scout vision: classify species per crop (Identifying Species)
//   Stage 3 — Groq Llama 4 Scout text: stem counts + recipe (Building Draft)
const STAGES = ['Uploading', 'Detecting Flowers', 'Identifying Species', 'Building Draft'] as const

function inferStageIndex(elapsedMs: number) {
  if (elapsedMs < 4_000) return 0
  if (elapsedMs < 10_000) return 1
  if (elapsedMs < 18_000) return 2
  return 3
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    return NextResponse.json(
      { error: { code: 'AUTH_REQUIRED', message: 'Please sign in again to continue.' } },
      { status: 401 }
    )
  }

  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.tenant_id) {
    return NextResponse.json(
      { error: { code: 'TENANT_NOT_FOUND', message: 'Could not find your studio account.' } },
      { status: 404 }
    )
  }

  const { data: job } = await supabase
    .from('ai_jobs')
    .select('id, status, source_payload, result_payload, error_message, created_at')
    .eq('id', jobId)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()

  if (!job?.id) {
    return NextResponse.json(
      { error: { code: 'AI_JOB_NOT_FOUND', message: 'Could not find AI generation job.' } },
      { status: 404 }
    )
  }

  const elapsedMs = Math.max(0, Date.now() - new Date(job.created_at).getTime())
  const timedOut = elapsedMs >= 60_000 && job.status !== 'completed'
  const stageIndex = job.status === 'completed'
    ? STAGES.length - 1
    : inferStageIndex(elapsedMs)

  if (job.status === 'pending' && elapsedMs >= 4_000) {
    await supabase
      .from('ai_jobs')
      .update({ status: 'processing' })
      .eq('id', job.id)
      .eq('tenant_id', profile.tenant_id)
  }

  if (job.status !== 'completed' && job.status !== 'failed' && elapsedMs >= 24_000 && !timedOut) {
    const sourcePayload = (job.source_payload ?? {}) as {
      imageDataUrl?: string
      styleNotes?: string
      budgetTarget?: number
    }
    const draft = buildBudgetAwareDraft(sourcePayload)

    const { data: completed } = await supabase
      .from('ai_jobs')
      .update({
        status: 'completed',
        result_payload: {
          ingredients: draft.ingredients,
          itemCount: draft.ingredients.length,
          estimatedTotal: draft.estimatedTotal,
          budgetTarget: draft.budgetTarget,
          budgetTooLow: draft.budgetTooLow,
          recommendedMinimumBudget: draft.recommendedMinimumBudget,
        },
      })
      .eq('id', job.id)
      .eq('tenant_id', profile.tenant_id)
      .select('status, result_payload')
      .single()

    return NextResponse.json({
      data: {
        jobId: job.id,
        status: completed?.status ?? 'completed',
        stage: STAGES[STAGES.length - 1],
        stageIndex: STAGES.length - 1,
        itemCount: (completed?.result_payload as { itemCount?: number } | null)?.itemCount ?? draft.ingredients.length,
        result: completed?.result_payload ?? {
          ingredients: draft.ingredients,
          itemCount: draft.ingredients.length,
          estimatedTotal: draft.estimatedTotal,
          budgetTarget: draft.budgetTarget,
          budgetTooLow: draft.budgetTooLow,
          recommendedMinimumBudget: draft.recommendedMinimumBudget,
        },
        timedOut: false,
      },
    })
  }

  return NextResponse.json({
    data: {
      jobId: job.id,
      status: timedOut ? 'processing' : job.status,
      stage: STAGES[stageIndex],
      stageIndex,
      itemCount: (job.result_payload as { itemCount?: number } | null)?.itemCount ?? null,
      result: job.result_payload,
      timedOut,
      errorMessage: job.error_message,
    },
  })
}
