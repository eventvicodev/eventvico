import * as React from 'react'

type Surface = 'studio' | 'portal'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional fixed height in px — useful when mimicking specific content blocks */
  height?: number
  surface?: Surface
}

// Skeleton loading component — mirrors content shape using animate-pulse
// Use instead of spinners for all initial page loads (UX-DR15)
function Skeleton({ className, height, style, surface = 'studio', ...props }: SkeletonProps) {
  const surfaceClass = surface === 'portal' ? 'bg-neutral-100' : 'bg-neutral-200'
  return (
    <div
      className={`animate-pulse rounded-md ${surfaceClass} ${className ?? ''}`}
      style={{ height: height ? `${height}px` : undefined, ...style }}
      aria-hidden="true"
      {...props}
    />
  )
}

export { Skeleton }
