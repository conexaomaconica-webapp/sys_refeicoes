-- Personalizacao dos portais de acesso interno e do consumidor.
-- Migration estritamente aditiva: preserva dados, RLS e configuracoes atuais.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS staff_login_background_url TEXT,
    ADD COLUMN IF NOT EXISTS staff_login_mobile_background_url TEXT,
    ADD COLUMN IF NOT EXISTS consumer_login_background_url TEXT,
    ADD COLUMN IF NOT EXISTS consumer_login_mobile_background_url TEXT;

COMMENT ON COLUMN public.tenant_branding.staff_login_background_url
IS 'Imagem horizontal do login de administradores e operadores.';
COMMENT ON COLUMN public.tenant_branding.staff_login_mobile_background_url
IS 'Imagem vertical opcional do login interno em telas moveis.';
COMMENT ON COLUMN public.tenant_branding.consumer_login_background_url
IS 'Imagem horizontal do login do consumidor.';
COMMENT ON COLUMN public.tenant_branding.consumer_login_mobile_background_url
IS 'Imagem vertical opcional do login do consumidor em telas moveis.';

-- A superficie publica contem apenas identidade visual necessaria antes do login.
CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v5(p_slug TEXT)
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
    terminal_layout_variant TEXT,
    staff_login_background_url TEXT,
    staff_login_mobile_background_url TEXT,
    consumer_login_background_url TEXT,
    consumer_login_mobile_background_url TEXT
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
        tb.terminal_layout_variant,
        tb.staff_login_background_url,
        tb.staff_login_mobile_background_url,
        tb.consumer_login_background_url,
        tb.consumer_login_mobile_background_url
    FROM public.tenants AS t
    JOIN public.tenant_branding AS tb ON tb.tenant_id = t.id
    WHERE pg_catalog.lower(t.slug) = pg_catalog.lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v5(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v5(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_login_branding(
    p_staff_background_url TEXT,
    p_staff_mobile_background_url TEXT,
    p_consumer_background_url TEXT,
    p_consumer_mobile_background_url TEXT
)
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

    -- admin_general e o perfil Master previsto na matriz atual.
    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode alterar os portais de login.';
    END IF;

    IF pg_catalog.length(COALESCE(p_staff_background_url, '')) > 2048
       OR pg_catalog.length(COALESCE(p_staff_mobile_background_url, '')) > 2048
       OR pg_catalog.length(COALESCE(p_consumer_background_url, '')) > 2048
       OR pg_catalog.length(COALESCE(p_consumer_mobile_background_url, '')) > 2048 THEN
        RAISE EXCEPTION 'URL de imagem de login muito longa.';
    END IF;

    UPDATE public.tenant_branding
       SET staff_login_background_url = NULLIF(pg_catalog.btrim(p_staff_background_url), ''),
           staff_login_mobile_background_url = NULLIF(pg_catalog.btrim(p_staff_mobile_background_url), ''),
           consumer_login_background_url = NULLIF(pg_catalog.btrim(p_consumer_background_url), ''),
           consumer_login_mobile_background_url = NULLIF(pg_catalog.btrim(p_consumer_mobile_background_url), ''),
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;

    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_login_branding(TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_login_branding(TEXT, TEXT, TEXT, TEXT)
TO authenticated;
