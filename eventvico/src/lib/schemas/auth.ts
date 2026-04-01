import { z } from 'zod'

const STUDIO_NAME_MIN = 2
const STUDIO_NAME_MAX = 120
const PASSWORD_MIN = 8

export const passwordRequirements = [
  `At least ${PASSWORD_MIN} characters`,
  'At least one uppercase letter',
  'At least one lowercase letter',
  'At least one number',
] as const

export const registerStudioSchema = z.object({
  studioName: z
    .string()
    .trim()
    .min(STUDIO_NAME_MIN, 'Studio name is required')
    .max(STUDIO_NAME_MAX, `Studio name must be ${STUDIO_NAME_MAX} characters or fewer`),
  email: z.string().trim().email('Please enter a valid email address'),
  password: z
    .string()
    .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
    .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
    .regex(/[a-z]/, 'Password must include at least one lowercase letter')
    .regex(/[0-9]/, 'Password must include at least one number'),
})

export type RegisterStudioInput = z.infer<typeof registerStudioSchema>

export function getPasswordRequirementMessages(password: string): string[] {
  const messages: string[] = []

  if (password.length < PASSWORD_MIN) {
    messages.push(`Password must be at least ${PASSWORD_MIN} characters`)
  }
  if (!/[A-Z]/.test(password)) {
    messages.push('Password must include at least one uppercase letter')
  }
  if (!/[a-z]/.test(password)) {
    messages.push('Password must include at least one lowercase letter')
  }
  if (!/[0-9]/.test(password)) {
    messages.push('Password must include at least one number')
  }

  return messages
}

