import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

/**
 * Cliente Supabase com privilégios de Administrador (Service Role).
 * 
 * ATENÇÃO CRÍTICA DE SEGURANÇA:
 * 1. NUNCA importe ou utilize esta função em Client Components ('use client').
 * 2. NUNCA exponha a SUPABASE_SERVICE_ROLE_KEY no frontend.
 * 3. Esta função só deve ser usada em tarefas em segundo plano ou rotas protegidas
 *    do servidor onde seja explicitamente necessário bypass de RLS para tarefas
 *    administrativas internas.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'VIOLAÇÃO DE SEGURANÇA: createAdminClient() não pode ser executado no navegador!'
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Faltam variáveis de ambiente NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export { createAdminClient as getAdminClient };

