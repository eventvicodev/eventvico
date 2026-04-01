import { fetchPipelineClients } from '@/lib/actions/clients'
import { PipelineBoard } from '@/app/(studio)/pipeline/pipeline-board'

export default async function PipelinePage() {
  const result = await fetchPipelineClients()

  if (!result.success) {
    return (
      <main className="flex-1 p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {result.error.message}
        </div>
      </main>
    )
  }

  return <PipelineBoard initialClients={result.data.clients} />
}

