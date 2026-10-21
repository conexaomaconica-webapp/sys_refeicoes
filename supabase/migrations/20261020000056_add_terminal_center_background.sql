-- Fundo opcional da area central do terminal.
-- Migration estritamente aditiva: preserva RLS, RPCs anteriores e dados existentes.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS terminal_background_mode TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS terminal_background_preset TEXT NOT NULL DEFAULT 'institutional',
    ADD COLUMN IF NOT EXISTS terminal_background_url TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_tenant_branding_terminal_background_mode'
          AND conrelid = 'public.tenant_branding'::regclass
    ) THEN
        ALTER TABLE public.tenant_branding
            ADD CONSTRAINT chk_tenant_branding_terminal_background_mode
            CHECK (terminal_background_mode IN ('none', 'preset', 'image'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_tenant_branding_terminal_background_preset'
          AND conrelid = 'public.tenant_branding'::regclass
    ) THEN
        ALTER TABLE public.tenant_branding
            ADD CONSTRAINT chk_tenant_branding_terminal_background_preset
            CHECK (terminal_background_preset IN ('institutional', 'warm', 'nature', 'geometric'));
    END IF;
END $$;

COMMENT ON COLUMN public.tenant_branding.terminal_background_mode
IS 'Fundo da area central do terminal: none, preset ou image.';
COMMENT ON COLUMN public.tenant_branding.terminal_background_preset
IS 'Tema visual predefinido da area central do terminal.';
COMMENT ON COLUMN public.tenant_branding.terminal_background_url
IS 'URL publica opcional da imagem de fundo enviada pelo administrador geral.';

-- Fotos de fundo podem ser maiores que logomarcas; os tipos permitidos e as
-- politicas de isolamento do bucket permanecem inalterados.
UPDATE storage.buckets
   SET file_size_limit = GREATEST(
       COALESCE(file_size_limit, 0::BIGINT),
       5242880::BIGINT
   )
 WHERE id = 'tenant-branding';

CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v3(p_slug TEXT)
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
    terminal_background_url TEXT
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
        tb.terminal_background_url
    FROM public.tenants AS t
    JOIN public.tenant_branding AS tb ON tb.tenant_id = t.id
    WHERE pg_catalog.lower(t.slug) = pg_catalog.lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v3(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v3(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_terminal_background(
    p_background_mode TEXT,
    p_background_preset TEXT,
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
        RAISE EXCEPTION 'Somente o administrador geral pode alterar o fundo do terminal.';
    END IF;

    IF p_background_mode NOT IN ('none', 'preset', 'image') THEN
        RAISE EXCEPTION 'Modo de fundo do terminal invalido.';
    END IF;

    IF p_background_preset NOT IN ('institutional', 'warm', 'nature', 'geometric') THEN
        RAISE EXCEPTION 'Tema de fundo do terminal invalido.';
    END IF;

    IF p_background_mode = 'image'
       AND NULLIF(pg_catalog.btrim(p_background_url), '') IS NULL THEN
        RAISE EXCEPTION 'Envie uma imagem antes de selecionar o fundo personalizado.';
    END IF;

    IF pg_catalog.length(COALESCE(p_background_url, '')) > 2048 THEN
        RAISE EXCEPTION 'URL da imagem de fundo muito longa.';
    END IF;

    UPDATE public.tenant_branding
       SET terminal_background_mode = p_background_mode,
           terminal_background_preset = p_background_preset,
           terminal_background_url = NULLIF(pg_catalog.btrim(p_background_url), ''),
           updated_at = pg_catalog.now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;

    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_terminal_background(TEXT, TEXT, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_terminal_background(TEXT, TEXT, TEXT)
TO authenticated;
