import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardLoading() {
  return (
    <main className="flex-1 p-6">
      <Skeleton className="h-8 w-36" />

      <section aria-label="Team operations loading" className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-2">
          <Skeleton className="h-4 w-44" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </article>

        <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-10 w-16" />
          <Skeleton className="mt-4 h-11 w-36" />
        </article>

        <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-3">
          <Skeleton className="h-4 w-52" />
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </article>
      </section>
    </main>
  )
}
