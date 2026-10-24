import { createBrowserClient } from '@/lib/supabase/client';
import type {
  ConsumerCardBackgroundTransform,
  ConsumerCardElementPreferences,
  ConsumerCardLayout,
  LoginElementVisibility,
  LoginPanelPositions,
  PublicTenantBranding,
  UpdateTenantBrandingInput,
  UpdateTenantConsumerCardBrandingInput,
  UpdateTenantLoginBrandingInput,
  UpdateTenantTerminalPageBrandingInput,
} from '@/types/tenant';
import {
  DEFAULT_CONSUMER_CARD_BACKGROUND_TRANSFORM,
  DEFAULT_CONSUMER_CARD_ELEMENTS,
  DEFAULT_CONSUMER_CARD_LAYOUT,
  normalizeConsumerCardBackgroundTransform,
  normalizeConsumerCardElements,
  normalizeConsumerCardLayout,
} from '@/lib/consumer-card-layout';
import {
  DEFAULT_LOGIN_ELEMENT_VISIBILITY,
  DEFAULT_LOGIN_PANEL_POSITIONS,
  normalizeLoginElementVisibility,
  normalizeLoginPanelPositions,
} from '@/lib/login-branding';

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
  terminal_background_mode: 'none',
  terminal_background_preset: 'institutional',
  terminal_background_url: null,
  terminal_layout_variant: 'classic',
  staff_login_background_url: null,
  staff_login_mobile_background_url: null,
  consumer_login_background_url: null,
  consumer_login_mobile_background_url: null,
  consumer_card_background_mode: 'image',
  consumer_card_background_color: '#C5161D',
  consumer_card_accent_color: '#F4C430',
  consumer_card_background_url: '/branding/consumer-card-ma.jpg',
  consumer_card_layout: DEFAULT_CONSUMER_CARD_LAYOUT,
  consumer_card_elements: DEFAULT_CONSUMER_CARD_ELEMENTS,
  consumer_card_background_transform: DEFAULT_CONSUMER_CARD_BACKGROUND_TRANSFORM,
  login_element_visibility: DEFAULT_LOGIN_ELEMENT_VISIBILITY,
  login_panel_positions: DEFAULT_LOGIN_PANEL_POSITIONS,
  terminal_page_background_mode: 'image',
  terminal_page_background_color: '#F8FAFC',
  terminal_page_background_url: '/branding/terminal-ma-institutional.jpg',
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
    let { data, error } = await (
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
            terminal_background_mode: 'none' | 'preset' | 'image';
            terminal_background_preset: 'institutional' | 'warm' | 'nature' | 'geometric';
            terminal_background_url: string | null;
            terminal_layout_variant: 'classic' | 'operational_dashboard';
            staff_login_background_url?: string | null;
            staff_login_mobile_background_url?: string | null;
            consumer_login_background_url?: string | null;
            consumer_login_mobile_background_url?: string | null;
            consumer_card_background_mode?: 'color' | 'image';
            consumer_card_background_color?: string;
            consumer_card_accent_color?: string;
            consumer_card_background_url?: string | null;
            consumer_card_layout?: unknown;
            consumer_card_elements?: unknown;
            consumer_card_background_transform?: unknown;
            login_element_visibility?: unknown;
            login_panel_positions?: unknown;
            terminal_page_background_mode?: 'color' | 'image';
            terminal_page_background_color?: string;
            terminal_page_background_url?: string | null;
          }> | null;
          error: { message: string } | null;
        }>;
      }
    ).rpc('get_public_tenant_branding_v10', {
      p_slug: slug,
    });

    // Compatibilidade durante a janela entre o frontend e as migrations de branding.
    if (error) {
      const legacy = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_slug: string }
          ) => Promise<{ data: typeof data; error: { message: string } | null }>;
        }
      ).rpc('get_public_tenant_branding_v9', { p_slug: slug });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      const legacy = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_slug: string }
          ) => Promise<{ data: typeof data; error: { message: string } | null }>;
        }
      ).rpc('get_public_tenant_branding_v8', { p_slug: slug });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      const legacy = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_slug: string }
          ) => Promise<{ data: typeof data; error: { message: string } | null }>;
        }
      ).rpc('get_public_tenant_branding_v7', { p_slug: slug });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      const legacy = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_slug: string }
          ) => Promise<{ data: typeof data; error: { message: string } | null }>;
        }
      ).rpc('get_public_tenant_branding_v6', { p_slug: slug });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      const legacy = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_slug: string }
          ) => Promise<{ data: typeof data; error: { message: string } | null }>;
        }
      ).rpc('get_public_tenant_branding_v5', { p_slug: slug });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      const legacy = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_slug: string }
          ) => Promise<{ data: typeof data; error: { message: string } | null }>;
        }
      ).rpc('get_public_tenant_branding_v4', { p_slug: slug });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      const legacy = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_slug: string }
          ) => Promise<{ data: typeof data; error: { message: string } | null }>;
        }
      ).rpc('get_public_tenant_branding_v3', { p_slug: slug });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      const legacy = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_slug: string }
          ) => Promise<{ data: typeof data; error: { message: string } | null }>;
        }
      ).rpc('get_public_tenant_branding_v2', { p_slug: slug });
      data = legacy.data;
      error = legacy.error;
    }

    if (error || !data || data.length === 0) {
      if (error) {
        console.warn(`[TenantService] Aviso ao carregar branding público para slug "${slug}":`, error.message);
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
      terminal_background_mode: item.terminal_background_mode || FALLBACK_BRANDING.terminal_background_mode,
      terminal_background_preset: item.terminal_background_preset || FALLBACK_BRANDING.terminal_background_preset,
      terminal_background_url: item.terminal_background_url || null,
      terminal_layout_variant: item.terminal_layout_variant || FALLBACK_BRANDING.terminal_layout_variant,
      staff_login_background_url: item.staff_login_background_url || null,
      staff_login_mobile_background_url: item.staff_login_mobile_background_url || null,
      consumer_login_background_url: item.consumer_login_background_url || null,
      consumer_login_mobile_background_url: item.consumer_login_mobile_background_url || null,
      consumer_card_background_mode:
        item.consumer_card_background_mode || FALLBACK_BRANDING.consumer_card_background_mode,
      consumer_card_background_color:
        item.consumer_card_background_color || FALLBACK_BRANDING.consumer_card_background_color,
      consumer_card_accent_color:
        item.consumer_card_accent_color || FALLBACK_BRANDING.consumer_card_accent_color,
      consumer_card_background_url:
        item.consumer_card_background_url || FALLBACK_BRANDING.consumer_card_background_url,
      consumer_card_layout: normalizeConsumerCardLayout(item.consumer_card_layout),
      consumer_card_elements: normalizeConsumerCardElements(item.consumer_card_elements),
      consumer_card_background_transform: normalizeConsumerCardBackgroundTransform(
        item.consumer_card_background_transform
      ),
      login_element_visibility: normalizeLoginElementVisibility(item.login_element_visibility),
      login_panel_positions: normalizeLoginPanelPositions(item.login_panel_positions),
      terminal_page_background_mode:
        item.terminal_page_background_mode || FALLBACK_BRANDING.terminal_page_background_mode,
      terminal_page_background_color:
        item.terminal_page_background_color || FALLBACK_BRANDING.terminal_page_background_color,
      terminal_page_background_url:
        item.terminal_page_background_url || FALLBACK_BRANDING.terminal_page_background_url,
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

export async function updateTenantTerminalBackground(input: {
  mode: 'none' | 'preset' | 'image';
  preset: 'institutional' | 'warm' | 'nature' | 'geometric';
  url: string | null;
}): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_terminal_background', {
    p_background_mode: input.mode,
    p_background_preset: input.preset,
    p_background_url: input.url || '',
  });

  if (error) throw new Error(error.message || 'Não foi possível salvar o fundo do terminal.');
}

export async function updateTenantLoginBranding(
  input: UpdateTenantLoginBrandingInput
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_login_branding', {
    p_staff_background_url: input.staff_login_background_url || '',
    p_staff_mobile_background_url: input.staff_login_mobile_background_url || '',
    p_consumer_background_url: input.consumer_login_background_url || '',
    p_consumer_mobile_background_url: input.consumer_login_mobile_background_url || '',
  });

  if (error) {
    throw new Error(error.message || 'Não foi possível salvar os fundos dos portais.');
  }
}

export async function updateTenantConsumerCardBranding(
  input: UpdateTenantConsumerCardBrandingInput
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_consumer_card_branding', {
    p_background_mode: input.consumer_card_background_mode,
    p_background_color: input.consumer_card_background_color,
    p_accent_color: input.consumer_card_accent_color,
    p_background_url: input.consumer_card_background_url || '',
  });

  if (error) {
    throw new Error(error.message || 'NÃ£o foi possÃ­vel salvar a aparÃªncia da carteirinha.');
  }
}

export async function updateTenantConsumerCardLayout(
  layout: ConsumerCardLayout
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_consumer_card_layout', {
    p_layout: normalizeConsumerCardLayout(layout),
  });

  if (error) {
    throw new Error(error.message || 'Não foi possível salvar a posição dos elementos da carteirinha.');
  }
}

export async function updateTenantConsumerCardElements(
  elements: ConsumerCardElementPreferences
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_consumer_card_elements', {
    p_elements: normalizeConsumerCardElements(elements),
  });

  if (error) {
    throw new Error(error.message || 'Não foi possível salvar a exibição dos elementos da carteirinha.');
  }
}

export async function updateTenantLoginElementVisibility(
  visibility: LoginElementVisibility
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_login_element_visibility', {
    p_visibility: normalizeLoginElementVisibility(visibility),
  });

  if (error) {
    throw new Error(error.message || 'Não foi possível salvar os elementos das páginas de login.');
  }
}

export async function updateTenantLoginPanelPositions(
  positions: LoginPanelPositions
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_login_panel_positions', {
    p_positions: normalizeLoginPanelPositions(positions),
  });

  if (error) {
    throw new Error(error.message || 'Não foi possível salvar a posição das caixas de login.');
  }
}

export async function updateTenantConsumerCardBackgroundTransform(
  transform: ConsumerCardBackgroundTransform
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_consumer_card_background_transform', {
    p_transform: normalizeConsumerCardBackgroundTransform(transform),
  });

  if (error) {
    throw new Error(error.message || 'Não foi possível salvar o enquadramento da imagem.');
  }
}

export async function updateTenantTerminalPageBranding(
  input: UpdateTenantTerminalPageBrandingInput
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_terminal_page_background', {
    p_background_mode: input.terminal_page_background_mode,
    p_background_color: input.terminal_page_background_color,
    p_background_url: input.terminal_page_background_url || '',
  });

  if (error) {
    throw new Error(error.message || 'NÃ£o foi possÃ­vel salvar o fundo completo do terminal.');
  }
}

export async function updateTenantTerminalLayout(
  layout: 'classic' | 'operational_dashboard'
): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('update_tenant_terminal_layout', {
    p_layout_variant: layout,
  });

  if (error) throw new Error(error.message || 'Não foi possível salvar o layout do terminal.');
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

export async function uploadTenantTerminalBackground(file: File): Promise<string> {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowedTypes.has(file.type)) {
    throw new Error('Formato não permitido. Use PNG, JPG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('A imagem de fundo deve ter no máximo 5 MB.');
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
    throw new Error('Somente o administrador geral pode alterar o fundo do terminal.');
  }

  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${profile.tenant_id}/terminal-background-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from('tenant-branding')
    .upload(objectPath, file, { cacheControl: '3600', upsert: false, contentType: file.type });

  if (uploadError) throw new Error(uploadError.message || 'Não foi possível enviar a imagem de fundo.');
  const { data } = supabase.storage.from('tenant-branding').getPublicUrl(objectPath);
  return data.publicUrl;
}

export async function uploadTenantConsumerCardBackground(file: File): Promise<string> {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowedTypes.has(file.type)) {
    throw new Error('Formato nÃ£o permitido. Use PNG, JPG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('A imagem da carteirinha deve ter no mÃ¡ximo 5 MB.');
  }

  const supabase = createBrowserClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('SessÃ£o Master expirada. Entre novamente.');

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', user.id)
    .single();
  const profile = profileData as { tenant_id: string; role: string; status: string } | null;

  if (
    profileError ||
    !profile ||
    profile.status !== 'active' ||
    profile.role !== 'admin_general'
  ) {
    throw new Error('Somente o usuÃ¡rio Master pode alterar a carteirinha.');
  }

  const extension =
    file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${profile.tenant_id}/consumer-card-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from('tenant-branding')
    .upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'NÃ£o foi possÃ­vel enviar o fundo da carteirinha.');
  }
  const { data } = supabase.storage.from('tenant-branding').getPublicUrl(objectPath);
  return data.publicUrl;
}

export async function uploadTenantTerminalPageBackground(file: File): Promise<string> {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowedTypes.has(file.type)) {
    throw new Error('Formato nÃ£o permitido. Use PNG, JPG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('A imagem da pÃ¡gina do terminal deve ter no mÃ¡ximo 5 MB.');
  }

  const supabase = createBrowserClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('SessÃ£o Master expirada. Entre novamente.');

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', user.id)
    .single();
  const profile = profileData as { tenant_id: string; role: string; status: string } | null;
  if (
    profileError ||
    !profile ||
    profile.status !== 'active' ||
    profile.role !== 'admin_general'
  ) {
    throw new Error('Somente o usuÃ¡rio Master pode alterar o fundo completo do terminal.');
  }

  const extension =
    file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${profile.tenant_id}/terminal-page-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from('tenant-branding')
    .upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });
  if (uploadError) {
    throw new Error(uploadError.message || 'NÃ£o foi possÃ­vel enviar o fundo completo do terminal.');
  }
  const { data } = supabase.storage.from('tenant-branding').getPublicUrl(objectPath);
  return data.publicUrl;
}

export type LoginBackgroundTarget =
  | 'staff-desktop'
  | 'staff-mobile'
  | 'consumer-desktop'
  | 'consumer-mobile';

export async function uploadTenantLoginBackground(
  file: File,
  target: LoginBackgroundTarget
): Promise<string> {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowedTypes.has(file.type)) {
    throw new Error('Formato não permitido. Use PNG, JPG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Cada imagem de login deve ter no máximo 5 MB.');
  }

  const supabase = createBrowserClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('Sessão Master expirada. Entre novamente.');
  }

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', user.id)
    .single();
  const profile = profileData as { tenant_id: string; role: string; status: string } | null;

  if (
    profileError ||
    !profile ||
    profile.status !== 'active' ||
    profile.role !== 'admin_general'
  ) {
    throw new Error('Somente o usuário Master pode alterar as telas de login.');
  }

  const extension =
    file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${profile.tenant_id}/login-${target}-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from('tenant-branding')
    .upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Não foi possível enviar a imagem de login.');
  }
  const { data } = supabase.storage.from('tenant-branding').getPublicUrl(objectPath);
  return data.publicUrl;
}
