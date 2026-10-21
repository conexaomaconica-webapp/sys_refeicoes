-- Variante visual selecionavel do terminal.
-- Migration estritamente aditiva; preserva o layout atual como padrao.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS terminal_layout_variant TEXT NOT NULL DEFAULT 'classic';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_tenant_branding_terminal_layout_variant'
          AND conrelid = 'public.tenant_branding'::regclass
    ) THEN
        ALTER TABLE public.tenant_branding
            ADD CONSTRAINT chk_tenant_branding_terminal_layout_variant
            CHECK (terminal_layout_variant IN ('classic', 'operational_dashboard'));
    END IF;
END $$;

COMMENT ON COLUMN public.tenant_branding.terminal_layout_variant
IS 'Layout do terminal: classic ou operational_dashboard.';

CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v4(p_slug TEXT)
RETURNS TABLE (
    tenant_id UUID,
    slug TEXT,
    app_name TEXT,
    logo_url TEXT,
    splash_background TEXT,
    splash_animation_type TEXT,
    splash_duration_ms INTEGER,
    primary_color TEXT,
    secondary_color TEXT,
    terminal_theme TEXT,
    terminal_primary_color TEXT,
    terminal_accent_color TEXT,
    terminal_surface_color TEXT,
    terminal_show_kpi_values BOOLEAN,
    terminal_background_mode TEXT,
    terminal_background_preset TEXT,
    terminal_background_url TEXT,
    terminal_layout_variant TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        t.id,
        t.slug,
        tb.app_name,
        tb.logo_url,
        tb.splash_background,
        tb.splash_animation_type,
        tb.splash_duration_ms,
        tb.primary_color,
        tb.secondary_color,
        tb.terminal_theme,
        tb.terminal_primary_color,
        tb.terminal_accent_color,
        tb.terminal_surface_color,
        tb.terminal_show_kpi_values,
        tb.terminal_background_mode,
        tb.terminal_background_preset,
        tb.terminal_background_url,
        tb.terminal_layout_variant
    FROM public.tenants AS t
    JOIN public.tenant_branding AS tb ON tb.tenant_id = t.id
    WHERE pg_catalog.lower(t.slug) = pg_catalog.lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v4(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v4(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_terminal_layout(p_layout_variant TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile RECORD;
    v_branding public.tenant_branding%ROWTYPE;
BEGIN
    SELECT id, tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = auth.uid();

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou inativo.';
    END IF;

    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o administrador geral pode alterar o layout do terminal.';
    END IF;

    IF p_layout_variant NOT IN ('classic', 'operational_dashboard') THEN
        RAISE EXCEPTION 'Layout de terminal invalido.';
    END IF;

    UPDATE public.tenant_branding
       SET terminal_layout_variant = p_layout_variant,
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;

    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_terminal_layout(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_terminal_layout(TEXT) TO authenticated;
