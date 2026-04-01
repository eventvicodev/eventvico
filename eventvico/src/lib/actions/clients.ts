'use server'

import { createClient } from '@/lib/supabase/server'
import { isPipelineStage, pipelineStageLabels, pipelineStageOrder } from '@/lib/clients/pipeline'
import { createClientActivitySchema, createClientSchema } from '@/lib/schemas/clients'
import type { ActionResult, PipelineStage } from '@/types/app'

type CreateClientSuccessData =
  | { redirectTo: string }
  | { status: 'duplicate'; existingClientId: string; message: string }

type CreateClientResult = ActionResult<CreateClientSuccessData>
type FetchPipelineClientsResult = ActionResult<{
  clients: Array<{
    id: string
    name: string
    eventDate: string | null
    budget: number | null
    stage: PipelineStage
  }>
}>
type ClientDirectoryStatus = 'upcoming' | 'past' | 'unscheduled'
type FetchClientsDirectoryResult = ActionResult<{
  clients: Array<{
    id: string
    name: string
    eventDate: string | null
    stage: PipelineStage
    status: ClientDirectoryStatus
  }>
}>
type UpdateClientPipelineStageResult = ActionResult<{
  clientId: string
  stage: PipelineStage
}>
type ClientActivity = {
  id: string
  clientId: string
  activityType: 'call' | 'meeting' | 'note' | 'task'
  summary: string
  note: string | null
  dueAt: string | null
  taskStatus: 'open' | 'completed'
  completedAt: string | null
  createdAt: string
  loggedBy: {
    id: string
    name: string
  }
}
type CreateClientActivityResult = ActionResult<{ activityId: string }>
type ListClientActivitiesResult = ActionResult<{ activities: ClientActivity[] }>
type CompleteClientActivityResult = ActionResult<{ activityId: string; taskStatus: 'open' | 'completed' }>
type ListFollowUpRemindersResult = ActionResult<{
  reminders: Array<{
    activityId: string
    clientId: string
    clientName: string
    title: string
    dueAt: string
    isOverdue: boolean
  }>
}>
type FetchDashboardOverviewResult = ActionResult<{
  pipelineSummary: Array<{
    stage: PipelineStage
    label: string
    count: number
  }>
  upcomingEvents: Array<{
    clientId: string
    clientName: string
    eventDate: string
    venue: string | null
    stage: PipelineStage
  }>
  pendingQuotes: {
    count: number
  }
}>

type TenantContextResult = ActionResult<{
  userId: string
  tenantId: string
}>

function mapZodFieldErrors(input: unknown): Record<string, string[]> | undefined {
  const parsed = createClientSchema.safeParse(input)
  if (parsed.success) return undefined

  const fields = parsed.error.flatten().fieldErrors
  const mapped: Record<string, string[]> = {}
  Object.entries(fields).forEach(([key, value]) => {
    if (value && value.length > 0) mapped[key] = value
  })
  return Object.keys(mapped).length > 0 ? mapped : undefined
}

function mapActivityZodFieldErrors(input: unknown): Record<string, string[]> | undefined {
  const parsed = createClientActivitySchema.safeParse(input)
  if (parsed.success) return undefined

  const fields = parsed.error.flatten().fieldErrors
  const mapped: Record<string, string[]> = {}
  Object.entries(fields).forEach(([key, value]) => {
    if (value && value.length > 0) mapped[key] = value
  })
  return Object.keys(mapped).length > 0 ? mapped : undefined
}

async function getTenantContext(): Promise<TenantContextResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    return {
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Please sign in again to continue.',
      },
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.tenant_id) {
    return {
      success: false,
      error: {
        code: 'TENANT_NOT_FOUND',
        message: 'Could not find your studio account.',
      },
    }
  }

  return {
    success: true,
    data: {
      userId: user.id,
      tenantId: profile.tenant_id,
    },
  }
}

export async function createStudioClient(input: unknown): Promise<CreateClientResult> {
  try {
    const parsed = createClientSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please correct the highlighted fields',
          fields: mapZodFieldErrors(input),
        },
      }
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      return {
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Please sign in again to continue.',
        },
      }
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.tenant_id) {
      return {
        success: false,
        error: {
          code: 'TENANT_NOT_FOUND',
          message: 'Could not find your studio account.',
        },
      }
    }

    const values = parsed.data
    const email = values.email?.trim().toLowerCase() || null
    const allowDuplicateEmail = values.allowDuplicateEmail === true

    if (email && !allowDuplicateEmail) {
      const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .eq('tenant_id', profile.tenant_id)
        .eq('email', email)
        .maybeSingle()

      if (existing?.id) {
        return {
          success: true,
          data: {
            status: 'duplicate',
            existingClientId: existing.id,
            message: 'A client with this email already exists',
          },
        }
      }
    }

    const guestCount = values.guestCount ? Number.parseInt(values.guestCount, 10) : null
    const budget = values.budget ? Number(values.budget) : null

    const { data: created, error: insertError } = await supabase
      .from('clients')
      .insert({
        tenant_id: profile.tenant_id,
        created_by: user.id,
        name: values.name.trim(),
        email,
        phone: values.phone?.trim() || null,
        event_date: values.eventDate || null,
        venue: values.venue?.trim() || null,
        guest_count: Number.isNaN(guestCount) ? null : guestCount,
        budget: Number.isNaN(budget) ? null : budget,
        pipeline_stage: 'lead',
      })
      .select('id')
      .single()

    if (insertError || !created?.id) {
      return {
        success: false,
        error: {
          code: 'CLIENT_CREATE_FAILED',
          message: 'Could not create client. Please try again.',
        },
      }
    }

    return {
      success: true,
      data: {
        redirectTo: `/clients/${created.id}`,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'CLIENT_CREATE_FAILED',
        message: 'Could not create client. Please try again.',
      },
    }
  }
}

export async function fetchPipelineClients(): Promise<FetchPipelineClientsResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, event_date, budget, pipeline_stage')
      .eq('tenant_id', context.data.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      return {
        success: false,
        error: {
          code: 'PIPELINE_FETCH_FAILED',
          message: 'Could not load pipeline data.',
        },
      }
    }

    const clients = (data ?? []).flatMap((item) => {
      if (!isPipelineStage(item.pipeline_stage)) return []
      return [{
        id: item.id,
        name: item.name,
        eventDate: item.event_date,
        budget: item.budget,
        stage: item.pipeline_stage,
      }]
    })

    return {
      success: true,
      data: {
        clients,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'PIPELINE_FETCH_FAILED',
        message: 'Could not load pipeline data.',
      },
    }
  }
}

export async function fetchClientsDirectory(input?: unknown): Promise<FetchClientsDirectoryResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const parsed = (input as {
      search?: string
      eventDateFrom?: string
      eventDateTo?: string
      stage?: string
      status?: string
    } | undefined) ?? {}

    const search = parsed.search?.trim().toLowerCase() ?? ''
    const eventDateFrom = parsed.eventDateFrom?.trim() ?? ''
    const eventDateTo = parsed.eventDateTo?.trim() ?? ''
    const stageFilter = parsed.stage?.trim()
    const statusFilter = parsed.status?.trim() as ClientDirectoryStatus | undefined

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, event_date, pipeline_stage, created_at')
      .eq('tenant_id', context.data.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      return {
        success: false,
        error: {
          code: 'CLIENT_DIRECTORY_FETCH_FAILED',
          message: 'Could not load clients.',
        },
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const clients = (data ?? []).flatMap((item) => {
      if (!isPipelineStage(item.pipeline_stage)) return []

      const eventDay = item.event_date?.slice(0, 10) ?? null
      const status: ClientDirectoryStatus =
        !eventDay ? 'unscheduled' : eventDay < today ? 'past' : 'upcoming'

      if (search && !item.name.toLowerCase().includes(search)) return []
      if (stageFilter && stageFilter !== item.pipeline_stage) return []
      if (statusFilter && statusFilter !== status) return []

      if (eventDateFrom || eventDateTo) {
        if (!eventDay) return []
        if (eventDateFrom && eventDay < eventDateFrom) return []
        if (eventDateTo && eventDay > eventDateTo) return []
      }

      return [{
        id: item.id,
        name: item.name,
        eventDate: item.event_date,
        stage: item.pipeline_stage,
        status,
      }]
    })

    return {
      success: true,
      data: {
        clients,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'CLIENT_DIRECTORY_FETCH_FAILED',
        message: 'Could not load clients.',
      },
    }
  }
}

export async function updateClientPipelineStage(input: unknown): Promise<UpdateClientPipelineStageResult> {
  try {
    const parsed = input as { clientId?: string; stage?: string } | undefined
    const clientId = parsed?.clientId?.trim() ?? ''
    const stage = parsed?.stage?.trim() ?? ''

    if (!clientId || !isPipelineStage(stage)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid pipeline stage update payload.',
          fields: {
            stage: ['Invalid stage selection'],
          },
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('clients')
      .update({ pipeline_stage: stage })
      .eq('id', clientId)
      .eq('tenant_id', context.data.tenantId)

    if (error) {
      return {
        success: false,
        error: {
          code: 'PIPELINE_UPDATE_FAILED',
          message: 'Could not update pipeline stage.',
        },
      }
    }

    return {
      success: true,
      data: {
        clientId,
        stage,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'PIPELINE_UPDATE_FAILED',
        message: 'Could not update pipeline stage.',
      },
    }
  }
}

export async function listClientActivities(clientId: string): Promise<ListClientActivitiesResult> {
  try {
    const normalizedClientId = clientId.trim()
    if (!normalizedClientId) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing client identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('client_activities')
      .select('id, client_id, activity_type, summary, note, due_at, task_status, completed_at, created_at, logged_by')
      .eq('tenant_id', context.data.tenantId)
      .eq('client_id', normalizedClientId)
      .order('created_at', { ascending: false })

    if (error) {
      return {
        success: false,
        error: {
          code: 'ACTIVITY_LIST_FAILED',
          message: 'Could not load activity timeline.',
        },
      }
    }

    const loggedByIds = Array.from(new Set((data ?? []).map((item) => item.logged_by)))
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', loggedByIds)

    const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name?.trim() || 'Studio user']))
    const activities: ClientActivity[] = (data ?? []).map((item) => ({
      id: item.id,
      clientId: item.client_id,
      activityType: item.activity_type,
      summary: item.summary,
      note: item.note,
      dueAt: item.due_at,
      taskStatus: item.task_status,
      completedAt: item.completed_at,
      createdAt: item.created_at,
      loggedBy: {
        id: item.logged_by,
        name: nameById.get(item.logged_by) ?? 'Studio user',
      },
    }))

    return {
      success: true,
      data: { activities },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'ACTIVITY_LIST_FAILED',
        message: 'Could not load activity timeline.',
      },
    }
  }
}

export async function createClientActivity(input: unknown): Promise<CreateClientActivityResult> {
  try {
    const parsed = createClientActivitySchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please correct the highlighted fields',
          fields: mapActivityZodFieldErrors(input),
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', parsed.data.clientId)
      .eq('tenant_id', context.data.tenantId)
      .maybeSingle()

    if (!client?.id) {
      return {
        success: false,
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: 'Could not find that client in your workspace.',
        },
      }
    }

    const { data: created, error } = await supabase
      .from('client_activities')
      .insert({
        tenant_id: context.data.tenantId,
        client_id: parsed.data.clientId,
        logged_by: context.data.userId,
        activity_type: parsed.data.activityType,
        summary: parsed.data.summary.trim(),
        note: parsed.data.note?.trim() || null,
        due_at: parsed.data.dueAt || null,
        task_status: 'open',
      })
      .select('id')
      .single()

    if (error || !created?.id) {
      return {
        success: false,
        error: {
          code: 'ACTIVITY_CREATE_FAILED',
          message: 'Could not log activity. Please try again.',
        },
      }
    }

    return {
      success: true,
      data: {
        activityId: created.id,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'ACTIVITY_CREATE_FAILED',
        message: 'Could not log activity. Please try again.',
      },
    }
  }
}

export async function completeClientTaskActivity(activityId: string): Promise<CompleteClientActivityResult> {
  try {
    const normalized = activityId.trim()
    if (!normalized) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing activity identifier.',
        },
      }
    }

    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const { data: updated, error } = await supabase
      .from('client_activities')
      .update({
        task_status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', normalized)
      .eq('tenant_id', context.data.tenantId)
      .eq('activity_type', 'task')
      .select('id, task_status')
      .single()

    if (error || !updated?.id) {
      return {
        success: false,
        error: {
          code: 'ACTIVITY_COMPLETE_FAILED',
          message: 'Could not complete task activity.',
        },
      }
    }

    return {
      success: true,
      data: {
        activityId: updated.id,
        taskStatus: updated.task_status,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'ACTIVITY_COMPLETE_FAILED',
        message: 'Could not complete task activity.',
      },
    }
  }
}

export async function listFollowUpReminders(): Promise<ListFollowUpRemindersResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const now = new Date()
    const nowIso = now.toISOString()
    const supabase = await createClient()

    const { data: activities, error } = await supabase
      .from('client_activities')
      .select('id, client_id, summary, due_at')
      .eq('tenant_id', context.data.tenantId)
      .eq('logged_by', context.data.userId)
      .eq('activity_type', 'task')
      .eq('task_status', 'open')
      .not('due_at', 'is', null)
      .order('due_at', { ascending: true })

    if (error) {
      return {
        success: false,
        error: {
          code: 'REMINDER_LIST_FAILED',
          message: 'Could not load follow-up reminders.',
        },
      }
    }

    const clientIds = Array.from(new Set((activities ?? []).map((item) => item.client_id)))
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', clientIds)

    const nameById = new Map((clients ?? []).map((client) => [client.id, client.name]))
    const reminders = (activities ?? [])
      .filter((activity) => Boolean(activity.due_at))
      .map((activity) => ({
        activityId: activity.id,
        clientId: activity.client_id,
        clientName: nameById.get(activity.client_id) ?? 'Client',
        title: activity.summary,
        dueAt: activity.due_at!,
        isOverdue: activity.due_at! < nowIso,
      }))

    return {
      success: true,
      data: {
        reminders,
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'REMINDER_LIST_FAILED',
        message: 'Could not load follow-up reminders.',
      },
    }
  }
}

export async function fetchDashboardOverview(): Promise<FetchDashboardOverviewResult> {
  try {
    const context = await getTenantContext()
    if (!context.success) {
      return context
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, event_date, venue, pipeline_stage')
      .eq('tenant_id', context.data.tenantId)

    if (error) {
      return {
        success: false,
        error: {
          code: 'DASHBOARD_OVERVIEW_FETCH_FAILED',
          message: 'Could not load dashboard overview.',
        },
      }
    }

    const stageCounts = new Map<PipelineStage, number>(
      pipelineStageOrder.map((stage) => [stage, 0])
    )
    const today = new Date().toISOString().slice(0, 10)
    const end = new Date()
    end.setDate(end.getDate() + 7)
    const windowEnd = end.toISOString().slice(0, 10)

    const upcomingEvents: Array<{
      clientId: string
      clientName: string
      eventDate: string
      venue: string | null
      stage: PipelineStage
    }> = []
    let pendingQuotesCount = 0

    for (const item of data ?? []) {
      if (!isPipelineStage(item.pipeline_stage)) continue

      stageCounts.set(item.pipeline_stage, (stageCounts.get(item.pipeline_stage) ?? 0) + 1)
      if (item.pipeline_stage === 'proposal_sent' || item.pipeline_stage === 'revision') {
        pendingQuotesCount += 1
      }

      if (!item.event_date) continue
      const eventDay = item.event_date.slice(0, 10)
      if (eventDay < today || eventDay > windowEnd) continue

      upcomingEvents.push({
        clientId: item.id,
        clientName: item.name,
        eventDate: item.event_date,
        venue: item.venue,
        stage: item.pipeline_stage,
      })
    }

    upcomingEvents.sort((a, b) => a.eventDate.localeCompare(b.eventDate))

    return {
      success: true,
      data: {
        pipelineSummary: pipelineStageOrder.map((stage) => ({
          stage,
          label: pipelineStageLabels[stage],
          count: stageCounts.get(stage) ?? 0,
        })),
        upcomingEvents,
        pendingQuotes: {
          count: pendingQuotesCount,
        },
      },
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'DASHBOARD_OVERVIEW_FETCH_FAILED',
        message: 'Could not load dashboard overview.',
      },
    }
  }
}
