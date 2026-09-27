import { createBrowserClient } from '@/lib/supabase/client';
import type { PublicTenantBranding } from '@/types/tenant';

/**
 * Slug padrão configurável via ambiente para desenvolvimento e fallback.
 * Em conformidade com a Sprint 1, representa o tenant (empresa de alimentação contratante).
 */
export const DEFAULT_TENANT_SLUG =
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG?.toLowerCase().trim() || 'nutri-refeicoes';

/**
 * Branding seguro de contingência/fallback utilizado quando offline ou enquanto conecta.
 */
export const FALLBACK_BRANDING: PublicTenantBranding = {
  tenant_id: 'default-tenant',
  slug: DEFAULT_TENANT_SLUG,
  app_name: 'Sistema de Refeições',
  logo_url: null,
  splash_background: '#0f172a',
  splash_animation_type: 'fade_pulse',
  splash_duration_ms: 1200,
  primary_color: '#0284c7',
  secondary_color: '#0f172a',
};

/**
 * Normaliza qualquer slug de tenant para lowercase seguro.
 */
export function normalizeTenantSlug(slug?: string | null): string {
  if (!slug) return DEFAULT_TENANT_SLUG;
  const normalized = slug.toLowerCase().trim();
  return normalized || DEFAULT_TENANT_SLUG;
}

/**
 * Obtém a superfície pública de branding do tenant via RPC get_public_tenant_branding.
 * Utiliza o cliente anônimo público e não acessa tabelas restritas.
 */
export async function getPublicTenantBranding(
  rawSlug?: string | null
): Promise<PublicTenantBranding> {
  const slug = normalizeTenantSlug(rawSlug);

  try {
    const supabase = createBrowserClient();

    // Chamada à RPC pública get_public_tenant_branding
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: { p_slug: string }
        ) => Promise<{
          data: Array<{
            tenant_id: string;
            slug: string;
            app_name: string;
            logo_url: string | null;
            splash_background: string | null;
            splash_animation_type: 'fade_pulse' | 'slide_up' | 'zoom_in' | 'none';
            splash_duration_ms: number;
            primary_color: string | null;
            secondary_color: string | null;
          }> | null;
          error: { message: string } | null;
        }>;
      }
    ).rpc('get_public_tenant_branding', {
      p_slug: slug,
    });




    if (error || !data || data.length === 0) {
      if (error) {
        console.warn(`[TenantService] Aviso na RPC get_public_tenant_branding para slug "${slug}":`, error.message);
      }
      return {
        ...FALLBACK_BRANDING,
        slug,
      };
    }

    const item = data[0];
    return {
      tenant_id: item.tenant_id,
      slug: item.slug,
      app_name: item.app_name || FALLBACK_BRANDING.app_name,
      logo_url: item.logo_url,
      splash_background: item.splash_background || FALLBACK_BRANDING.splash_background,
      splash_animation_type: item.splash_animation_type || FALLBACK_BRANDING.splash_animation_type,
      splash_duration_ms: item.splash_duration_ms || FALLBACK_BRANDING.splash_duration_ms,
      primary_color: item.primary_color || FALLBACK_BRANDING.primary_color,
      secondary_color: item.secondary_color || FALLBACK_BRANDING.secondary_color,
    };
  } catch (err) {
    console.warn('[TenantService] Erro ao carregar branding, aplicando contingência segura:', err);
    return {
      ...FALLBACK_BRANDING,
      slug,
    };
  }
}
