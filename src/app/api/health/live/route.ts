import { NextResponse } from 'next/server';
import { HEALTH_HEADERS } from '@/lib/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200, headers: HEALTH_HEADERS });
}
