-- ==============================================================================
-- Migration: 20260927000002_create_tenant_branding.sql
-- Descrição: Criação da tabela tenant_branding, RLS deny-by-default e
--            função RPC pública segura get_public_tenant_branding com search_path vazio.
-- ==============================================================================

-- Tabela: tenant_branding
CREATE TABLE public.tenant_branding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    app_name TEXT NOT NULL DEFAULT 'Sistema de Refeições',
    logo_url TEXT,
    splash_background TEXT DEFAULT '#0f172a',
    splash_animation_type TEXT DEFAULT 'fade_pulse',
    splash_duration_ms INTEGER DEFAULT 1500,
    primary_color TEXT DEFAULT '#0284c7',
    secondary_color TEXT DEFAULT '#0f172a',
    report_logo_url TEXT,
    report_header_text TEXT,
    report_footer_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_tenant_branding_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT uq_tenant_branding_tenant UNIQUE (tenant_id),
    CONSTRAINT chk_splash_duration CHECK (splash_duration_ms BETWEEN 500 AND 2500),
    CONSTRAINT chk_animation_type CHECK (splash_animation_type IN ('fade_pulse', 'slide_up', 'zoom_in', 'none'))
);

-- Comentários descritivos
COMMENT ON TABLE public.tenant_branding IS 'Configuração de identidade visual e experiência de splash por tenant.';

-- Índice em tenant_id
CREATE INDEX idx_tenant_branding_tenant_id ON public.tenant_branding(tenant_id);

-- Trigger de updated_at
CREATE TRIGGER trg_tenant_branding_updated_at
BEFORE UPDATE ON public.tenant_branding
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: Ativar isolamento estrito (Sem policy pública direta de SELECT em tenant_branding)
ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- RPC Pública: get_public_tenant_branding
-- Superfície pública estrita e segura para carregamento pré-login de branding.
-- Executada com SECURITY DEFINER e search_path explicitamente vazio ('').
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_public_tenant_branding(p_slug TEXT)
RETURNS TABLE (
    tenant_id UUID,
    slug TEXT,
    app_name TEXT,
    logo_url TEXT,
    splash_background TEXT,
    splash_animation_type TEXT,
    splash_duration_ms INTEGER,
    primary_color TEXT,
    secondary_color TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT 
        t.id AS tenant_id,
        t.slug,
        tb.app_name,
        tb.logo_url,
        tb.splash_background,
        tb.splash_animation_type,
        tb.splash_duration_ms,
        tb.primary_color,
        tb.secondary_color
    FROM public.tenants t
    INNER JOIN public.tenant_branding tb ON tb.tenant_id = t.id
    WHERE lower(t.slug) = lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

-- Permissões na RPC: Exclusiva para anon e authenticated
REVOKE ALL ON FUNCTION public.get_public_tenant_branding(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding(TEXT) TO anon, authenticated;
