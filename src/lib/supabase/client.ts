import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database.types';

/**
 * Cliente Supabase para uso em Client Components (Browser).
 * Utiliza EXCLUSIVAMENTE a chave anônima pública (NEXT_PUBLIC_SUPABASE_ANON_KEY).
 * REGRA CRÍTICA: NUNCA passe a service_role key para este cliente.
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Faltam variáveis de ambiente NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
