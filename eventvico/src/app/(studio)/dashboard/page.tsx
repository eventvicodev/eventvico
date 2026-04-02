import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { fetchDashboardOverview, listFollowUpReminders } from '@/lib/actions/clients'
import { NeedsAttention } from '@/app/(studio)/dashboard/needs-attention'
import { enqueueTrialReminderIfNeeded } from '@/lib/subscription/reminders'
import { enqueueDueTaskReminderIfNeeded } from '@/lib/subscription/reminders'
import { getTrialStatus } from '@/lib/subscription/trial'
import { BillingStatusToast } from '@/app/(studio)/dashboard/billing-status-toast'
import { pipelineStageLabels, pipelineStageOrder } from '@/lib/clients/pipeline'
import { listStudioNotifications, runImageLifecycleSweep } from '@/lib/actions/compliance'

function formatEventDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

export default async function DashboardPage() {
  const now = new Date()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let data: {
    trialStatus: ReturnType<typeof getTrialStatus>
    reminders: Array<{
      activityId: string
      clientId: string
      clientName: string
      title: string
      dueAt: string
      isOverdue: boolean
    }>
    overview: {
      pipelineSummary: Array<{
        stage: (typeof pipelineStageOrder)[number]
        label: string
        count: number
      }>
      upcomingEvents: Array<{
        clientId: string
        clientName: string
        eventDate: string
        venue: string | null
        stage: (typeof pipelineStageOrder)[number]
      }>
      pendingQuotes: {
        count: number
      }
    } | null
    notifications: Array<{
      id: string
      severity: 'info' | 'warning' | 'error' | 'success'
      title: string
      message: string
      createdAt: string
      readAt: string | null
    }>
  } | null = null

  if (user) {
    const { data: profile } = await createAdminClient()
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.tenant_id) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id, name, plan_status, trial_ends_at')
        .eq('id', profile.tenant_id)
        .maybeSingle()

      if (tenant) {
        const remindersResult = await listFollowUpReminders()
        const reminders = remindersResult.success ? remindersResult.data.reminders : []
        const overviewResult = await fetchDashboardOverview()
        const overview = overviewResult.success ? overviewResult.data : null
        const notificationsResult = await listStudioNotifications()
        const notifications = notificationsResult.success ? notificationsResult.data.notifications : []
        await runImageLifecycleSweep()

        await enqueueTrialReminderIfNeeded({
          supabase,
          tenant,
          recipientEmail: user.email ?? '',
          now,
        })

        const recipientEmail = user.email ?? ''
        if (recipientEmail) {
          await Promise.all(
            reminders.map((reminder) =>
              enqueueDueTaskReminderIfNeeded({
                supabase,
                tenantId: tenant.id,
                tenantName: tenant.name,
                activityId: reminder.activityId,
                dueAt: reminder.dueAt,
                title: reminder.title,
                recipientEmail,
                now,
              })
            )
          )
        }

        data = {
          trialStatus: getTrialStatus(tenant, now),
          reminders,
          overview,
          notifications,
        }
      }
    }
  }

  return (
    <main className="flex-1 p-6">
      <BillingStatusToast />
      <h1 className="text-xl font-semibold text-neutral-900">Dashboard</h1>
      {data?.trialStatus.isTrial ? (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-medium text-brand-700">
            Trial plan: {typeof data.trialStatus.daysRemaining === 'number' ? `${Math.max(data.trialStatus.daysRemaining, 0)} day(s) remaining` : 'active'}
          </p>
        </div>
      ) : null}

      {data?.trialStatus.showExpiringBanner ? (
        <section
          aria-label="Trial expiry reminder"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-medium text-amber-900">
            Your free trial expires in {data.trialStatus.daysRemaining} day(s). Upgrade now to keep uninterrupted access.
          </p>
          <a
            href="/subscription"
            className="mt-2 inline-flex min-h-11 items-center rounded-md border border-amber-500 px-3 text-sm font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Activate subscription
          </a>
        </section>
      ) : null}

      {data?.reminders ? <NeedsAttention reminders={data.reminders} /> : null}

      {data?.notifications?.length ? (
        <section aria-label="Platform notifications" className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Platform notifications</h2>
          <ul className="mt-3 space-y-2">
            {data.notifications.map((item) => (
              <li key={item.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-sm font-medium text-neutral-900">{item.title}</p>
                <p className="mt-1 text-xs text-neutral-700">{item.message}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Team operations overview" className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-neutral-900">Active pipeline by stage</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {pipelineStageOrder.map((stage) => {
              const count = data?.overview?.pipelineSummary.find((item) => item.stage === stage)?.count ?? 0
              return (
                <li key={stage} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-medium text-neutral-600">{pipelineStageLabels[stage]}</p>
                  <p className="mt-2 text-2xl font-semibold text-neutral-900">{count}</p>
                </li>
              )
            })}
          </ul>
        </article>

        <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Pending quotes</h2>
          <p className="mt-2 text-3xl font-semibold text-neutral-900">{data?.overview?.pendingQuotes.count ?? 0}</p>
          <p className="mt-1 text-xs text-neutral-600">Awaiting client approval</p>
          <Link
            href="/pipeline"
            className="mt-4 inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Review pipeline
          </Link>
        </article>

        <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-3">
          <h2 className="text-sm font-semibold text-neutral-900">Upcoming events (next 7 days)</h2>
          {data?.overview?.upcomingEvents.length ? (
            <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {data.overview.upcomingEvents.map((event) => (
                <li key={event.clientId} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{event.clientName}</p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {formatEventDate(event.eventDate)}
                        {event.venue ? ` · ${event.venue}` : ''}
                      </p>
                    </div>
                    <Link
                      href={`/clients/${event.clientId}`}
                      className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-2 text-xs font-medium text-neutral-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                    >
                      View
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-neutral-300 p-4">
              <p className="text-sm text-neutral-600">
                No events in the next 7 days — schedule your first event
              </p>
              <Link
                href="/clients/new"
                className="mt-3 inline-flex min-h-11 items-center rounded-md border border-brand-500 bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Schedule event
              </Link>
            </div>
          )}
        </article>
      </section>
    </main>
  )
}
