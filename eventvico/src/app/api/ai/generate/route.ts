import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { registerUploadedImageAsset } from '@/lib/actions/compliance'

type GenerateRequestBody = {
  imageDataUrl?: string
  styleNotes?: string
  budgetTarget?: number
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as GenerateRequestBody | null
  const imageDataUrl = body?.imageDataUrl?.trim() ?? ''
  const styleNotes = body?.styleNotes?.trim() ?? ''
  const budgetTarget = Number(body?.budgetTarget)

  if (!imageDataUrl) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Upload an inspiration image to generate a draft recipe.',
          fields: {
            source: ['An image upload is required'],
          },
        },
      },
      { status: 400 }
    )
  }

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

  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({
      tenant_id: profile.tenant_id,
      created_by: user.id,
      source_type: 'image',
      source_payload: {
        imageDataUrl,
        styleNotes: styleNotes || null,
        budgetTarget: Number.isFinite(budgetTarget) && budgetTarget > 0 ? budgetTarget : null,
      },
      status: 'pending',
    })
    .select('id, status, tenant_id, created_at')
    .single()

  if (error || !job?.id) {
    return NextResponse.json(
      { error: { code: 'AI_JOB_CREATE_FAILED', message: 'Could not start AI generation.' } },
      { status: 500 }
    )
  }

  await registerUploadedImageAsset({
    source: 'recipe_ai_reference',
    storagePath: `ai-jobs/${job.id}/reference-image`,
  })

  return NextResponse.json(
    {
      data: {
        jobId: job.id,
        status: job.status,
        tenantId: job.tenant_id,
        createdAt: job.created_at,
      },
    },
    { status: 202 }
  )
}
