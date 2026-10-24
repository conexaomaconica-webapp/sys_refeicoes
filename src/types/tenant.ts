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

export type TerminalBackgroundMode = 'none' | 'preset' | 'image';
export type TerminalBackgroundPreset = 'institutional' | 'warm' | 'nature' | 'geometric';
export type TerminalLayoutVariant = 'classic' | 'operational_dashboard';
export type ConsumerCardBackgroundMode = 'color' | 'image';
export type TerminalPageBackgroundMode = 'color' | 'image';
export type ConsumerCardLayoutElement = 'logo' | 'title' | 'qr' | 'photo' | 'name' | 'status' | 'balance';
export type ConsumerCardElement = ConsumerCardLayoutElement;
export interface ConsumerCardPosition {
  x: number;
  y: number;
}
export type ConsumerCardLayout = Record<ConsumerCardLayoutElement, ConsumerCardPosition>;
export interface ConsumerCardElementPreference {
  visible: boolean;
  zoom: number;
}
export type ConsumerCardElementPreferences = Record<ConsumerCardElement, ConsumerCardElementPreference>;
export interface ConsumerCardBackgroundTransform {
  x: number;
  y: number;
  zoom: number;
}
export type LoginBrandingElement = 'logo' | 'title' | 'description' | 'marketing' | 'access_links' | 'portal_switch' | 'security_badge';
export type LoginElementVisibility = Record<LoginBrandingElement, boolean>;
export type LoginPanelPositionTarget = 'staff_desktop' | 'staff_mobile' | 'consumer_desktop' | 'consumer_mobile';
export type LoginPanelPositions = Record<LoginPanelPositionTarget, ConsumerCardPosition>;

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
  terminal_theme?: 'light' | 'dark';
  terminal_primary_color?: string | null;
  terminal_accent_color?: string | null;
  terminal_surface_color?: string | null;
  terminal_show_kpi_values?: boolean;
  terminal_background_mode?: TerminalBackgroundMode;
  terminal_background_preset?: TerminalBackgroundPreset;
  terminal_background_url?: string | null;
  terminal_layout_variant?: TerminalLayoutVariant;
  staff_login_background_url?: string | null;
  staff_login_mobile_background_url?: string | null;
  consumer_login_background_url?: string | null;
  consumer_login_mobile_background_url?: string | null;
  consumer_card_background_mode?: ConsumerCardBackgroundMode;
  consumer_card_background_color?: string;
  consumer_card_accent_color?: string;
  consumer_card_background_url?: string | null;
  consumer_card_layout?: ConsumerCardLayout;
  consumer_card_elements?: ConsumerCardElementPreferences;
  consumer_card_background_transform?: ConsumerCardBackgroundTransform;
  login_element_visibility?: LoginElementVisibility;
  login_panel_positions?: LoginPanelPositions;
  terminal_page_background_mode?: TerminalPageBackgroundMode;
  terminal_page_background_color?: string;
  terminal_page_background_url?: string | null;
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
  terminal_theme: 'light' | 'dark';
  terminal_primary_color: string;
  terminal_accent_color: string;
  terminal_surface_color: string;
  terminal_show_kpi_values: boolean;
  terminal_background_mode: TerminalBackgroundMode;
  terminal_background_preset: TerminalBackgroundPreset;
  terminal_background_url: string | null;
  terminal_layout_variant: TerminalLayoutVariant;
  staff_login_background_url: string | null;
  staff_login_mobile_background_url: string | null;
  consumer_login_background_url: string | null;
  consumer_login_mobile_background_url: string | null;
  consumer_card_background_mode: ConsumerCardBackgroundMode;
  consumer_card_background_color: string;
  consumer_card_accent_color: string;
  consumer_card_background_url: string | null;
  consumer_card_layout: ConsumerCardLayout;
  consumer_card_elements: ConsumerCardElementPreferences;
  consumer_card_background_transform: ConsumerCardBackgroundTransform;
  login_element_visibility: LoginElementVisibility;
  login_panel_positions: LoginPanelPositions;
  terminal_page_background_mode: TerminalPageBackgroundMode;
  terminal_page_background_color: string;
  terminal_page_background_url: string | null;
}

export interface UpdateTenantBrandingInput {
  app_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  terminal_theme: 'light' | 'dark';
  terminal_primary_color: string;
  terminal_accent_color: string;
  terminal_surface_color: string;
  terminal_show_kpi_values: boolean;
  terminal_background_mode: TerminalBackgroundMode;
  terminal_background_preset: TerminalBackgroundPreset;
  terminal_background_url: string | null;
  terminal_layout_variant: TerminalLayoutVariant;
}

export interface UpdateTenantLoginBrandingInput {
  staff_login_background_url: string | null;
  staff_login_mobile_background_url: string | null;
  consumer_login_background_url: string | null;
  consumer_login_mobile_background_url: string | null;
}

export interface UpdateTenantConsumerCardBrandingInput {
  consumer_card_background_mode: ConsumerCardBackgroundMode;
  consumer_card_background_color: string;
  consumer_card_accent_color: string;
  consumer_card_background_url: string | null;
}

export interface UpdateTenantTerminalPageBrandingInput {
  terminal_page_background_mode: TerminalPageBackgroundMode;
  terminal_page_background_color: string;
  terminal_page_background_url: string | null;
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
