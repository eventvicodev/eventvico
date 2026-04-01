import { createClient } from '@/lib/supabase/server'
import { POST } from '@/app/api/ai/generate/route'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('@/lib/actions/compliance', () => ({
  registerUploadedImageAsset: jest.fn().mockResolvedValue({ success: true }),
}))

const createClientMock = createClient as jest.MockedFunction<typeof createClient>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/ai/generate', () => {
  it('returns validation error when no image is provided', async () => {
    const request = new Request('https://eventvico.example/api/ai/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ styleNotes: 'romantic' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns validation error when empty imageDataUrl is provided', async () => {
    const request = new Request('https://eventvico.example/api/ai/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: '   ' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error.code).toBe('VALIDATION_ERROR')
  })

  it('creates ai job row for valid image upload', async () => {
    const insertSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'job-1',
        status: 'pending',
        tenant_id: 'tenant-1',
        created_at: '2026-04-01T12:00:00.000Z',
      },
      error: null,
    })
    const insertSelect = jest.fn().mockReturnValue({ single: insertSingle })
    const insert = jest.fn().mockReturnValue({ select: insertSelect })

    createClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { tenant_id: 'tenant-1' } }),
              }),
            }),
          }
        }
        if (table === 'ai_jobs') {
          return { insert }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never)

    const request = new Request('https://eventvico.example/api/ai/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: 'data:image/jpeg;base64,abc123' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(202)
    const payload = await response.json()
    expect(payload.data.jobId).toBe('job-1')
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        created_by: 'user-1',
        source_type: 'image',
      })
    )
  })

  it('does not accept pinterest_url as a valid source', async () => {
    // Pinterest URL is no longer supported — only imageDataUrl
    const request = new Request('https://eventvico.example/api/ai/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinterestUrl: 'https://pinterest.com/board/123' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error.code).toBe('VALIDATION_ERROR')
  })
})
