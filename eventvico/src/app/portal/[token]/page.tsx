'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import {
  approveQuoteFromPortal,
  fetchPortalSnapshot,
  requestNewPortalLink,
  requestQuoteChangesFromPortal,
} from '@/lib/actions/portal'

type PortalLine = {
  id: string
  description: string
  quantity: number
  unitCostSnapshot: number
  lineType: 'inventory' | 'custom' | 'discount'
}

type PortalRevision = {
  id: string
  revisionNumber: number
  status: 'draft' | 'sent' | 'approved' | 'revision_requested' | 'locked'
  createdAt: string
  lines: PortalLine[]
}

type PortalSnapshot = {
  token: string
  quoteId: string
  client: {
    name: string
    email: string | null
    eventDate: string | null
    venue: string | null
  }
  quote: {
    title: string
    status: 'draft' | 'sent' | 'approved' | 'revision_requested' | 'locked'
    note: string | null
    discountType: 'percent' | 'fixed' | null
    discountValue: number
  }
  lines: PortalLine[]
  revisions: PortalRevision[]
  approvedAt: string | null
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function summarizeLines(lines: PortalLine[]) {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitCostSnapshot, 0)
}

export default function PortalPage({ params }: { params: { token: string } }) {
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null)
  const [changeNote, setChangeNote] = useState('')
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false)
  const [isSubmittingChange, setIsSubmittingChange] = useState(false)

  const activeRevision = useMemo(() => {
    if (!snapshot) return null
    if (!selectedRevisionId) return snapshot.revisions[0] ?? null
    return snapshot.revisions.find((revision) => revision.id === selectedRevisionId) ?? snapshot.revisions[0] ?? null
  }, [selectedRevisionId, snapshot])

  const activeLines = activeRevision?.lines ?? snapshot?.lines ?? []
  const subtotal = summarizeLines(activeLines)
  const discountValue = Number(snapshot?.quote.discountValue ?? 0)
  const discountAmount = snapshot?.quote.discountType === 'percent'
    ? Math.min(subtotal, subtotal * (discountValue / 100))
    : snapshot?.quote.discountType === 'fixed'
      ? Math.min(subtotal, discountValue)
      : 0
  const total = Math.max(0, subtotal - discountAmount)

  const loadPortal = async () => {
    setIsLoading(true)
    setErrorMessage(null)

    const result = await fetchPortalSnapshot({ token: params.token })
    setIsLoading(false)

    if (!result.success) {
      setErrorMessage(result.error.message)
      return
    }

    setSnapshot(result.data)
    setSelectedRevisionId(result.data.revisions[0]?.id ?? null)
  }

  useEffect(() => {
    void loadPortal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token])

  const submitApproval = async () => {
    if (!snapshot || snapshot.quote.status === 'approved') return
    setIsSubmittingApproval(true)
    const result = await approveQuoteFromPortal({ token: params.token })
    setIsSubmittingApproval(false)

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', 'Your approval has been recorded — the studio will be in touch.')
    await loadPortal()
  }

  const submitChangeRequest = async () => {
    if (!snapshot) return
    setIsSubmittingChange(true)
    const result = await requestQuoteChangesFromPortal({ token: params.token, note: changeNote })
    setIsSubmittingChange(false)

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    setChangeNote('')
    addToast('success', 'Your feedback has been sent — the studio will review and send a revised proposal.')
    await loadPortal()
  }

  const requestFreshLink = async () => {
    const result = await requestNewPortalLink({ token: params.token })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', 'A new portal link request has been sent to the studio.')
  }

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <Skeleton surface="portal" className="h-12 w-3/4" />
        <Skeleton surface="portal" className="mt-4 h-24 w-full" />
        <Skeleton surface="portal" className="mt-4 h-32 w-full" />
        <Skeleton surface="portal" className="mt-4 h-32 w-full" />
      </main>
    )
  }

  if (errorMessage || !snapshot) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <h1 className="font-serif text-4xl font-semibold text-neutral-900">Your Event Proposal</h1>
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMessage ?? 'This portal link is unavailable.'}
        </p>
        <Button type="button" className="mt-4" onClick={() => { void requestFreshLink() }}>
          Request a new link
        </Button>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-8 md:px-6 md:py-12">
      <h1 className="font-serif text-4xl font-semibold text-neutral-900">Your Event Proposal</h1>
      <p className="mt-3 text-sm text-neutral-600">
        {snapshot.client.name} · {snapshot.client.eventDate ?? 'Date TBD'} · {snapshot.client.venue ?? 'Venue TBD'}
      </p>

      <section className="mt-5 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Current proposal</p>
        <h2 className="mt-1 font-serif text-2xl text-neutral-900">{snapshot.quote.title}</h2>
        <p className="mt-1 text-sm text-neutral-600">Status: {snapshot.quote.status.replace('_', ' ')}</p>
        {snapshot.quote.status === 'approved' && snapshot.approvedAt ? (
          <p className="mt-2 text-sm font-medium text-emerald-700">Approved ✓ on {new Date(snapshot.approvedAt).toLocaleString()}</p>
        ) : null}
      </section>

      <section className="mt-5 space-y-3">
        {activeLines.map((line) => (
          <article key={line.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-serif text-xl text-neutral-900">{line.description}</h3>
                <p className="text-xs uppercase tracking-wide text-clay-700">{line.lineType}</p>
                <p className="mt-2 text-sm text-neutral-600">{line.quantity} stems/items · {formatMoney(line.unitCostSnapshot)} each</p>
              </div>
              <p className="text-sm font-semibold text-neutral-900">{formatMoney(line.quantity * line.unitCostSnapshot)}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="mt-5 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-900">Itemized cost breakdown</h3>
        <div className="mt-3 space-y-1 text-sm text-neutral-700">
          <p>Subtotal: {formatMoney(subtotal)}</p>
          <p>Discount: -{formatMoney(discountAmount)}</p>
          <p className="font-semibold text-neutral-900">Total: {formatMoney(total)}</p>
        </div>
        {snapshot.quote.note ? (
          <p className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            Note: {snapshot.quote.note}
          </p>
        ) : null}
      </section>

      <section className="mt-5 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-900">Revision history</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {snapshot.revisions.map((revision) => (
            <button
              key={revision.id}
              type="button"
              onClick={() => {
                setSelectedRevisionId(revision.id)
              }}
              className={[
                'rounded-md border px-3 py-2 text-left text-sm',
                revision.id === activeRevision?.id
                  ? 'border-clay-500 bg-clay-50 text-clay-900'
                  : 'border-neutral-300 text-neutral-700',
              ].join(' ')}
            >
              <p className="font-medium">Version {revision.revisionNumber}</p>
              <p className="text-xs">{new Date(revision.createdAt).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
        {activeRevision && activeRevision.id !== snapshot.revisions[0]?.id ? (
          <p className="mt-3 text-xs text-amber-800">This is a previous version — your current proposal is Version {snapshot.revisions[0]?.revisionNumber}.</p>
        ) : null}
      </section>

      {snapshot.quote.status !== 'approved' ? (
        <section className="mt-5 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900">Need a revision?</h3>
          <textarea
            aria-label="Describe requested quote changes"
            value={changeNote}
            onChange={(event) => {
              setChangeNote(event.target.value)
            }}
            className="mt-2 min-h-24 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="Tell the studio what you'd like changed"
          />
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            onClick={() => { void submitChangeRequest() }}
            disabled={isSubmittingChange}
          >
            {isSubmittingChange ? 'Sending…' : 'Request changes'}
          </Button>
        </section>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white p-3 md:static md:mt-5 md:border-0 md:bg-transparent md:p-0">
        <Button
          type="button"
          variant="portal-primary"
          aria-label={`Approve proposal ${snapshot.quote.title}`}
          className="h-12 w-full"
          onClick={() => { void submitApproval() }}
          disabled={snapshot.quote.status === 'approved' || isSubmittingApproval}
        >
          {snapshot.quote.status === 'approved'
            ? 'Approved ✓'
            : isSubmittingApproval
              ? 'Recording approval…'
              : 'Approve proposal'}
        </Button>
      </div>
    </main>
  )
}
