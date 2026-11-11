import { NextResponse } from 'next/server';
import { HEALTH_HEADERS, isRuntimeReady } from '@/lib/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  const ready = isRuntimeReady();
  return NextResponse.json(
    { status: ready ? 'ready' : 'not_ready' },
    { status: ready ? 200 : 503, headers: HEALTH_HEADERS }
  );
}
