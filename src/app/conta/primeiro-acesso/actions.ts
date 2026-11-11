'use server';

import { headers } from 'next/headers';
import {
  listFirstAccessInstitutionsServer,
  requestConsumerFirstAccessServer,
  type RequestFirstAccessInput,
} from '@/services/consumer-first-access.service';
import { resolveAppOrigin } from '@/lib/app-origin';

export async function listFirstAccessInstitutionsAction(tenantSlug: string) {
  return listFirstAccessInstitutionsServer(tenantSlug);
}

export async function requestFirstAccessAction(input: RequestFirstAccessInput) {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwardedFor || requestHeaders.get('x-real-ip') || 'unknown';
  const userAgent = requestHeaders.get('user-agent') || 'unknown';
  const origin = resolveAppOrigin(requestHeaders, process.env.NEXT_PUBLIC_APP_URL);

  return requestConsumerFirstAccessServer(input, {
    ip,
    userAgent,
    origin: new URL(origin).origin,
  });
}
