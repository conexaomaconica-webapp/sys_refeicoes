-- Posicionamento configuravel dos elementos visuais da carteirinha.
-- Migration aditiva: nao remove colunas, dados, policies ou funcoes anteriores.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS consumer_card_layout JSONB NOT NULL DEFAULT
    '{"logo":{"x":22,"y":7},"title":{"x":76,"y":9},"qr":{"x":50,"y":35},"photo":{"x":20,"y":67},"name":{"x":61,"y":68},"balance":{"x":50,"y":84}}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint
         WHERE conname = 'chk_tenant_branding_consumer_card_layout_object'
    ) THEN
        ALTER TABLE public.tenant_branding
            ADD CONSTRAINT chk_tenant_branding_consumer_card_layout_object
            CHECK (pg_catalog.jsonb_typeof(consumer_card_layout) = 'object');
    END IF;
END;
$$;

COMMENT ON COLUMN public.tenant_branding.consumer_card_layout
IS 'Coordenadas percentuais X/Y de logo, titulo, QR, foto, nome e saldo da carteirinha virtual.';

CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v7(p_slug TEXT)
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
        tb.terminal_page_background_mode,
        tb.terminal_page_background_color,
        tb.terminal_page_background_url
    FROM public.tenants AS t
    JOIN public.tenant_branding AS tb ON tb.tenant_id = t.id
    WHERE pg_catalog.lower(t.slug) = pg_catalog.lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v7(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v7(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_consumer_card_layout(p_layout JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile RECORD;
    v_branding public.tenant_branding%ROWTYPE;
    v_element TEXT;
    v_x NUMERIC;
    v_y NUMERIC;
BEGIN
    SELECT id, tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = auth.uid();

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou inativo.';
    END IF;

    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode reposicionar a carteirinha.';
    END IF;

    IF p_layout IS NULL OR pg_catalog.jsonb_typeof(p_layout) <> 'object' THEN
        RAISE EXCEPTION 'Layout da carteirinha invalido.';
    END IF;

    FOREACH v_element IN ARRAY ARRAY['logo', 'title', 'qr', 'photo', 'name', 'balance']
    LOOP
        IF pg_catalog.jsonb_typeof(p_layout -> v_element) <> 'object'
           OR pg_catalog.jsonb_typeof(p_layout #> ARRAY[v_element, 'x']) <> 'number'
           OR pg_catalog.jsonb_typeof(p_layout #> ARRAY[v_element, 'y']) <> 'number' THEN
            RAISE EXCEPTION 'Posicao invalida para o elemento %.', v_element;
        END IF;

        v_x := (p_layout #>> ARRAY[v_element, 'x'])::NUMERIC;
        v_y := (p_layout #>> ARRAY[v_element, 'y'])::NUMERIC;
        IF v_x < 0 OR v_x > 100 OR v_y < 0 OR v_y > 100 THEN
            RAISE EXCEPTION 'As coordenadas de % devem estar entre 0 e 100.', v_element;
        END IF;
    END LOOP;

    UPDATE public.tenant_branding
       SET consumer_card_layout = pg_catalog.jsonb_build_object(
               'logo', p_layout -> 'logo',
               'title', p_layout -> 'title',
               'qr', p_layout -> 'qr',
               'photo', p_layout -> 'photo',
               'name', p_layout -> 'name',
               'balance', p_layout -> 'balance'
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

REVOKE ALL ON FUNCTION public.update_tenant_consumer_card_layout(JSONB)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_consumer_card_layout(JSONB)
TO authenticated;
