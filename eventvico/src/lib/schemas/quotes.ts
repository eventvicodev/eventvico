import { z } from 'zod'
// Quote Zod schemas — implemented in Story 5.1+
export const CreateQuoteSchema = z.object({}).passthrough()
export const QuoteLineItemSchema = z.object({}).passthrough()
