import { NextResponse } from 'next/server'
import { applyInventoryScan } from '@/lib/actions/inventory'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const result = await applyInventoryScan(body)
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.error.code === 'VALIDATION_ERROR' ? 400 : 500 }
    )
  }

  return NextResponse.json({ success: true, data: result.data })
}
