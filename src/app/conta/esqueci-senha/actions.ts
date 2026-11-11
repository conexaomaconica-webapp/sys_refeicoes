'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

import { resolveAppOrigin } from '@/lib/app-origin';

export async function requestPasswordRecoveryAction(email: string) {
  const requestHeaders = await headers();
  const origin = resolveAppOrigin(requestHeaders, process.env.NEXT_PUBLIC_APP_URL);
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.trim().toLocaleLowerCase('pt-BR'), {
    redirectTo: `${origin}/auth/callback?next=/conta/redefinir-senha`,
  });
  return { success: true as const };
}
