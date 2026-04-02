'use client'

import { signOut } from '@/lib/actions/auth'
import { useTransition } from 'react'

export function SignOutButton() {
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => signOut())}
      className="flex min-h-11 w-full items-center rounded-md px-3 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50"
    >
      <span className="md:inline lg:hidden" aria-hidden="true">→</span>
      <span className="sr-only md:not-sr-only lg:sr-only">{isPending ? '…' : 'Out'}</span>
      <span className="hidden lg:inline">{isPending ? 'Signing out…' : 'Sign out'}</span>
    </button>
  )
}
