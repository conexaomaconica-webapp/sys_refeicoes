import { createBrowserClient } from '@/lib/supabase/client';
import type { PublicTenantBranding, UpdateTenantBrandingInput } from '@/types/tenant';

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
  app_name: 'MA Refeições',
  logo_url: null,
  splash_background: '#0f172a',
  splash_animation_type: 'fade_pulse',
  splash_duration_ms: 1200,
  primary_color: '#C5161D',
  secondary_color: '#7F1D1D',
  terminal_theme: 'light',
  terminal_primary_color: '#C5161D',
  terminal_accent_color: '#F4C430',
  terminal_surface_color: '#F3F4F6',
  terminal_show_kpi_values: true,
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
            terminal_theme: 'light' | 'dark';
            terminal_primary_color: string;
            terminal_accent_color: string;
            terminal_surface_color: string;
            terminal_show_kpi_values: boolean;
          }> | null;
          error: { message: string } | null;
        }>;
      }
    ).rpc('get_public_tenant_branding_v2', {
      p_slug: slug,
    });




    if (error || !data || data.length === 0) {
      if (error) {
        console.warn(`[TenantService] Aviso na RPC get_public_tenant_branding_v2 para slug "${slug}":`, error.message);
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
      terminal_theme: item.terminal_theme || FALLBACK_BRANDING.terminal_theme,
      terminal_primary_color: item.terminal_primary_color || FALLBACK_BRANDING.terminal_primary_color,
      terminal_accent_color: item.terminal_accent_color || FALLBACK_BRANDING.terminal_accent_color,
      terminal_surface_color: item.terminal_surface_color || FALLBACK_BRANDING.terminal_surface_color,
      terminal_show_kpi_values: item.terminal_show_kpi_values ?? FALLBACK_BRANDING.terminal_show_kpi_values,
    };
  } catch (err) {
    console.warn('[TenantService] Erro ao carregar branding, aplicando contingência segura:', err);
    return {
      ...FALLBACK_BRANDING,
      slug,
    };
  }
}

export async function updateTenantBrandingSettings(
  input: UpdateTenantBrandingInput
): Promise<PublicTenantBranding> {
  const supabase = createBrowserClient();
  const { data, error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_branding_settings', {
    p_app_name: input.app_name,
    p_logo_url: input.logo_url || '',
    p_primary_color: input.primary_color,
    p_secondary_color: input.secondary_color,
    p_terminal_theme: input.terminal_theme,
    p_terminal_primary_color: input.terminal_primary_color,
    p_terminal_accent_color: input.terminal_accent_color,
    p_terminal_surface_color: input.terminal_surface_color,
    p_terminal_show_kpi_values: input.terminal_show_kpi_values,
  });

  if (error) throw new Error(error.message || 'Não foi possível salvar a identidade visual.');
  return data as unknown as PublicTenantBranding;
}

export async function uploadTenantLogo(file: File): Promise<string> {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowedTypes.has(file.type)) {
    throw new Error('Formato não permitido. Use PNG, JPG ou WebP.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('A logomarca deve ter no máximo 2 MB.');
  }

  const supabase = createBrowserClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Sessão administrativa expirada. Entre novamente.');

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', user.id)
    .single();
  const profile = profileData as { tenant_id: string; role: string; status: string } | null;

  if (profileError || !profile || profile.status !== 'active' || profile.role !== 'admin_general') {
    throw new Error('Somente o administrador geral pode alterar a logomarca.');
  }

  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${profile.tenant_id}/logo-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from('tenant-branding')
    .upload(objectPath, file, { cacheControl: '3600', upsert: false, contentType: file.type });

  if (uploadError) throw new Error(uploadError.message || 'Não foi possível enviar a logomarca.');
  const { data } = supabase.storage.from('tenant-branding').getPublicUrl(objectPath);
  return data.publicUrl;
}
