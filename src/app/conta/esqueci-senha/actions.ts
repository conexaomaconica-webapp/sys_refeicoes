'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function requestPasswordRecoveryAction(email: string) {
  const requestHeaders = await headers();
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originHeader = requestHeaders.get('origin');
  const host = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host');
  const protocol = requestHeaders.get('x-forwarded-proto') || 'https';
  const origin = new URL(configuredUrl || originHeader || (host ? `${protocol}://${host}` : 'http://localhost:3000')).origin;
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.trim().toLocaleLowerCase('pt-BR'), {
    redirectTo: `${origin}/auth/callback?next=/conta/redefinir-senha`,
  });
  return { success: true as const };
}
