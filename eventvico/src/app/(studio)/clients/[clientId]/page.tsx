import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ClientActivities } from '@/app/(studio)/clients/[clientId]/client-activities'
import { ClientPrivacyControls } from '@/app/(studio)/clients/[clientId]/client-privacy-controls'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    notFound()
  }

  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.tenant_id) {
    notFound()
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, email, phone, event_date, venue, guest_count, budget, pipeline_stage, created_at')
    .eq('id', clientId)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()

  if (!client) {
    notFound()
  }

  const missingOptionalFields: string[] = []
  if (!client.event_date) missingOptionalFields.push('event date')
  if (!client.venue) missingOptionalFields.push('venue')
  if (!client.guest_count) missingOptionalFields.push('guest count')
  if (!client.budget) missingOptionalFields.push('budget')

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto w-full max-w-3xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">{client.name}</h1>
        <p className="mt-2 text-sm text-neutral-600">Pipeline stage: {client.pipeline_stage}</p>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Email</dt>
            <dd className="mt-1 text-sm text-neutral-900">{client.email ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Phone</dt>
            <dd className="mt-1 text-sm text-neutral-900">{client.phone ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Event date</dt>
            <dd className="mt-1 text-sm text-neutral-900">{client.event_date ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Venue</dt>
            <dd className="mt-1 text-sm text-neutral-900">{client.venue ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Guest count</dt>
            <dd className="mt-1 text-sm text-neutral-900">{client.guest_count ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Budget</dt>
            <dd className="mt-1 text-sm text-neutral-900">{client.budget ?? 'Not provided'}</dd>
          </div>
        </dl>

        {missingOptionalFields.length > 0 ? (
          <section className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-900">Complete this profile</h2>
            <p className="mt-1 text-sm text-amber-900">
              Add {missingOptionalFields.join(', ')} to improve quote accuracy and planning.
            </p>
          </section>
        ) : null}

        <div className="mt-6">
          <Link
            href="/clients/new"
            className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Register another client
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <ClientActivities clientId={client.id} />
        <ClientPrivacyControls clientId={client.id} />
      </div>
    </main>
  )
}
