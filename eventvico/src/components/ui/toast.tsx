'use client'

import * as React from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

// Toast system — UX-DR16:
// success: auto-dismiss 4s | error: no auto-dismiss, recovery action | warning: 6s | info: 4s
// max 3 stacked | top-right desktop, bottom mobile

export type ToastType = 'success' | 'error' | 'warning' | 'info'
export type Surface = 'studio' | 'portal'

export interface Toast {
  id: string
  type: ToastType
  message: string
  action?: { label: string; onClick: () => void }
}

const TOAST_DURATIONS: Record<ToastType, number | null> = {
  success: 4000,
  error: null,   // no auto-dismiss
  warning: 6000,
  info: 4000,
}

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-4 w-4 text-brand-500" aria-hidden="true" />,
  error:   <XCircle className="h-4 w-4 text-red-500" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />,
  info:    <Info className="h-4 w-4 text-blue-500" aria-hidden="true" />,
}

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'border-brand-200 bg-white',
  error:   'border-red-200 bg-white',
  warning: 'border-amber-200 bg-white',
  info:    'border-blue-200 bg-white',
}

interface ToastItemProps {
  toast: Toast
  onDismiss: (id: string) => void
  surface: Surface
}

function ToastItem({ toast, onDismiss, surface }: ToastItemProps) {
  React.useEffect(() => {
    const duration = TOAST_DURATIONS[toast.type]
    if (duration === null) return
    const timer = setTimeout(() => onDismiss(toast.id), duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.type, onDismiss])

  const surfaceClass = surface === 'portal' ? 'bg-neutral-50' : 'bg-white'

  return (
    <div
      role="alert"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      data-surface={surface}
      className={`flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-md ${TOAST_STYLES[toast.type]} ${surfaceClass}`}
    >
      {TOAST_ICONS[toast.type]}
      <div className="flex-1 text-sm">
        <p className="text-neutral-900">{toast.message}</p>
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="mt-1 text-xs font-medium text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="rounded text-neutral-400 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
  surface: Surface
}

// Toast container — top-right on desktop, bottom on mobile (UX-DR16)
export function ToastContainer({ toasts, onDismiss, surface }: ToastContainerProps) {
  const visible = toasts.slice(-3) // max 3 stacked

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2 md:bottom-auto md:right-4 md:top-4 md:left-auto md:inset-x-auto md:w-auto"
    >
      {visible.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={onDismiss} surface={surface} />
        </div>
      ))}
    </div>
  )
}

// Context and hook for imperatively adding toasts
interface ToastContextValue {
  addToast: (type: ToastType, message: string, action?: Toast['action']) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function ToastProvider({ children, surface = 'studio' }: { children: React.ReactNode; surface?: Surface }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = React.useCallback(
    (type: ToastType, message: string, action?: Toast['action']) => {
      const id = crypto.randomUUID()
      setToasts((prev) => [...prev, { id, type, message, action }])
    },
    []
  )

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} surface={surface} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
