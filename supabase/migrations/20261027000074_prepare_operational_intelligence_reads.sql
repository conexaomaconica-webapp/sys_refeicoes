-- Etapas 7D.1/7D.2: contrato read-only dos indicadores operacionais.
-- Migration preparada localmente. Nao aplicar sem reconciliacao de schema,
-- homologacao em staging e autorizacao expressa.

CREATE OR REPLACE FUNCTION public.get_operational_intelligence_v1(
    p_period_start DATE,
    p_period_end DATE,
    p_previous_start DATE,
    p_previous_end DATE,
    p_institution_ids UUID[] DEFAULT NULL,
    p_unit_ids UUID[] DEFAULT NULL,
    p_category_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_profile RECORD;
    v_duration INTEGER;
    v_result JSONB;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
    END IF;

    SELECT profile.id, profile.tenant_id, profile.role, profile.status
      INTO v_profile
      FROM public.profiles AS profile
     WHERE profile.id = v_uid;

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN (
        'admin_general',
        'operations_director',
        'finance',
        'supervisor',
        'unit_manager',
        'institution_user'
    ) THEN
        RAISE EXCEPTION 'OPERATIONAL_INTELLIGENCE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF p_period_start IS NULL OR p_period_end IS NULL
       OR p_previous_start IS NULL OR p_previous_end IS NULL
       OR p_period_end <= p_period_start
       OR p_previous_end <= p_previous_start THEN
        RAISE EXCEPTION 'INVALID_PERIOD' USING ERRCODE = '22023';
    END IF;

    v_duration := p_period_end - p_period_start;
    IF v_duration > 366 OR (p_previous_end - p_previous_start) <> v_duration THEN
        RAISE EXCEPTION 'PERIODS_MUST_HAVE_EQUAL_DURATION' USING ERRCODE = '22023';
    END IF;

    IF coalesce(cardinality(p_institution_ids), 1) = 0
       OR coalesce(cardinality(p_unit_ids), 1) = 0
       OR coalesce(cardinality(p_category_ids), 1) = 0
       OR cardinality(p_institution_ids) > 100
       OR cardinality(p_unit_ids) > 100
       OR cardinality(p_category_ids) > 100 THEN
        RAISE EXCEPTION 'INVALID_FILTER_SET' USING ERRCODE = '22023';
    END IF;

    -- Escopos locais precisam possuir ao menos uma atribuicao explicita.
    IF v_profile.role IN ('supervisor', 'unit_manager') AND NOT EXISTS (
        SELECT 1
          FROM public.user_unit_access AS unit_access
         WHERE unit_access.user_id = v_profile.id
           AND unit_access.tenant_id = v_profile.tenant_id
    ) THEN
        RAISE EXCEPTION 'UNIT_SCOPE_REQUIRED' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role = 'institution_user' AND NOT EXISTS (
        SELECT 1
          FROM public.user_institution_access AS institution_access
         WHERE institution_access.user_id = v_profile.id
           AND institution_access.tenant_id = v_profile.tenant_id
    ) THEN
        RAISE EXCEPTION 'INSTITUTION_SCOPE_REQUIRED' USING ERRCODE = '42501';
    END IF;

    -- Todo filtro institucional solicitado deve estar integralmente autorizado.
    IF p_institution_ids IS NOT NULL AND EXISTS (
        SELECT 1
          FROM unnest(p_institution_ids) AS requested(institution_id)
         WHERE NOT EXISTS (
            SELECT 1
              FROM public.institutions AS institution
             WHERE institution.id = requested.institution_id
               AND institution.tenant_id = v_profile.tenant_id
               AND (
                    v_profile.role IN ('admin_general', 'operations_director', 'finance')
                    OR (
                        v_profile.role IN ('supervisor', 'unit_manager')
                        AND EXISTS (
                            SELECT 1
                              FROM public.user_unit_access AS unit_access
                              JOIN public.units AS scoped_unit
                                ON scoped_unit.id = unit_access.unit_id
                               AND scoped_unit.tenant_id = unit_access.tenant_id
                             WHERE unit_access.user_id = v_profile.id
                               AND unit_access.tenant_id = v_profile.tenant_id
                               AND scoped_unit.institution_id = institution.id
                        )
                    )
                    OR (
                        v_profile.role = 'institution_user'
                        AND EXISTS (
                            SELECT 1
                              FROM public.user_institution_access AS institution_access
                             WHERE institution_access.user_id = v_profile.id
                               AND institution_access.tenant_id = v_profile.tenant_id
                               AND institution_access.institution_id = institution.id
                        )
                    )
               )
         )
    ) THEN
        RAISE EXCEPTION 'INSTITUTION_SCOPE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Todo filtro de unidade solicitado deve estar integralmente autorizado.
    IF p_unit_ids IS NOT NULL AND EXISTS (
        SELECT 1
          FROM unnest(p_unit_ids) AS requested(unit_id)
         WHERE NOT EXISTS (
            SELECT 1
              FROM public.units AS unit
             WHERE unit.id = requested.unit_id
               AND unit.tenant_id = v_profile.tenant_id
               AND (
                    v_profile.role IN ('admin_general', 'operations_director', 'finance')
                    OR (
                        v_profile.role IN ('supervisor', 'unit_manager')
                        AND EXISTS (
                            SELECT 1
                              FROM public.user_unit_access AS unit_access
                             WHERE unit_access.user_id = v_profile.id
                               AND unit_access.tenant_id = v_profile.tenant_id
                               AND unit_access.unit_id = unit.id
                        )
                    )
                    OR (
                        v_profile.role = 'institution_user'
                        AND EXISTS (
                            SELECT 1
                              FROM public.user_institution_access AS institution_access
                             WHERE institution_access.user_id = v_profile.id
                               AND institution_access.tenant_id = v_profile.tenant_id
                               AND institution_access.institution_id = unit.institution_id
                        )
                    )
               )
         )
    ) THEN
        RAISE EXCEPTION 'UNIT_SCOPE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Categorias de outro tenant ou inexistentes sao recusadas, nao ignoradas.
    IF p_category_ids IS NOT NULL AND EXISTS (
        SELECT 1
          FROM unnest(p_category_ids) AS requested(category_id)
         WHERE NOT EXISTS (
            SELECT 1
              FROM public.student_categories AS category
             WHERE category.id = requested.category_id
               AND category.tenant_id = v_profile.tenant_id
         )
    ) THEN
        RAISE EXCEPTION 'CATEGORY_SCOPE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    WITH authorized_units AS (
        SELECT unit.id, unit.institution_id, unit.name
          FROM public.units AS unit
         WHERE unit.tenant_id = v_profile.tenant_id
           AND (
                v_profile.role IN ('admin_general', 'operations_director', 'finance')
                OR (
                    v_profile.role IN ('supervisor', 'unit_manager')
                    AND EXISTS (
                        SELECT 1
                          FROM public.user_unit_access AS unit_access
                         WHERE unit_access.user_id = v_profile.id
                           AND unit_access.tenant_id = v_profile.tenant_id
                           AND unit_access.unit_id = unit.id
                    )
                )
                OR (
                    v_profile.role = 'institution_user'
                    AND EXISTS (
                        SELECT 1
                          FROM public.user_institution_access AS institution_access
                         WHERE institution_access.user_id = v_profile.id
                           AND institution_access.tenant_id = v_profile.tenant_id
                           AND institution_access.institution_id = unit.institution_id
                    )
                )
           )
    ),
    selected_units AS (
        SELECT unit.id, unit.institution_id, unit.name
          FROM authorized_units AS unit
         WHERE (p_institution_ids IS NULL OR unit.institution_id = ANY(p_institution_ids))
           AND (p_unit_ids IS NULL OR unit.id = ANY(p_unit_ids))
    ),
    scoped_counts AS (
        SELECT consumption.unit_id,
               consumption.category_id,
               count(*) FILTER (
                   WHERE consumption.consumption_date >= p_period_start
                     AND consumption.consumption_date < p_period_end
               )::BIGINT AS current_total,
               count(*) FILTER (
                   WHERE consumption.consumption_date >= p_previous_start
                     AND consumption.consumption_date < p_previous_end
               )::BIGINT AS previous_total
          FROM public.meal_consumptions AS consumption
          JOIN selected_units AS unit ON unit.id = consumption.unit_id
         WHERE consumption.tenant_id = v_profile.tenant_id
           AND consumption.status IN ('approved', 'financially_refunded')
           AND (
                (consumption.consumption_date >= p_period_start AND consumption.consumption_date < p_period_end)
                OR
                (consumption.consumption_date >= p_previous_start AND consumption.consumption_date < p_previous_end)
           )
           AND (p_category_ids IS NULL OR consumption.category_id = ANY(p_category_ids))
         GROUP BY consumption.unit_id, consumption.category_id
    ),
    totals AS (
        SELECT coalesce(sum(current_total), 0)::BIGINT AS current_total,
               coalesce(sum(previous_total), 0)::BIGINT AS previous_total
          FROM scoped_counts
    ),
    counts_by_unit AS (
        SELECT unit_id,
               sum(current_total)::BIGINT AS current_total,
               sum(previous_total)::BIGINT AS previous_total
          FROM scoped_counts
         GROUP BY unit_id
    ),
    unit_totals AS (
        SELECT unit.id,
               unit.institution_id,
               unit.name,
               coalesce(consumption.current_total, 0)::BIGINT AS current_total,
               coalesce(consumption.previous_total, 0)::BIGINT AS previous_total
          FROM selected_units AS unit
          LEFT JOIN counts_by_unit AS consumption ON consumption.unit_id = unit.id
    ),
    category_totals AS (
        SELECT category.id,
               category.code,
               category.name,
               sum(consumption.current_total)::BIGINT AS current_total
          FROM scoped_counts AS consumption
          JOIN public.student_categories AS category
            ON category.id = consumption.category_id
           AND category.tenant_id = v_profile.tenant_id
         WHERE consumption.current_total > 0
         GROUP BY category.id, category.code, category.name
    )
    SELECT jsonb_build_object(
        'schema_version', 'stage7d-operational-v1',
        'generated_at', clock_timestamp(),
        'periods', jsonb_build_object(
            'current', jsonb_build_object('start_date', p_period_start, 'end_date_exclusive', p_period_end),
            'previous', jsonb_build_object('start_date', p_previous_start, 'end_date_exclusive', p_previous_end)
        ),
        'applied_scope', jsonb_build_object(
            'institution_ids', coalesce((SELECT jsonb_agg(DISTINCT institution_id ORDER BY institution_id) FROM selected_units), '[]'::JSONB),
            'unit_ids', coalesce((SELECT jsonb_agg(id ORDER BY id) FROM selected_units), '[]'::JSONB),
            'category_ids', coalesce(to_jsonb(p_category_ids), '[]'::JSONB)
        ),
        'meals_served', totals.current_total,
        'volume_by_unit', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'unit_id', unit.id,
                'institution_id', unit.institution_id,
                'unit_name', unit.name,
                'meals_served', unit.current_total,
                'previous_meals_served', unit.previous_total,
                'variation_percent', CASE
                    WHEN unit.previous_total = 0 THEN NULL
                    ELSE round(((unit.current_total - unit.previous_total) * 100.0) / unit.previous_total, 2)
                END
            ) ORDER BY unit.current_total DESC, unit.name)
              FROM unit_totals AS unit
        ), '[]'::JSONB),
        'utilization_by_category', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'category_id', category.id,
                'category_code', category.code,
                'category_name', category.name,
                'meals_served', category.current_total,
                'percentage', CASE
                    WHEN totals.current_total = 0 THEN 0
                    ELSE round((category.current_total * 100.0) / totals.current_total, 2)
                END
            ) ORDER BY category.current_total DESC, category.name)
              FROM category_totals AS category
        ), '[]'::JSONB),
        'period_comparison', jsonb_build_object(
            'current_meals_served', totals.current_total,
            'previous_meals_served', totals.previous_total,
            'variation_percent', CASE
                WHEN totals.previous_total = 0 THEN NULL
                ELSE round(((totals.current_total - totals.previous_total) * 100.0) / totals.previous_total, 2)
            END
        )
    )
      INTO v_result
      FROM totals;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_operational_intelligence_v1(DATE, DATE, DATE, DATE, UUID[], UUID[], UUID[])
IS 'Agrega somente indicadores operacionais de refeicoes, com tenant derivado de auth.uid e escopo institucional/unidade fail-closed.';

REVOKE ALL ON FUNCTION public.get_operational_intelligence_v1(DATE, DATE, DATE, DATE, UUID[], UUID[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_operational_intelligence_v1(DATE, DATE, DATE, DATE, UUID[], UUID[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_operational_intelligence_v1(DATE, DATE, DATE, DATE, UUID[], UUID[], UUID[]) TO authenticated;
