-- Personalizacao visual da carteirinha do consumidor.
-- Migration estritamente aditiva: preserva dados, RLS e regras financeiras.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS consumer_card_background_mode TEXT NOT NULL DEFAULT 'image',
    ADD COLUMN IF NOT EXISTS consumer_card_background_color TEXT NOT NULL DEFAULT '#C5161D',
    ADD COLUMN IF NOT EXISTS consumer_card_accent_color TEXT NOT NULL DEFAULT '#F4C430',
    ADD COLUMN IF NOT EXISTS consumer_card_background_url TEXT DEFAULT '/branding/consumer-card-ma.jpg',
    ADD COLUMN IF NOT EXISTS terminal_page_background_mode TEXT NOT NULL DEFAULT 'image',
    ADD COLUMN IF NOT EXISTS terminal_page_background_color TEXT NOT NULL DEFAULT '#F8FAFC',
    ADD COLUMN IF NOT EXISTS terminal_page_background_url TEXT DEFAULT '/branding/terminal-ma-institutional.jpg';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'chk_tenant_branding_consumer_card_background_mode'
    ) THEN
        ALTER TABLE public.tenant_branding
            ADD CONSTRAINT chk_tenant_branding_consumer_card_background_mode
            CHECK (consumer_card_background_mode IN ('color', 'image'));
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'chk_tenant_branding_terminal_page_background_mode'
    ) THEN
        ALTER TABLE public.tenant_branding
            ADD CONSTRAINT chk_tenant_branding_terminal_page_background_mode
            CHECK (terminal_page_background_mode IN ('color', 'image'));
    END IF;
END;
$$;

COMMENT ON COLUMN public.tenant_branding.consumer_card_background_mode
IS 'Fundo da carteirinha: cor solida ou imagem.';
COMMENT ON COLUMN public.tenant_branding.consumer_card_background_color
IS 'Cor hexadecimal usada quando a carteirinha esta no modo cor.';
COMMENT ON COLUMN public.tenant_branding.consumer_card_accent_color
IS 'Cor hexadecimal dos destaques da carteirinha.';
COMMENT ON COLUMN public.tenant_branding.consumer_card_background_url
IS 'Imagem de fundo da carteirinha; os dados pessoais permanecem dinamicos.';
COMMENT ON COLUMN public.tenant_branding.terminal_page_background_mode
IS 'Fundo da pagina completa do terminal: cor solida ou imagem.';
COMMENT ON COLUMN public.tenant_branding.terminal_page_background_color
IS 'Cor hexadecimal da pagina completa do terminal.';
COMMENT ON COLUMN public.tenant_branding.terminal_page_background_url
IS 'Imagem da pagina completa do terminal, separada do fundo da area operacional.';

CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v6(p_slug TEXT)
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
        tb.terminal_page_background_mode,
        tb.terminal_page_background_color,
        tb.terminal_page_background_url
    FROM public.tenants AS t
    JOIN public.tenant_branding AS tb ON tb.tenant_id = t.id
    WHERE pg_catalog.lower(t.slug) = pg_catalog.lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v6(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v6(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_consumer_card_branding(
    p_background_mode TEXT,
    p_background_color TEXT,
    p_accent_color TEXT,
    p_background_url TEXT
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

    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode alterar a carteirinha.';
    END IF;

    IF p_background_mode NOT IN ('color', 'image') THEN
        RAISE EXCEPTION 'Modo de fundo da carteirinha invalido.';
    END IF;

    IF p_background_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_accent_color !~ '^#[0-9A-Fa-f]{6}$' THEN
        RAISE EXCEPTION 'As cores da carteirinha devem usar o formato hexadecimal #RRGGBB.';
    END IF;

    IF pg_catalog.length(COALESCE(p_background_url, '')) > 2048 THEN
        RAISE EXCEPTION 'URL de fundo da carteirinha muito longa.';
    END IF;

    IF p_background_mode = 'image' AND pg_catalog.btrim(COALESCE(p_background_url, '')) = '' THEN
        RAISE EXCEPTION 'Escolha uma imagem para o fundo da carteirinha.';
    END IF;

    UPDATE public.tenant_branding
       SET consumer_card_background_mode = p_background_mode,
           consumer_card_background_color = pg_catalog.upper(p_background_color),
           consumer_card_accent_color = pg_catalog.upper(p_accent_color),
           consumer_card_background_url = NULLIF(pg_catalog.btrim(p_background_url), ''),
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;

    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_consumer_card_branding(TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_consumer_card_branding(TEXT, TEXT, TEXT, TEXT)
TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_terminal_page_background(
    p_background_mode TEXT,
    p_background_color TEXT,
    p_background_url TEXT
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

    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o usuario Master pode alterar o fundo completo do terminal.';
    END IF;

    IF p_background_mode NOT IN ('color', 'image') THEN
        RAISE EXCEPTION 'Modo de fundo da pagina do terminal invalido.';
    END IF;

    IF p_background_color !~ '^#[0-9A-Fa-f]{6}$' THEN
        RAISE EXCEPTION 'A cor deve usar o formato hexadecimal #RRGGBB.';
    END IF;

    IF pg_catalog.length(COALESCE(p_background_url, '')) > 2048 THEN
        RAISE EXCEPTION 'URL de fundo da pagina do terminal muito longa.';
    END IF;

    IF p_background_mode = 'image' AND pg_catalog.btrim(COALESCE(p_background_url, '')) = '' THEN
        RAISE EXCEPTION 'Escolha uma imagem para a pagina completa do terminal.';
    END IF;

    UPDATE public.tenant_branding
       SET terminal_page_background_mode = p_background_mode,
           terminal_page_background_color = pg_catalog.upper(p_background_color),
           terminal_page_background_url = NULLIF(pg_catalog.btrim(p_background_url), ''),
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;

    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_terminal_page_background(TEXT, TEXT, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_terminal_page_background(TEXT, TEXT, TEXT)
TO authenticated;
