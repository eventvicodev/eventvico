import { Skeleton } from '@/components/ui/skeleton'

export default function InventoryLoading() {
  return (
    <main className="flex-1 p-6">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="mt-2 h-4 w-80" />

      <div className="mt-6 space-y-4">
        <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <Skeleton className="h-5 w-28" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <Skeleton className="h-5 w-36" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Skeleton className="h-20 w-full" />
          </div>
        </section>
      </div>
    </main>
  )
}
