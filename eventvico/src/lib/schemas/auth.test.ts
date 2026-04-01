import { registerStudioSchema } from '@/lib/schemas/auth'

describe('registerStudioSchema', () => {
  it('rejects invalid email', () => {
    const result = registerStudioSchema.safeParse({
      studioName: 'Bloom Studio',
      email: 'invalid-email',
      password: 'StrongPass1',
    })

    expect(result.success).toBe(false)
  })

  it('rejects weak password', () => {
    const result = registerStudioSchema.safeParse({
      studioName: 'Bloom Studio',
      email: 'owner@example.com',
      password: 'weak',
    })

    expect(result.success).toBe(false)
  })

  it('rejects missing studio name', () => {
    const result = registerStudioSchema.safeParse({
      studioName: '',
      email: 'owner@example.com',
      password: 'StrongPass1',
    })

    expect(result.success).toBe(false)
  })
})

