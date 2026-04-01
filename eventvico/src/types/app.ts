// Application-level TypeScript types
// These extend or compose from src/types/supabase.ts (auto-generated)

// ── Server Action return type ─────────────────────────────────────────────────
// All Server Actions MUST return ActionResult<T> — NEVER throw.
// This ensures consistent error handling across the entire application.
export type ActionError = {
  code: string
  message: string
  fields?: Record<string, string[]>
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: ActionError }

// ── Pagination ────────────────────────────────────────────────────────────────
export type PaginatedResult<T> = {
  data: T[]
  count: number
  page: number
  pageSize: number
}

// ── Pipeline stages ───────────────────────────────────────────────────────────
export type PipelineStage =
  | 'lead'
  | 'qualified'
  | 'proposal_sent'
  | 'revision'
  | 'booked'
  | 'in_fulfillment'
  | 'completed'

// ── Fulfillment status ────────────────────────────────────────────────────────
export type FulfillmentStatus = 'unprepared' | 'prepared' | 'packed' | 'delivered'

// ── AI Job status ─────────────────────────────────────────────────────────────
export type AIJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

// ── Quote status ──────────────────────────────────────────────────────────────
export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'revision_requested' | 'locked'

// ── Subscription plan ─────────────────────────────────────────────────────────
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled'
