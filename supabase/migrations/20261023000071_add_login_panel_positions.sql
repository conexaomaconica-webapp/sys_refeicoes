-- Posicionamento responsivo das caixas dos portais de login.
-- Migration aditiva: preserva dados, RLS e funcoes anteriores.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS login_panel_positions JSONB NOT NULL DEFAULT
    '{"staff_desktop":{"x":78,"y":50},"staff_mobile":{"x":50,"y":50},"consumer_desktop":{"x":78,"y":50},"consumer_mobile":{"x":50,"y":66}}'::jsonb;

COMMENT ON COLUMN public.tenant_branding.login_panel_positions
IS 'Coordenadas percentuais X/Y da caixa de login por portal e breakpoint.';

CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v10(p_slug TEXT)
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
    login_panel_positions JSONB,
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
        tb.login_element_visibility, tb.login_panel_positions,
        tb.terminal_page_background_mode, tb.terminal_page_background_color,
        tb.terminal_page_background_url
    FROM public.tenants AS t
    JOIN public.tenant_branding AS tb ON tb.tenant_id = t.id
    WHERE pg_catalog.lower(t.slug) = pg_catalog.lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v10(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v10(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_login_panel_positions(p_positions JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile RECORD;
    v_branding public.tenant_branding%ROWTYPE;
    v_target TEXT;
    v_x NUMERIC;
    v_y NUMERIC;
BEGIN
    SELECT id, tenant_id, role, status INTO v_profile
      FROM public.profiles WHERE id = auth.uid();

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou inativo.';
    END IF;
    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode posicionar as caixas de login.';
    END IF;
    IF p_positions IS NULL OR pg_catalog.jsonb_typeof(p_positions) <> 'object' THEN
        RAISE EXCEPTION 'Posicoes das caixas de login invalidas.';
    END IF;

    FOREACH v_target IN ARRAY ARRAY['staff_desktop', 'staff_mobile', 'consumer_desktop', 'consumer_mobile']
    LOOP
        IF pg_catalog.jsonb_typeof(p_positions -> v_target) <> 'object'
           OR pg_catalog.jsonb_typeof(p_positions #> ARRAY[v_target, 'x']) <> 'number'
           OR pg_catalog.jsonb_typeof(p_positions #> ARRAY[v_target, 'y']) <> 'number' THEN
            RAISE EXCEPTION 'Posicao invalida para %.', v_target;
        END IF;
        v_x := (p_positions #>> ARRAY[v_target, 'x'])::NUMERIC;
        v_y := (p_positions #>> ARRAY[v_target, 'y'])::NUMERIC;
        IF v_x < 8 OR v_x > 92 OR v_y < 8 OR v_y > 92 THEN
            RAISE EXCEPTION 'As coordenadas de % devem estar entre 8 e 92.', v_target;
        END IF;
    END LOOP;

    UPDATE public.tenant_branding
       SET login_panel_positions = p_positions,
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;
    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_login_panel_positions(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_login_panel_positions(JSONB) TO authenticated;
