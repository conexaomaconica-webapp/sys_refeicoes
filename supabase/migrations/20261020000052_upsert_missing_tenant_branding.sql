-- Reconcilia identidades visuais ausentes e torna o salvamento autocorretivo.
-- Migration aditiva, idempotente e sem alteração nas políticas RLS existentes.

INSERT INTO public.tenant_branding (
    tenant_id,
    app_name,
    primary_color,
    secondary_color,
    terminal_theme,
    terminal_primary_color,
    terminal_accent_color,
    terminal_surface_color,
    terminal_show_kpi_values
)
SELECT
    t.id,
    t.name,
    '#C5161D',
    '#7F1D1D',
    'light',
    '#C5161D',
    '#F4C430',
    '#F3F4F6',
    TRUE
FROM public.tenants AS t
WHERE NOT EXISTS (
    SELECT 1
    FROM public.tenant_branding AS tb
    WHERE tb.tenant_id = t.id
)
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.update_tenant_branding_settings(
    p_app_name TEXT,
    p_logo_url TEXT,
    p_primary_color TEXT,
    p_secondary_color TEXT,
    p_terminal_theme TEXT,
    p_terminal_primary_color TEXT,
    p_terminal_accent_color TEXT,
    p_terminal_surface_color TEXT,
    p_terminal_show_kpi_values BOOLEAN
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
        RAISE EXCEPTION 'Somente o administrador geral pode alterar a identidade visual.';
    END IF;

    IF p_terminal_theme NOT IN ('light', 'dark') THEN
        RAISE EXCEPTION 'Tema de terminal invalido.';
    END IF;

    IF p_app_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_app_name)) < 2 THEN
        RAISE EXCEPTION 'Nome da aplicacao invalido.';
    END IF;

    IF p_primary_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_secondary_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_terminal_primary_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_terminal_accent_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_terminal_surface_color !~ '^#[0-9A-Fa-f]{6}$' THEN
        RAISE EXCEPTION 'As cores devem estar no formato hexadecimal #RRGGBB.';
    END IF;

    INSERT INTO public.tenant_branding (
        tenant_id,
        app_name,
        logo_url,
        primary_color,
        secondary_color,
        terminal_theme,
        terminal_primary_color,
        terminal_accent_color,
        terminal_surface_color,
        terminal_show_kpi_values
    ) VALUES (
        v_profile.tenant_id,
        pg_catalog.btrim(p_app_name),
        NULLIF(pg_catalog.btrim(p_logo_url), ''),
        pg_catalog.upper(p_primary_color),
        pg_catalog.upper(p_secondary_color),
        p_terminal_theme,
        pg_catalog.upper(p_terminal_primary_color),
        pg_catalog.upper(p_terminal_accent_color),
        pg_catalog.upper(p_terminal_surface_color),
        p_terminal_show_kpi_values
    )
    ON CONFLICT (tenant_id) DO UPDATE
       SET app_name = EXCLUDED.app_name,
           logo_url = EXCLUDED.logo_url,
           primary_color = EXCLUDED.primary_color,
           secondary_color = EXCLUDED.secondary_color,
           terminal_theme = EXCLUDED.terminal_theme,
           terminal_primary_color = EXCLUDED.terminal_primary_color,
           terminal_accent_color = EXCLUDED.terminal_accent_color,
           terminal_surface_color = EXCLUDED.terminal_surface_color,
           terminal_show_kpi_values = EXCLUDED.terminal_show_kpi_values,
           updated_at = pg_catalog.now()
    RETURNING * INTO v_branding;

    RETURN pg_catalog.to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_branding_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_tenant_branding_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
TO authenticated;
