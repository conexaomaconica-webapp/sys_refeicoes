import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database.types';

/**
 * Atualiza e renova a sessão Supabase Auth nos cookies da requisição/resposta.
 * Valida a integridade da sessão e bloqueia contas inativas ou suspensas.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Parameters<typeof supabaseResponse.cookies.set>[2] }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Executa getUser() para validar/renovar o token com o auth server de forma segura
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Se usuário autenticado, verificar se seu perfil está ativo
  if (user) {
    const { data: profile } = await (
      supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: { status: string } | null }>;
            };
          };
        };
      }
    )
      .from('profiles')
      .select('status')
      .eq('id', user.id)
      .maybeSingle();

    if (profile && profile.status !== 'active') {

      // Forçar logout e redirecionar para login com mensagem de erro
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/login';
      redirectUrl.searchParams.set('error', 'account_inactive');
      const response = NextResponse.redirect(redirectUrl);

      // Limpa cookies de auth
      response.cookies.delete('sb-access-token');
      response.cookies.delete('sb-refresh-token');
      return response;
    }
  }

  return supabaseResponse;
}
