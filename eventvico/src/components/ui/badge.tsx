import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

const badgeVariants = cva('inline-flex items-center font-medium', {
  variants: {
    surface: {
      studio: 'text-xs px-2 py-0.5 rounded',
      portal: 'text-sm px-3 py-1 rounded-full',
    },
    status: {
      default:   'bg-neutral-100 text-neutral-600',
      lead:      'bg-neutral-200 text-neutral-600',
      contacted: 'bg-blue-100 text-blue-700',
      proposal:  'bg-yellow-100 text-yellow-800',
      booked:    'bg-brand-100 text-brand-700',
      progress:  'bg-violet-100 text-violet-700',
      complete:  'bg-neutral-100 text-neutral-500',
      error:     'bg-red-100 text-red-800',
      warning:   'bg-amber-100 text-amber-800',
      success:   'bg-brand-100 text-brand-700',
      review:    'bg-amber-100 text-amber-800',
      confirm:   'bg-red-100 text-red-800',
    },
  },
  defaultVariants: {
    surface: 'studio',
    status: 'default',
  },
})

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, surface, status, ...props }: BadgeProps) {
  return (
    <span className={badgeVariants({ surface, status, className })} {...props} />
  )
}

export { Badge, badgeVariants }
