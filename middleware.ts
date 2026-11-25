import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Unified implementation works for all devices
  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/daily'],
}
