import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
  // Base — shared across all variants
  'inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
  {
    variants: {
      surface: {
        studio: 'rounded-md text-sm',
        portal: 'rounded-lg text-base',
      },
      variant: {
        primary: 'bg-brand-500 text-white hover:bg-brand-600',
        secondary: 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
        outline: 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
        ghost: 'text-neutral-700 hover:bg-neutral-100',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        icon: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700',
        'portal-primary': 'bg-clay-500 text-white hover:bg-clay-700',
      },
      size: {
        sm: 'h-7 px-2.5 py-1',
        md: 'h-9 px-3.5 py-2',
        lg: 'h-11 px-5 py-2.5',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      surface: 'studio',
      variant: 'primary',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, surface, isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled ?? isLoading}
        aria-busy={isLoading}
        className={buttonVariants({ variant, size, surface, className })}
        {...props}
      >
        {isLoading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
        ) : null}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
