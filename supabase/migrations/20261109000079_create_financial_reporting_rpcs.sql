-- ==============================================================================
-- Migration: 20261109000079_create_financial_reporting_rpcs.sql
-- Descrição: Sprint 15 (Revisada na Sprint 17) - Relatórios Fiscais, Subsídios
--            e Faturamento Consolidado com segregação contábil estrita,
--            search_path = '', filtros por instituição em contingência/custódia
--            e status canônicos ('confirmed').
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_consolidated_financial_report(
    p_tenant_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_institution_id UUID DEFAULT NULL,
    p_unit_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL
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
    v_total_meals INT := 0;
    v_gross_meal_amount NUMERIC(14,2) := 0.00;
    v_total_subsidy_amount NUMERIC(14,2) := 0.00;
    v_student_paid_amount NUMERIC(14,2) := 0.00;
    v_total_recharges_amount NUMERIC(14,2) := 0.00;
    v_total_custody_balance NUMERIC(14,2) := 0.00;
    v_total_gateway_fees NUMERIC(14,2) := 0.00;

    -- Contingência da Sprint 13
    v_contingency_meals INT := 0;
    v_contingency_gross NUMERIC(14,2) := 0.00;
    v_contingency_subsidy NUMERIC(14,2) := 0.00;

    v_category_breakdown JSONB;
    v_unit_breakdown JSONB;
    v_contingency_breakdown JSONB;
    v_result JSONB;
BEGIN
    -- 1. Verificação de Autenticação e Perfil Ativo
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação necessária.' USING ERRCODE = '42501';
    END IF;

    SELECT id, tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = v_uid;

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil ativo obrigatório.' USING ERRCODE = '42501';
    END IF;

    -- Papéis com acesso financeiro e gerencial
    IF v_profile.role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem permissão para acessar relatórios fiscais.' USING ERRCODE = '42501';
    END IF;

    -- Restrição de tenant
    IF v_profile.tenant_id <> p_tenant_id THEN
        RAISE EXCEPTION 'TENANT_MISMATCH: Acesso negado a dados de outro tenant.' USING ERRCODE = '42501';
    END IF;

    -- Validação de escopo estrito de unidade para gerentes locais e supervisores
    IF v_profile.role IN ('unit_manager', 'supervisor') THEN
        IF p_unit_id IS NULL THEN
            RAISE EXCEPTION 'UNIT_SCOPE_REQUIRED: Gestores locais devem obrigatoriamente especificar uma unidade autorizada.' USING ERRCODE = '42501';
        END IF;
        IF NOT public.has_unit_access(p_unit_id) THEN
            RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem permissão para acessar esta unidade.' USING ERRCODE = '42501';
        END IF;
    ELSIF p_unit_id IS NOT NULL AND NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem permissão para acessar esta unidade.' USING ERRCODE = '42501';
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'INVALID_DATE_RANGE: Período de apuração inválido.' USING ERRCODE = '22023';
    END IF;

    -- 2. Apuração Consolidada de Consumo de Refeições
    SELECT
        COUNT(*)::INT,
        COALESCE(SUM(mc.full_price), 0.00),
        COALESCE(SUM(mc.subsidy_amount), 0.00),
        COALESCE(SUM(mc.student_price), 0.00)
      INTO
        v_total_meals,
        v_gross_meal_amount,
        v_total_subsidy_amount,
        v_student_paid_amount
      FROM public.meal_consumptions mc
     WHERE mc.tenant_id = p_tenant_id
       AND mc.consumption_date >= p_start_date
       AND mc.consumption_date <= p_end_date
       AND mc.status IN ('approved', 'financially_refunded')
       AND (p_institution_id IS NULL OR mc.institution_id = p_institution_id)
       AND (p_unit_id IS NULL OR mc.unit_id = p_unit_id)
       AND (p_category_id IS NULL OR mc.category_id = p_category_id);

    -- 3. Apuração de Lotes de Contingência Aprovados (Sprint 13)
    -- Filtra corretamente por instituição via vínculo com units
    SELECT
        COALESCE(SUM(cmb.total_meals_served), 0)::INT,
        COALESCE(SUM(cmb.total_amount), 0.00),
        COALESCE(SUM(cmb.total_subsidy_amount), 0.00)
      INTO
        v_contingency_meals,
        v_contingency_gross,
        v_contingency_subsidy
      FROM public.contingency_meal_batches cmb
      JOIN public.units u_cmb ON u_cmb.id = cmb.unit_id AND u_cmb.tenant_id = cmb.tenant_id
     WHERE cmb.tenant_id = p_tenant_id
       AND cmb.service_date >= p_start_date
       AND cmb.service_date <= p_end_date
       AND cmb.status = 'approved'
       AND (p_institution_id IS NULL OR u_cmb.institution_id = p_institution_id)
       AND (p_unit_id IS NULL OR cmb.unit_id = p_unit_id)
       AND (p_category_id IS NULL OR cmb.category_id = p_category_id);

    -- 4. Apuração de Recargas Confirmadas e Passivo Real de Custódia no Período
    -- (Apenas perfis globais do tenant têm visibilidade do passivo de custódia total)
    IF v_profile.role IN ('admin_general', 'operations_director', 'finance') THEN
        -- Recargas efetivamente confirmadas no período (status canônico 'confirmed')
        SELECT COALESCE(SUM(r.amount), 0.00)
          INTO v_total_recharges_amount
          FROM public.recharges r
          JOIN public.students s_r ON s_r.id = r.student_id AND s_r.tenant_id = r.tenant_id
         WHERE r.tenant_id = p_tenant_id
           AND COALESCE(r.confirmed_at, r.created_at)::DATE >= p_start_date
           AND COALESCE(r.confirmed_at, r.created_at)::DATE <= p_end_date
           AND r.status = 'confirmed'
           AND (p_institution_id IS NULL OR s_r.institution_id = p_institution_id);

        -- Saldo total efetivamente sob custódia nas carteiras dos comensais
        SELECT COALESCE(SUM(w.balance), 0.00)
          INTO v_total_custody_balance
          FROM public.wallets w
          JOIN public.students s ON s.id = w.student_id AND s.tenant_id = w.tenant_id
         WHERE w.tenant_id = p_tenant_id
           AND s.status = 'active'
           AND (p_institution_id IS NULL OR s.institution_id = p_institution_id);

        -- Taxas de gateway registradas no raw_response (quando informadas pelo provedor)
        SELECT COALESCE(SUM(
            CASE
                WHEN (p.raw_response->>'fee') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN (p.raw_response->>'fee')::NUMERIC(14,2)
                ELSE 0.00
            END
        ), 0.00)
          INTO v_total_gateway_fees
          FROM public.payments p
          JOIN public.students s_p ON s_p.id = p.student_id AND s_p.tenant_id = p.tenant_id
         WHERE p.tenant_id = p_tenant_id
           AND COALESCE(p.confirmed_at, p.created_at)::DATE >= p_start_date
           AND COALESCE(p.confirmed_at, p.created_at)::DATE <= p_end_date
           AND p.status = 'confirmed'
           AND (p_institution_id IS NULL OR s_p.institution_id = p_institution_id);
    END IF;

    -- 5. Detalhamento por Categoria de Comensal
    WITH cat_stats AS (
        SELECT
            sc.id AS category_id,
            sc.name AS category_name,
            sc.code AS category_code,
            (sc.code = 'integral') AS is_integral,
            COUNT(mc.id)::INT AS meals_count,
            COALESCE(SUM(mc.full_price), 0.00) AS gross_amount,
            COALESCE(SUM(mc.subsidy_amount), 0.00) AS subsidy_amount,
            COALESCE(SUM(mc.student_price), 0.00) AS student_paid_amount
          FROM public.meal_consumptions mc
          JOIN public.student_categories sc ON sc.id = mc.category_id
         WHERE mc.tenant_id = p_tenant_id
           AND mc.consumption_date >= p_start_date
           AND mc.consumption_date <= p_end_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_institution_id IS NULL OR mc.institution_id = p_institution_id)
           AND (p_unit_id IS NULL OR mc.unit_id = p_unit_id)
           AND (p_category_id IS NULL OR mc.category_id = p_category_id)
         GROUP BY sc.id, sc.name, sc.code
         ORDER BY gross_amount DESC
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'category_id', category_id,
                'category_name', category_name,
                'category_code', category_code,
                'is_integral', is_integral,
                'meals_count', meals_count,
                'gross_amount', gross_amount,
                'subsidy_amount', subsidy_amount,
                'student_paid_amount', student_paid_amount
            )
        ),
        '[]'::jsonb
    )
    INTO v_category_breakdown
    FROM cat_stats;

    -- 6. Detalhamento por Unidade / Restaurante
    WITH unit_stats AS (
        SELECT
            u.id AS unit_id,
            u.name AS unit_name,
            i.name AS institution_name,
            COUNT(mc.id)::INT AS meals_count,
            COALESCE(SUM(mc.full_price), 0.00) AS gross_amount,
            COALESCE(SUM(mc.subsidy_amount), 0.00) AS subsidy_amount,
            COALESCE(SUM(mc.student_price), 0.00) AS student_paid_amount
          FROM public.units u
          JOIN public.institutions i ON i.id = u.institution_id
          LEFT JOIN public.meal_consumptions mc
            ON mc.unit_id = u.id
           AND mc.consumption_date >= p_start_date
           AND mc.consumption_date <= p_end_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_category_id IS NULL OR mc.category_id = p_category_id)
         WHERE u.tenant_id = p_tenant_id
           AND (p_institution_id IS NULL OR u.institution_id = p_institution_id)
           AND (p_unit_id IS NULL OR u.id = p_unit_id)
         GROUP BY u.id, u.name, i.name
         ORDER BY gross_amount DESC
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'unit_id', unit_id,
                'unit_name', unit_name,
                'institution_name', institution_name,
                'meals_count', meals_count,
                'gross_amount', gross_amount,
                'subsidy_amount', subsidy_amount,
                'student_paid_amount', student_paid_amount
            )
        ),
        '[]'::jsonb
    )
    INTO v_unit_breakdown
    FROM unit_stats;

    -- 7. Lotes de Contingência Aprovados no Período
    WITH contingency_stats AS (
        SELECT
            cmb.id,
            u.name AS unit_name,
            mt.name AS meal_type_name,
            cmb.service_date,
            cmb.batch_type,
            cmb.total_meals_served,
            cmb.total_amount,
            cmb.total_subsidy_amount,
            cmb.justification,
            p.full_name AS approved_by_name,
            cmb.approved_at
          FROM public.contingency_meal_batches cmb
          JOIN public.units u ON u.id = cmb.unit_id AND u.tenant_id = cmb.tenant_id
          JOIN public.meal_types mt ON mt.id = cmb.meal_type_id
          LEFT JOIN public.profiles p ON p.id = cmb.approved_by
         WHERE cmb.tenant_id = p_tenant_id
           AND cmb.service_date >= p_start_date
           AND cmb.service_date <= p_end_date
           AND cmb.status = 'approved'
           AND (p_institution_id IS NULL OR u.institution_id = p_institution_id)
           AND (p_unit_id IS NULL OR cmb.unit_id = p_unit_id)
           AND (p_category_id IS NULL OR cmb.category_id = p_category_id)
         ORDER BY cmb.service_date DESC
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'id', id,
                'unit_name', unit_name,
                'meal_type_name', meal_type_name,
                'service_date', service_date,
                'batch_type', batch_type,
                'total_meals_served', total_meals_served,
                'total_amount', total_amount,
                'total_subsidy_amount', total_subsidy_amount,
                'justification', justification,
                'approved_by_name', approved_by_name,
                'approved_at', approved_at
            )
        ),
        '[]'::jsonb
    )
    INTO v_contingency_breakdown
    FROM contingency_stats;

    -- Montagem do Resultado Contábil Final
    v_result := pg_catalog.jsonb_build_object(
        'generated_at', pg_catalog.now(),
        'period', pg_catalog.jsonb_build_object(
            'start_date', p_start_date,
            'end_date', p_end_date
        ),
        'applied_filters', pg_catalog.jsonb_build_object(
            'institution_id', p_institution_id,
            'unit_id', p_unit_id,
            'category_id', p_category_id
        ),
        'summary', pg_catalog.jsonb_build_object(
            'regular_meals_served', v_total_meals,
            'contingency_meals_served', v_contingency_meals,
            'total_meals_delivered', (v_total_meals + v_contingency_meals),

            -- Faturamento Bruto (Valor Facial Total)
            'gross_meal_amount', v_gross_meal_amount,
            'contingency_gross_amount', v_contingency_gross,
            'total_gross_invoicing', (v_gross_meal_amount + v_contingency_gross),

            -- Subsídios Devidos pela Instituição
            'regular_subsidy_amount', v_total_subsidy_amount,
            'contingency_subsidy_amount', v_contingency_subsidy,
            'total_institutional_subsidy', (v_total_subsidy_amount + v_contingency_subsidy),

            -- Receita Realizada (Arrecadação dos Comensais)
            'student_paid_amount', v_student_paid_amount,

            -- Passivo de Custódia (Recargas & Saldo)
            'recharges_in_period', v_total_recharges_amount,
            'current_custody_liability', v_total_custody_balance,
            'gateway_processing_fees', v_total_gateway_fees
        ),
        'category_breakdown', v_category_breakdown,
        'unit_breakdown', v_unit_breakdown,
        'contingency_breakdown', v_contingency_breakdown
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_consolidated_financial_report(UUID, DATE, DATE, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_consolidated_financial_report(UUID, DATE, DATE, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_consolidated_financial_report(UUID, DATE, DATE, UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.get_consolidated_financial_report IS
'Agregação contábil oficial da Sprint 15 (hardened Sprint 17): faturamento consolidado, subsídios devidos, arrecadação de alunos, passivo real de custódia e regularização de contingência.';
