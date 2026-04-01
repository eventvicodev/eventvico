import Link from 'next/link'

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const links = [
    { href: '/dashboard', label: 'Dashboard', short: 'D' },
    { href: '/pipeline', label: 'Pipeline', short: 'P' },
    { href: '/clients', label: 'Clients', short: 'C' },
    { href: '/inventory', label: 'Inventory', short: 'I' },
    { href: '/recipes', label: 'Recipes', short: 'R' },
    { href: '/quotes', label: 'Quotes', short: 'Q' },
    { href: '/events', label: 'Events', short: 'E' },
    { href: '/subscription', label: 'Subscription', short: 'S' },
  ]

  return (
    <div className="min-h-screen bg-neutral-50 md:grid md:grid-cols-[64px_1fr] lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-neutral-200 bg-white md:block">
        <div className="sticky top-0 flex h-screen flex-col p-4">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Eventvico</p>
          <nav aria-label="Studio navigation" className="mt-4 space-y-1">
            {links.map((item) => (
              <Link key={item.href} href={item.href} className="flex min-h-11 items-center rounded-md px-3 text-sm text-neutral-700 hover:bg-neutral-100">
                <span className="md:inline lg:hidden" aria-hidden="true">{item.short}</span>
                <span className="sr-only md:not-sr-only lg:sr-only">{item.label}</span>
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col pb-16 md:pb-0">
        <header className="hidden h-14 items-center border-b border-neutral-200 bg-white px-6 md:flex">
          <p className="text-sm font-medium text-neutral-700">Studio workspace</p>
        </header>
        <div className="flex-1">{children}</div>

        <nav aria-label="Mobile tab navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white md:hidden">
          <ul className="grid grid-cols-4">
            <li>
              <Link href="/dashboard" className="flex h-14 items-center justify-center text-xs font-medium text-neutral-700">
                Dashboard
              </Link>
            </li>
            <li>
              <Link href="/clients" className="flex h-14 items-center justify-center text-xs font-medium text-neutral-700">
                Clients
              </Link>
            </li>
            <li>
              <Link href="/quotes" className="flex h-14 items-center justify-center text-xs font-medium text-neutral-700">
                Quotes
              </Link>
            </li>
            <li>
              <Link href="/events" className="flex h-14 items-center justify-center text-xs font-medium text-neutral-700">
                Events
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  )
}
