import { NextResponse } from 'next/server'

// Offline barcode scan queue endpoint (service worker target) — Story 3.5
export async function POST() {
  return NextResponse.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Coming in Story 3.5' } }, { status: 501 })
}
