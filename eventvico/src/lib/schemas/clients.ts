import { z } from 'zod'

export const createClientSchema = z
  .object({
    name: z.string().trim().min(2, 'Client name is required').max(120, 'Client name must be 120 characters or fewer'),
    email: z.string().trim().email('Please enter a valid email address').optional().or(z.literal('')),
    phone: z.string().trim().max(32, 'Phone number must be 32 characters or fewer').optional().or(z.literal('')),
    eventDate: z.string().optional().or(z.literal('')),
    venue: z.string().trim().max(200, 'Venue must be 200 characters or fewer').optional().or(z.literal('')),
    guestCount: z.string().optional().or(z.literal('')),
    budget: z.string().optional().or(z.literal('')),
    allowDuplicateEmail: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    const email = input.email?.trim() ?? ''
    const phone = input.phone?.trim() ?? ''

    if (!email && !phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Provide at least one contact method (email or phone)',
      })
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'Provide at least one contact method (email or phone)',
      })
    }

    if (input.guestCount && !/^\d+$/.test(input.guestCount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guestCount'],
        message: 'Guest count must be a whole number',
      })
    }

    if (input.budget && Number.isNaN(Number(input.budget))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['budget'],
        message: 'Budget must be a valid number',
      })
    }
  })

export type CreateClientInput = z.infer<typeof createClientSchema>

export const clientActivityTypes = ['call', 'meeting', 'note', 'task'] as const
export type ClientActivityType = typeof clientActivityTypes[number]

export const createClientActivitySchema = z
  .object({
    clientId: z.string().trim().uuid('Invalid client identifier'),
    activityType: z.enum(clientActivityTypes),
    summary: z.string().trim().min(2, 'Summary is required').max(240, 'Summary must be 240 characters or fewer'),
    note: z.string().trim().max(4000, 'Note must be 4000 characters or fewer').optional().or(z.literal('')),
    dueAt: z.string().optional().or(z.literal('')),
  })
  .superRefine((input, ctx) => {
    if (input.activityType === 'task' && !input.dueAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueAt'],
        message: 'Due date is required for task activities',
      })
    }
  })

export type CreateClientActivityInput = z.infer<typeof createClientActivitySchema>
