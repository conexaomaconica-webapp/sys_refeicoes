'use server';

import { headers } from 'next/headers';
import {
  listFirstAccessInstitutionsServer,
  requestConsumerFirstAccessServer,
  type RequestFirstAccessInput,
} from '@/services/consumer-first-access.service';

export async function listFirstAccessInstitutionsAction(tenantSlug: string) {
  return listFirstAccessInstitutionsServer(tenantSlug);
}

export async function requestFirstAccessAction(input: RequestFirstAccessInput) {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwardedFor || requestHeaders.get('x-real-ip') || 'unknown';
  const userAgent = requestHeaders.get('user-agent') || 'unknown';
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const requestOrigin = requestHeaders.get('origin');
  const host = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host');
  const protocol = requestHeaders.get('x-forwarded-proto') || 'https';
  const origin = configuredUrl || requestOrigin || (host ? `${protocol}://${host}` : 'http://localhost:3000');

  return requestConsumerFirstAccessServer(input, {
    ip,
    userAgent,
    origin: new URL(origin).origin,
  });
}
