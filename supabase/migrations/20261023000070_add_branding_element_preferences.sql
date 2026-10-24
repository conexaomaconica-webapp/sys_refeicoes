-- Visibilidade e escala dos elementos da carteirinha e visibilidade dos portais de login.
-- Migration aditiva: preserva dados existentes, RLS e funcoes publicadas anteriormente.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS consumer_card_elements JSONB NOT NULL DEFAULT
    '{"logo":{"visible":true,"zoom":100},"title":{"visible":true,"zoom":100},"qr":{"visible":true,"zoom":100},"photo":{"visible":true,"zoom":100},"name":{"visible":true,"zoom":100},"status":{"visible":true,"zoom":100},"balance":{"visible":true,"zoom":100}}'::jsonb,
    ADD COLUMN IF NOT EXISTS login_element_visibility JSONB NOT NULL DEFAULT
    '{"logo":true,"title":true,"description":true,"marketing":true,"access_links":true,"portal_switch":true,"security_badge":true}'::jsonb;

COMMENT ON COLUMN public.tenant_branding.consumer_card_elements
IS 'Visibilidade e zoom percentual dos elementos dinamicos da carteirinha virtual.';
COMMENT ON COLUMN public.tenant_branding.login_element_visibility
IS 'Visibilidade dos elementos decorativos compartilhados pelos portais de login.';

CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v9(p_slug TEXT)
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
    consumer_card_elements JSONB,
    consumer_card_background_transform JSONB,
    login_element_visibility JSONB,
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
        t.id, t.slug, tb.app_name, tb.logo_url, tb.splash_background,
        tb.splash_animation_type, tb.splash_duration_ms, tb.primary_color,
        tb.secondary_color, tb.terminal_theme, tb.terminal_primary_color,
        tb.terminal_accent_color, tb.terminal_surface_color,
        tb.terminal_show_kpi_values, tb.terminal_background_mode,
        tb.terminal_background_preset, tb.terminal_background_url,
        tb.terminal_layout_variant, tb.staff_login_background_url,
        tb.staff_login_mobile_background_url, tb.consumer_login_background_url,
        tb.consumer_login_mobile_background_url, tb.consumer_card_background_mode,
        tb.consumer_card_background_color, tb.consumer_card_accent_color,
        tb.consumer_card_background_url, tb.consumer_card_layout,
        tb.consumer_card_elements, tb.consumer_card_background_transform,
        tb.login_element_visibility, tb.terminal_page_background_mode,
        tb.terminal_page_background_color, tb.terminal_page_background_url
    FROM public.tenants AS t
    JOIN public.tenant_branding AS tb ON tb.tenant_id = t.id
    WHERE pg_catalog.lower(t.slug) = pg_catalog.lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v9(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v9(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_consumer_card_elements(p_elements JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile RECORD;
    v_branding public.tenant_branding%ROWTYPE;
    v_element TEXT;
    v_zoom NUMERIC;
BEGIN
    SELECT id, tenant_id, role, status INTO v_profile
      FROM public.profiles WHERE id = auth.uid();

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou inativo.';
    END IF;
    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode configurar os elementos da carteirinha.';
    END IF;
    IF p_elements IS NULL OR pg_catalog.jsonb_typeof(p_elements) <> 'object' THEN
        RAISE EXCEPTION 'Configuracao dos elementos da carteirinha invalida.';
    END IF;

    FOREACH v_element IN ARRAY ARRAY['logo', 'title', 'qr', 'photo', 'name', 'status', 'balance']
    LOOP
        IF pg_catalog.jsonb_typeof(p_elements -> v_element) <> 'object'
           OR pg_catalog.jsonb_typeof(p_elements #> ARRAY[v_element, 'visible']) <> 'boolean'
           OR pg_catalog.jsonb_typeof(p_elements #> ARRAY[v_element, 'zoom']) <> 'number' THEN
            RAISE EXCEPTION 'Configuracao invalida para o elemento %.', v_element;
        END IF;
        v_zoom := (p_elements #>> ARRAY[v_element, 'zoom'])::NUMERIC;
        IF v_zoom < 50 OR v_zoom > 200 THEN
            RAISE EXCEPTION 'O zoom de % deve estar entre 50 e 200 por cento.', v_element;
        END IF;
    END LOOP;

    UPDATE public.tenant_branding
       SET consumer_card_elements = p_elements,
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;
    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_consumer_card_elements(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_consumer_card_elements(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_login_element_visibility(p_visibility JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile RECORD;
    v_branding public.tenant_branding%ROWTYPE;
    v_element TEXT;
BEGIN
    SELECT id, tenant_id, role, status INTO v_profile
      FROM public.profiles WHERE id = auth.uid();

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou inativo.';
    END IF;
    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode configurar os elementos dos portais.';
    END IF;
    IF p_visibility IS NULL OR pg_catalog.jsonb_typeof(p_visibility) <> 'object' THEN
        RAISE EXCEPTION 'Configuracao dos portais invalida.';
    END IF;

    FOREACH v_element IN ARRAY ARRAY['logo', 'title', 'description', 'marketing', 'access_links', 'portal_switch', 'security_badge']
    LOOP
        IF pg_catalog.jsonb_typeof(p_visibility -> v_element) <> 'boolean' THEN
            RAISE EXCEPTION 'Visibilidade invalida para o elemento %.', v_element;
        END IF;
    END LOOP;

    UPDATE public.tenant_branding
       SET login_element_visibility = p_visibility,
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;
    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_login_element_visibility(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_login_element_visibility(JSONB) TO authenticated;

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
    SELECT id, tenant_id, role, status INTO v_profile
      FROM public.profiles WHERE id = auth.uid();

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou inativo.';
    END IF;
    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode reposicionar a carteirinha.';
    END IF;
    IF p_layout IS NULL OR pg_catalog.jsonb_typeof(p_layout) <> 'object' THEN
        RAISE EXCEPTION 'Layout da carteirinha invalido.';
    END IF;

    FOREACH v_element IN ARRAY ARRAY['logo', 'title', 'qr', 'photo', 'name', 'status', 'balance']
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
       SET consumer_card_layout = p_layout,
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;
    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_consumer_card_layout(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_consumer_card_layout(JSONB) TO authenticated;
