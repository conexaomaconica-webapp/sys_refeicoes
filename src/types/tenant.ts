/**
-- ==============================================================================
-- Entidades de Domínio — Sprint 1: Fundação SaaS e Branding
-- ==============================================================================
*/

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  legal_name?: string | null;
  document?: string | null;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface TenantBranding {
  id: string;
  tenant_id: string;
  app_name: string;
  logo_url?: string | null;
  splash_background?: string | null;
  splash_animation_type?: 'fade_pulse' | 'slide_up' | 'zoom_in' | 'none';
  splash_duration_ms?: number;
  primary_color?: string | null;
  secondary_color?: string | null;
  report_logo_url?: string | null;
  report_header_text?: string | null;
  report_footer_text?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Superfície pública e segura de branding consumida no pré-login via RPC get_public_tenant_branding.
 * Não expõe dados administrativos, contratos ou informações fiscais.
 */
export interface PublicTenantBranding {
  tenant_id: string;
  slug: string;
  app_name: string;
  logo_url: string | null;
  splash_background: string | null;
  splash_animation_type: 'fade_pulse' | 'slide_up' | 'zoom_in' | 'none' | null;
  splash_duration_ms: number | null;
  primary_color: string | null;
  secondary_color: string | null;
}

export interface Institution {
  id: string;
  tenant_id: string;
  name: string;
  short_name?: string | null;
  document?: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface Unit {
  id: string;
  tenant_id: string;
  institution_id: string;
  name: string;
  city: string;
  state: string;
  timezone: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}
