-- ==============================================================================
-- Migration: 20261109000078_create_realtime_operational_dashboard.sql
-- Descrição: Sprint 14 - Dashboards Operacionais e Monitoramento de Picos
--            RPC para indicadores em tempo real (velocidade de linha, painel de picos,
--            taxa de bloqueios, consumo por categoria e alertas de inatividade de terminais)
--            e publicação de blocked_attempts no Supabase Realtime.
-- ==============================================================================

-- 1. Assegurar que blocked_attempts e meal_consumptions pertencem à publicação supabase_realtime
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['meal_consumptions', 'blocked_attempts']
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public'
               AND tablename = v_table
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
        END IF;
    END LOOP;
END;
$$;

-- 2. Índices para Otimização de Consultas Analíticas em Tempo Real
CREATE INDEX IF NOT EXISTS idx_meal_consumptions_dashboard_fast
    ON public.meal_consumptions(unit_id, consumption_date, consumed_at DESC)
    INCLUDE (meal_type_id, category_id, terminal_id, status);

CREATE INDEX IF NOT EXISTS idx_blocked_attempts_dashboard_fast
    ON public.blocked_attempts(unit_id, attempted_at DESC)
    INCLUDE (meal_type_id, reason_code, terminal_id);

-- 3. RPC: get_realtime_operational_dashboard
-- Consulta e agrega de forma atômica e estável os dados do turno operacional
CREATE OR REPLACE FUNCTION public.get_realtime_operational_dashboard(
    p_unit_id UUID,
    p_service_date DATE DEFAULT CURRENT_DATE,
    p_meal_type_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_profile RECORD;
    v_tenant_id UUID;
    v_unit_name TEXT;
    v_total_meals INT := 0;
    v_integral_meals INT := 0;
    v_partial_meals INT := 0;
    v_visitor_meals INT := 0;
    v_recent_5m_meals INT := 0;
    v_recent_15m_meals INT := 0;
    v_speed_per_minute NUMERIC(10,2) := 0.00;
    v_total_blocked INT := 0;
    v_peak_interval TEXT := NULL;
    v_peak_volume INT := 0;
    v_hourly_flow JSONB;
    v_blocked_reasons JSONB;
    v_category_breakdown JSONB;
    v_terminal_statuses JSONB;
    v_result JSONB;
BEGIN
    -- Verificação de Autenticação
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação necessária.' USING ERRCODE = '42501';
    END IF;

    -- Carregar perfil do operador/gestor
    SELECT id, tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = v_uid;

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil ativo obrigatório.' USING ERRCODE = '42501';
    END IF;

    -- Papéis com permissão operacional
    IF v_profile.role NOT IN (
        'admin_general',
        'operations_director',
        'finance',
        'supervisor',
        'unit_manager'
    ) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Acesso não autorizado ao painel operacional.' USING ERRCODE = '42501';
    END IF;

    -- Validação de Escopo de Unidade
    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem permissão para acessar esta unidade.' USING ERRCODE = '42501';
    END IF;

    v_tenant_id := v_profile.tenant_id;

    -- Buscar dados básicos da unidade
    SELECT name
      INTO v_unit_name
      FROM public.units
     WHERE id = p_unit_id
       AND tenant_id = v_tenant_id;

    IF v_unit_name IS NULL THEN
        RAISE EXCEPTION 'UNIT_NOT_FOUND: Unidade não localizada.' USING ERRCODE = '22023';
    END IF;

    -- 1. Contagens Totais de Consumo no Dia/Turno
    SELECT
        COUNT(*)::INT,
        COUNT(*) FILTER (WHERE sc.is_integral = true)::INT,
        COUNT(*) FILTER (WHERE sc.is_integral = false)::INT,
        COUNT(*) FILTER (WHERE mc.consumed_at >= now() - INTERVAL '5 minutes')::INT,
        COUNT(*) FILTER (WHERE mc.consumed_at >= now() - INTERVAL '15 minutes')::INT
      INTO
        v_total_meals,
        v_integral_meals,
        v_partial_meals,
        v_recent_5m_meals,
        v_recent_15m_meals
      FROM public.meal_consumptions mc
      JOIN public.student_categories sc ON sc.id = mc.category_id
     WHERE mc.tenant_id = v_tenant_id
       AND mc.unit_id = p_unit_id
       AND mc.consumption_date = p_service_date
       AND mc.status IN ('approved', 'financially_refunded')
       AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id);

    -- Velocidade de linha nos últimos 5 minutos (refeições / minuto)
    v_speed_per_minute := ROUND((v_recent_5m_meals::NUMERIC / 5.0), 2);

    -- 2. Total de Bloqueios no Dia/Turno
    SELECT COUNT(*)::INT
      INTO v_total_blocked
      FROM public.blocked_attempts ba
     WHERE ba.tenant_id = v_tenant_id
       AND ba.unit_id = p_unit_id
       AND ba.attempted_at::DATE = p_service_date
       AND (p_meal_type_id IS NULL OR ba.meal_type_id = p_meal_type_id);

    -- 3. Painel de Picos: Distribuição Horária em Blocos de 15 Minutos
    WITH time_buckets AS (
        SELECT
            to_char(
                date_bin('15 minutes', mc.consumed_at, TIMESTAMPTZ '2000-01-01 00:00:00+00'),
                'HH24:MI'
            ) AS interval_label,
            date_bin('15 minutes', mc.consumed_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS interval_ts,
            COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE sc.is_integral = true)::INT AS integral,
            COUNT(*) FILTER (WHERE sc.is_integral = false)::INT AS partial
          FROM public.meal_consumptions mc
          JOIN public.student_categories sc ON sc.id = mc.category_id
         WHERE mc.tenant_id = v_tenant_id
           AND mc.unit_id = p_unit_id
           AND mc.consumption_date = p_service_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id)
         GROUP BY 1, 2
         ORDER BY 2 ASC
    )
    SELECT
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'interval', interval_label,
                    'total', total,
                    'integral', integral,
                    'partial', partial
                )
            ),
            '[]'::jsonb
        )
      INTO v_hourly_flow
      FROM time_buckets;

    -- Encontrar o bloco de pico
    WITH ranked_peaks AS (
        SELECT
            to_char(
                date_bin('15 minutes', mc.consumed_at, TIMESTAMPTZ '2000-01-01 00:00:00+00'),
                'HH24:MI'
            ) AS interval_label,
            COUNT(*)::INT AS total
          FROM public.meal_consumptions mc
         WHERE mc.tenant_id = v_tenant_id
           AND mc.unit_id = p_unit_id
           AND mc.consumption_date = p_service_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id)
         GROUP BY 1
         ORDER BY 2 DESC
         LIMIT 1
    )
    SELECT interval_label, total
      INTO v_peak_interval, v_peak_volume
      FROM ranked_peaks;

    -- 4. Motivos de Bloqueio (Top Rejections)
    WITH reasons AS (
        SELECT
            ba.reason_code,
            ba.reason_message,
            COUNT(*)::INT AS count,
            ROUND((COUNT(*)::NUMERIC / NULLIF(v_total_blocked, 0) * 100), 1) AS percentage
          FROM public.blocked_attempts ba
         WHERE ba.tenant_id = v_tenant_id
           AND ba.unit_id = p_unit_id
           AND ba.attempted_at::DATE = p_service_date
           AND (p_meal_type_id IS NULL OR ba.meal_type_id = p_meal_type_id)
         GROUP BY ba.reason_code, ba.reason_message
         ORDER BY count DESC
         LIMIT 10
    )
    SELECT
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'reason_code', reason_code,
                    'reason_message', reason_message,
                    'count', count,
                    'percentage', COALESCE(percentage, 0.0)
                )
            ),
            '[]'::jsonb
        )
      INTO v_blocked_reasons
      FROM reasons;

    -- 5. Consumo por Categoria
    WITH categories AS (
        SELECT
            sc.id AS category_id,
            sc.name AS category_name,
            sc.code AS category_code,
            sc.is_integral,
            COUNT(mc.id)::INT AS count,
            ROUND((COUNT(mc.id)::NUMERIC / NULLIF(v_total_meals, 0) * 100), 1) AS percentage,
            COALESCE(SUM(mc.full_price), 0.00) AS total_full_price,
            COALESCE(SUM(mc.subsidy_amount), 0.00) AS total_subsidy
          FROM public.meal_consumptions mc
          JOIN public.student_categories sc ON sc.id = mc.category_id
         WHERE mc.tenant_id = v_tenant_id
           AND mc.unit_id = p_unit_id
           AND mc.consumption_date = p_service_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id)
         GROUP BY sc.id, sc.name, sc.code, sc.is_integral
         ORDER BY count DESC
    )
    SELECT
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'category_id', category_id,
                    'category_name', category_name,
                    'category_code', category_code,
                    'is_integral', is_integral,
                    'count', count,
                    'percentage', COALESCE(percentage, 0.0),
                    'total_full_price', total_full_price,
                    'total_subsidy', total_subsidy
                )
            ),
            '[]'::jsonb
        )
      INTO v_category_breakdown
      FROM categories;

    -- 6. Monitoramento de Terminais e Detecção de Inatividade (> 2 minutos sem registros)
    WITH terminal_data AS (
        SELECT
            COALESCE(mc.terminal_id, 'TERMINAL-01') AS terminal_id,
            p.full_name AS operator_name,
            COUNT(mc.id)::INT AS total_served,
            MAX(mc.consumed_at) AS last_consumed_at,
            ROUND(EXTRACT(EPOCH FROM (now() - MAX(mc.consumed_at))))::INT AS seconds_since_last_activity,
            COUNT(mc.id) FILTER (WHERE mc.consumed_at >= now() - INTERVAL '5 minutes')::INT AS recent_5m_served
          FROM public.meal_consumptions mc
          LEFT JOIN public.profiles p ON p.id = mc.operator_id
         WHERE mc.tenant_id = v_tenant_id
           AND mc.unit_id = p_unit_id
           AND mc.consumption_date = p_service_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id)
         GROUP BY 1, 2
    )
    SELECT
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'terminal_id', terminal_id,
                    'operator_name', operator_name,
                    'total_served', total_served,
                    'last_consumed_at', last_consumed_at,
                    'seconds_since_last_activity', seconds_since_last_activity,
                    'speed_per_minute', ROUND((recent_5m_served::NUMERIC / 5.0), 2),
                    'is_idle_alert', (
                        seconds_since_last_activity > 120 
                        AND v_recent_15m_meals > 0
                        AND p_service_date = CURRENT_DATE
                    )
                ) ORDER BY terminal_id ASC
            ),
            '[]'::jsonb
        )
      INTO v_terminal_statuses
      FROM terminal_data;

    -- Montagem do Snapshot Final
    v_result := jsonb_build_object(
        'generated_at', now(),
        'service_date', p_service_date,
        'unit_id', p_unit_id,
        'unit_name', v_unit_name,
        'meal_type_id', p_meal_type_id,
        'summary', jsonb_build_object(
            'total_meals', v_total_meals,
            'integral_meals', v_integral_meals,
            'partial_meals', v_partial_meals,
            'recent_5m_meals', v_recent_5m_meals,
            'speed_per_minute', v_speed_per_minute,
            'total_blocked', v_total_blocked,
            'total_attempts', (v_total_meals + v_total_blocked),
            'block_rate_percentage', CASE
                WHEN (v_total_meals + v_total_blocked) > 0 THEN
                    ROUND((v_total_blocked::NUMERIC / (v_total_meals + v_total_blocked) * 100), 1)
                ELSE 0.0
            END,
            'peak_interval', v_peak_interval,
            'peak_volume', v_peak_volume
        ),
        'hourly_flow', v_hourly_flow,
        'blocked_reasons', v_blocked_reasons,
        'category_breakdown', v_category_breakdown,
        'terminal_statuses', v_terminal_statuses
    );

    RETURN v_result;
END;
$$;

-- Permissões de Execução
REVOKE ALL ON FUNCTION public.get_realtime_operational_dashboard(UUID, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_realtime_operational_dashboard(UUID, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_realtime_operational_dashboard(UUID, DATE, UUID) TO service_role;

COMMENT ON FUNCTION public.get_realtime_operational_dashboard IS
'Agregação analítica atômica do dashboard operacional (Sprint 14): velocidade de linha, picos de 15min, bloqueios e alertas de inatividade.';

