-- Enquadramento configuravel da imagem de fundo da carteirinha.
-- Migration aditiva: preserva dados, RLS e funcoes publicadas anteriormente.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS consumer_card_background_transform JSONB NOT NULL DEFAULT
    '{"x":50,"y":50,"zoom":100}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint
         WHERE conname = 'chk_tenant_branding_consumer_card_background_transform_object'
    ) THEN
        ALTER TABLE public.tenant_branding
            ADD CONSTRAINT chk_tenant_branding_consumer_card_background_transform_object
            CHECK (pg_catalog.jsonb_typeof(consumer_card_background_transform) = 'object');
    END IF;
END;
$$;

COMMENT ON COLUMN public.tenant_branding.consumer_card_background_transform
IS 'Posicao X/Y e zoom percentual da imagem de fundo da carteirinha virtual.';

CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v8(p_slug TEXT)
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
    consumer_login_mobile_background_url TEXT,
    consumer_card_background_mode TEXT,
    consumer_card_background_color TEXT,
    consumer_card_accent_color TEXT,
    consumer_card_background_url TEXT,
    consumer_card_layout JSONB,
    consumer_card_background_transform JSONB,
    terminal_page_background_mode TEXT,
    terminal_page_background_color TEXT,
    terminal_page_background_url TEXT
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
        tb.consumer_login_mobile_background_url,
        tb.consumer_card_background_mode,
        tb.consumer_card_background_color,
        tb.consumer_card_accent_color,
        tb.consumer_card_background_url,
        tb.consumer_card_layout,
        tb.consumer_card_background_transform,
        tb.terminal_page_background_mode,
        tb.terminal_page_background_color,
        tb.terminal_page_background_url
    FROM public.tenants AS t
    JOIN public.tenant_branding AS tb ON tb.tenant_id = t.id
    WHERE pg_catalog.lower(t.slug) = pg_catalog.lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v8(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v8(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_consumer_card_background_transform(
    p_transform JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile RECORD;
    v_branding public.tenant_branding%ROWTYPE;
    v_x NUMERIC;
    v_y NUMERIC;
    v_zoom NUMERIC;
BEGIN
    SELECT id, tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = auth.uid();

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou inativo.';
    END IF;

    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode enquadrar a imagem da carteirinha.';
    END IF;

    IF p_transform IS NULL
       OR pg_catalog.jsonb_typeof(p_transform) <> 'object'
       OR pg_catalog.jsonb_typeof(p_transform -> 'x') <> 'number'
       OR pg_catalog.jsonb_typeof(p_transform -> 'y') <> 'number'
       OR pg_catalog.jsonb_typeof(p_transform -> 'zoom') <> 'number' THEN
        RAISE EXCEPTION 'Enquadramento da imagem invalido.';
    END IF;

    v_x := (p_transform ->> 'x')::NUMERIC;
    v_y := (p_transform ->> 'y')::NUMERIC;
    v_zoom := (p_transform ->> 'zoom')::NUMERIC;

    IF v_x < 0 OR v_x > 100 OR v_y < 0 OR v_y > 100 THEN
        RAISE EXCEPTION 'A posicao da imagem deve estar entre 0 e 100.';
    END IF;
    IF v_zoom < 100 OR v_zoom > 200 THEN
        RAISE EXCEPTION 'A ampliacao da imagem deve estar entre 100 e 200 por cento.';
    END IF;

    UPDATE public.tenant_branding
       SET consumer_card_background_transform = pg_catalog.jsonb_build_object(
               'x', v_x,
               'y', v_y,
               'zoom', v_zoom
           ),
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;

    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_consumer_card_background_transform(JSONB)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_consumer_card_background_transform(JSONB)
TO authenticated;
