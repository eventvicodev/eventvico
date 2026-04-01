'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { requestClientDataDeletion } from '@/lib/actions/compliance'

export function ClientPrivacyControls({ clientId }: { clientId: string }) {
  const { addToast } = useToast()
  const [confirmImpact, setConfirmImpact] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const requestDeletion = async () => {
    if (!window.confirm('Submit GDPR data deletion request for this client?')) return

    setIsSubmitting(true)
    const result = await requestClientDataDeletion({ clientId, confirmImpact })
    setIsSubmitting(false)

    if (!result.success) {
      if (result.error.code === 'UPCOMING_EVENT_WARNING') {
        addToast('warning', result.error.message)
        return
      }
      addToast('error', result.error.message)
      return
    }

    addToast('success', 'GDPR deletion request completed and records were anonymized.')
  }

  return (
    <section className="mt-6 rounded-md border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Privacy</h2>
      <p className="mt-1 text-sm text-neutral-600">Request deletion of this client&apos;s personal data (GDPR).</p>

      <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={confirmImpact}
          onChange={(event) => {
            setConfirmImpact(event.target.checked)
          }}
        />
        I understand deleting personal data for clients with upcoming events may affect fulfillment planning.
      </label>

      <Button
        type="button"
        variant="outline"
        className="mt-3"
        onClick={() => { void requestDeletion() }}
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Processing…' : 'Request data deletion'}
      </Button>
    </section>
  )
}
