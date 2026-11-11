-- ==============================================================================
-- Migration: 20261110000081_sprint17_p0_security_and_accounting_hardening.sql
-- Descrição: Sprint 17 - Auditoria Contábil Final, Segurança P0 e Hardening de RLS
--            1. Bloqueio de autoaprovação e adulteração pós-aprovação em contingência
--            2. Isolamento multi-tenant no bucket contingency-evidence
--            3. Remoção de meal_consumptions e blocked_attempts do supabase_realtime
--               e substituição por tabela de sinais sem PII/valores (operational_dashboard_signals)
--            4. Trigger de imutabilidade estrita no livro-razão (wallet_transactions)
--            5. RPC audit_wallet_custody_integrity para batimento patrimonial de custódia
--            6. Padronização de search_path = '' e REVOKE FROM PUBLIC, anon
-- ==============================================================================

-- 1. P0-01: HARDENING DE CONTINGÊNCIA (WITH CHECK + TRIGGER DE INTEGRIDADE)
REVOKE ALL ON public.contingency_meal_batches, public.contingency_batch_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.contingency_meal_batches TO authenticated;
GRANT SELECT, INSERT ON public.contingency_batch_items TO authenticated;
GRANT ALL ON public.contingency_meal_batches, public.contingency_batch_items TO service_role;

DROP POLICY IF EXISTS upd_contingency_batches_staff ON public.contingency_meal_batches;
CREATE POLICY upd_contingency_batches_staff ON public.contingency_meal_batches
FOR UPDATE TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND (
        (operator_id = auth.uid() AND status IN ('draft', 'pending_approval'))
        OR public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    )
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND (
        (
            public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        )
        OR (
            operator_id = auth.uid()
            AND status IN ('draft', 'pending_approval', 'cancelled')
            AND approved_by IS NULL
            AND approved_at IS NULL
        )
    )
);

CREATE OR REPLACE FUNCTION public.prevent_contingency_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.user_role;
    v_uid UUID := auth.uid();
BEGIN
    -- Imutabilidade de lotes já deliberados (approved / rejected)
    IF OLD.status IN ('approved', 'rejected') THEN
        IF NEW.total_meals_served IS DISTINCT FROM OLD.total_meals_served
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.subsidy_price IS DISTINCT FROM OLD.subsidy_price
           OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
           OR NEW.total_subsidy_amount IS DISTINCT FROM OLD.total_subsidy_amount
           OR NEW.service_date IS DISTINCT FROM OLD.service_date
           OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.status IS DISTINCT FROM OLD.status
        THEN
            RAISE EXCEPTION 'CONTINGENCY_IMMUTABLE: Lote de contingência já deliberado (%) não pode ser alterado.', OLD.status
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Bloqueio de autoaprovação fora de revisão autorizada
    IF NEW.status IN ('approved', 'rejected') AND OLD.status <> NEW.status AND v_uid IS NOT NULL THEN
        SELECT role INTO v_role FROM public.profiles WHERE id = v_uid AND status = 'active';
        IF v_role IS NULL OR v_role NOT IN ('admin_general', 'operations_director', 'finance') THEN
            RAISE EXCEPTION 'FORBIDDEN_APPROVAL: Apenas diretoria ou financeiro podem deliberar lotes.' USING ERRCODE = '42501';
        END IF;
        IF OLD.operator_id = v_uid AND v_role <> 'admin_general' THEN
            RAISE EXCEPTION 'SELF_APPROVAL_PROHIBITED: Operador que submeteu o lote não pode aprová-lo.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_contingency_tampering ON public.contingency_meal_batches;
CREATE TRIGGER trg_prevent_contingency_tampering
    BEFORE UPDATE ON public.contingency_meal_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_contingency_tampering();

REVOKE ALL ON FUNCTION public.prevent_contingency_tampering() FROM PUBLIC, anon, authenticated;

-- 2. P1-04: ISOLAMENTO MULTI-TENANT NO BUCKET contingency-evidence
DROP POLICY IF EXISTS sel_contingency_evidence_staff ON storage.objects;
CREATE POLICY sel_contingency_evidence_staff ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'contingency-evidence'
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
);

DROP POLICY IF EXISTS ins_contingency_evidence_staff ON storage.objects;
CREATE POLICY ins_contingency_evidence_staff ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'contingency-evidence'
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
);

-- 3. P1-05: REFORÇO DE STATUS ATIVO NAS RPCs DE CONTINGÊNCIA
CREATE OR REPLACE FUNCTION public.review_contingency_batch(
    p_batch_id UUID,
    p_action TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_reviewer_id UUID;
    v_reviewer_role TEXT;
    v_reviewer_status TEXT;
    v_batch RECORD;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();
    v_reviewer_id := auth.uid();
    v_reviewer_role := public.get_auth_user_role();
    v_reviewer_status := public.get_auth_user_status();

    IF v_tenant_id IS NULL OR v_reviewer_id IS NULL OR v_reviewer_status <> 'active' THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Usuário não autenticado ou inativo.');
    END IF;

    IF v_reviewer_role NOT IN ('admin_general', 'operations_director', 'finance') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Apenas Diretores, Financeiro ou Master podem deliberar sobre lotes de contingência.');
    END IF;

    SELECT * INTO v_batch FROM public.contingency_meal_batches
     WHERE id = p_batch_id AND tenant_id = v_tenant_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Lote de contingência não localizado.');
    END IF;

    IF v_batch.status != 'pending_approval' THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Apenas lotes pendentes de aprovação podem ser revisados.');
    END IF;

    IF v_batch.operator_id = v_reviewer_id AND v_reviewer_role != 'admin_general' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'SELF_APPROVAL_PROHIBITED',
            'message', 'Violação de segregação de funções: o operador que lançou o lote não pode aprová-lo.'
        );
    END IF;

    IF p_action = 'approve' THEN
        UPDATE public.contingency_meal_batches
           SET status = 'approved',
               approved_by = v_reviewer_id,
               approved_at = pg_catalog.now(),
               updated_at = pg_catalog.now()
         WHERE id = p_batch_id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'approved', 'message', 'Lote de contingência aprovado com sucesso.');
    ELSIF p_action = 'reject' THEN
        IF p_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_reason)) < 5 THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'REASON_REQUIRED', 'message', 'Justificativa da rejeição é obrigatória.');
        END IF;

        UPDATE public.contingency_meal_batches
           SET status = 'rejected',
               rejection_reason = pg_catalog.btrim(p_reason),
               approved_by = v_reviewer_id,
               approved_at = pg_catalog.now(),
               updated_at = pg_catalog.now()
         WHERE id = p_batch_id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'rejected', 'message', 'Lote de contingência rejeitado.');
    ELSE
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_ACTION', 'message', 'Ação inválida. Use approve ou reject.');
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_contingency_batch(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_contingency_batch(UUID, TEXT, TEXT) TO authenticated;

-- Correção P0 de compatibilidade de schema em submit_contingency_batch (Migration 77):
-- meal_types usa status='active' (não is_active) e meal_rules usa subsidy_amount/enabled/effective_from/effective_to
CREATE OR REPLACE FUNCTION public.submit_contingency_batch(
    p_unit_id UUID,
    p_meal_type_id UUID,
    p_service_date DATE,
    p_batch_type TEXT,
    p_total_meals_served INT,
    p_category_id UUID DEFAULT NULL,
    p_justification TEXT DEFAULT '',
    p_evidence_document_url TEXT DEFAULT NULL,
    p_identified_students JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_operator_id UUID;
    v_operator_role TEXT;
    v_operator_status TEXT;
    v_unit RECORD;
    v_meal_type RECORD;
    v_unit_price NUMERIC(10,2) := 0.00;
    v_subsidy_price NUMERIC(10,2) := 0.00;
    v_total_amount NUMERIC(10,2) := 0.00;
    v_total_subsidy NUMERIC(10,2) := 0.00;
    v_batch_id UUID;
    v_item JSONB;
    v_student RECORD;
    v_student_count INT := 0;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();
    v_operator_id := auth.uid();
    v_operator_role := public.get_auth_user_role()::text;
    v_operator_status := public.get_auth_user_status();

    IF v_tenant_id IS NULL OR v_operator_id IS NULL OR v_operator_status <> 'active' THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Usuário não autenticado ou inativo.');
    END IF;

    IF v_operator_role NOT IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Papel sem permissão para registrar contingência.');
    END IF;

    IF NOT public.has_unit_access(p_unit_id) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'FORBIDDEN_UNIT', 'message', 'Usuário sem acesso à unidade informada.');
    END IF;

    SELECT * INTO v_unit FROM public.units WHERE id = p_unit_id AND tenant_id = v_tenant_id AND status = 'active';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNIT_NOT_FOUND', 'message', 'Unidade não encontrada ou inativa.');
    END IF;

    SELECT * INTO v_meal_type FROM public.meal_types WHERE id = p_meal_type_id AND tenant_id = v_tenant_id AND status = 'active';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'MEAL_TYPE_NOT_FOUND', 'message', 'Tipo de refeição não encontrado ou inativo.');
    END IF;

    IF p_service_date > CURRENT_DATE THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'FUTURE_DATE', 'message', 'Data de serviço não pode ser futura.');
    END IF;

    IF p_total_meals_served <= 0 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_COUNT', 'message', 'Total de refeições deve ser maior que zero.');
    END IF;

    IF p_justification IS NULL OR pg_catalog.length(pg_catalog.btrim(p_justification)) < 10 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_JUSTIFICATION', 'message', 'Justificativa detalhada obrigatória (mínimo 10 caracteres).');
    END IF;

    IF p_category_id IS NOT NULL THEN
        SELECT mr.student_price, mr.subsidy_amount
          INTO v_unit_price, v_subsidy_price
          FROM public.meal_rules mr
         WHERE mr.tenant_id = v_tenant_id
           AND mr.unit_id = p_unit_id
           AND mr.meal_type_id = p_meal_type_id
           AND mr.category_id = p_category_id
           AND mr.enabled = true
           AND mr.effective_from <= (p_service_date::timestamptz + INTERVAL '23 hours 59 minutes 59 seconds')
           AND (mr.effective_to IS NULL OR mr.effective_to >= p_service_date::timestamptz)
         ORDER BY mr.effective_from DESC
         LIMIT 1;

        v_unit_price := COALESCE(v_unit_price, 0.00);
        v_subsidy_price := COALESCE(v_subsidy_price, 0.00);
    END IF;

    v_total_amount := pg_catalog.round(v_unit_price * p_total_meals_served, 2);
    v_total_subsidy := pg_catalog.round(v_subsidy_price * p_total_meals_served, 2);

    INSERT INTO public.contingency_meal_batches (
        tenant_id, unit_id, meal_type_id, service_date, batch_type,
        total_meals_served, category_id, unit_price, subsidy_price,
        total_amount, total_subsidy_amount, justification, evidence_document_url,
        operator_id, status
    ) VALUES (
        v_tenant_id, p_unit_id, p_meal_type_id, p_service_date, p_batch_type,
        p_total_meals_served, p_category_id, v_unit_price, v_subsidy_price,
        v_total_amount, v_total_subsidy, pg_catalog.btrim(p_justification), p_evidence_document_url,
        v_operator_id, 'pending_approval'
    ) RETURNING id INTO v_batch_id;

    IF p_batch_type = 'type_a_identified' THEN
        FOR v_item IN SELECT * FROM pg_catalog.jsonb_array_elements(p_identified_students)
        LOOP
            SELECT id, full_name, registration_number, category_id INTO v_student
            FROM public.students
            WHERE tenant_id = v_tenant_id
              AND (id::text = (v_item->>'student_id') OR registration_number = (v_item->>'registration_number'))
              AND status = 'active';

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Aluno informado não encontrado ou inativo: %', COALESCE(v_item->>'registration_number', v_item->>'student_id');
            END IF;

            IF EXISTS (
                SELECT 1 FROM public.meal_consumptions
                WHERE tenant_id = v_tenant_id
                  AND student_id = v_student.id
                  AND consumption_date = p_service_date
                  AND meal_type_id = p_meal_type_id
                  AND status = 'approved'
            ) THEN
                RAISE EXCEPTION 'Aluno % já possui refeição regular aprovada para esta data e turno.', v_student.registration_number;
            END IF;

            INSERT INTO public.contingency_batch_items (
                tenant_id, batch_id, student_id, registration_number,
                student_name, category_id, notes
            ) VALUES (
                v_tenant_id, v_batch_id, v_student.id, v_student.registration_number,
                v_student.full_name, v_student.category_id, v_item->>'notes'
            );

            v_student_count := v_student_count + 1;
        END LOOP;

        IF v_student_count > 0 THEN
            UPDATE public.contingency_meal_batches
            SET total_meals_served = v_student_count,
                total_amount = pg_catalog.round(unit_price * v_student_count, 2),
                total_subsidy_amount = pg_catalog.round(subsidy_price * v_student_count, 2)
            WHERE id = v_batch_id;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'batch_id', v_batch_id,
        'status', 'pending_approval',
        'message', 'Lote de contingência submetido com sucesso para aprovação gerencial.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_contingency_batch(UUID, UUID, DATE, TEXT, INT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_contingency_batch(UUID, UUID, DATE, TEXT, INT, UUID, TEXT, TEXT, JSONB) TO authenticated;

-- 4. P0-03: HARDENING DE SUPABASE REALTIME (SEM VAZAMENTO DE PII OU VALORES)
-- Remove tabelas sensíveis da publicação supabase_realtime
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['meal_consumptions', 'blocked_attempts']
    LOOP
        IF EXISTS (
            SELECT 1
              FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public'
               AND tablename = v_table
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_table);
        END IF;
    END LOOP;
END;
$$;

-- Tabela de sinais sem PII, sem student_id, sem matrícula/CPF e sem valores financeiros
CREATE TABLE IF NOT EXISTS public.operational_dashboard_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL CHECK (signal_type IN ('meal_consumed', 'attempt_blocked')),
    emitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_signals_unit_emitted
    ON public.operational_dashboard_signals(unit_id, emitted_at DESC);

ALTER TABLE public.operational_dashboard_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_dashboard_signals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.operational_dashboard_signals FROM PUBLIC, anon;
GRANT SELECT ON public.operational_dashboard_signals TO authenticated;
GRANT ALL ON public.operational_dashboard_signals TO service_role;

-- Somente perfis autorizados do painel operacional com acesso à unidade recebem sinais (exclui operator e student)
DROP POLICY IF EXISTS sel_operational_signals_dashboard ON public.operational_dashboard_signals;
CREATE POLICY sel_operational_signals_dashboard ON public.operational_dashboard_signals
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
    AND public.has_unit_access(unit_id)
);

CREATE OR REPLACE FUNCTION public.emit_operational_dashboard_signal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.operational_dashboard_signals (tenant_id, unit_id, signal_type)
    VALUES (
        NEW.tenant_id,
        NEW.unit_id,
        CASE WHEN TG_TABLE_NAME = 'meal_consumptions' THEN 'meal_consumed' ELSE 'attempt_blocked' END
    );
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_operational_dashboard_signal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_signal_meal_consumption ON public.meal_consumptions;
CREATE TRIGGER trg_signal_meal_consumption
    AFTER INSERT ON public.meal_consumptions
    FOR EACH ROW
    EXECUTE FUNCTION public.emit_operational_dashboard_signal();

DROP TRIGGER IF EXISTS trg_signal_blocked_attempt ON public.blocked_attempts;
CREATE TRIGGER trg_signal_blocked_attempt
    AFTER INSERT ON public.blocked_attempts
    FOR EACH ROW
    EXECUTE FUNCTION public.emit_operational_dashboard_signal();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'operational_dashboard_signals'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.operational_dashboard_signals;
    END IF;
END;
$$;

-- Correção de schema (sc.code = 'integral' em vez de sc.is_integral), search_path = '' e REVOKE FROM PUBLIC, anon
CREATE OR REPLACE FUNCTION public.get_realtime_operational_dashboard(
    p_unit_id UUID,
    p_service_date DATE DEFAULT CURRENT_DATE,
    p_meal_type_id UUID DEFAULT NULL
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
    v_tenant_id UUID;
    v_unit_name TEXT;
    v_total_meals INT := 0;
    v_integral_meals INT := 0;
    v_partial_meals INT := 0;
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
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação necessária.' USING ERRCODE = '42501';
    END IF;

    SELECT id, tenant_id, role, status INTO v_profile FROM public.profiles WHERE id = v_uid;

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil ativo obrigatório.' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Acesso não autorizado ao painel operacional.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem permissão para acessar esta unidade.' USING ERRCODE = '42501';
    END IF;

    v_tenant_id := v_profile.tenant_id;

    SELECT name INTO v_unit_name FROM public.units WHERE id = p_unit_id AND tenant_id = v_tenant_id;
    IF v_unit_name IS NULL THEN
        RAISE EXCEPTION 'UNIT_NOT_FOUND: Unidade não localizada.' USING ERRCODE = '22023';
    END IF;

    SELECT
        COUNT(*)::INT,
        COUNT(*) FILTER (WHERE sc.code = 'integral')::INT,
        COUNT(*) FILTER (WHERE sc.code <> 'integral')::INT,
        COUNT(*) FILTER (WHERE mc.consumed_at >= pg_catalog.now() - INTERVAL '5 minutes')::INT,
        COUNT(*) FILTER (WHERE mc.consumed_at >= pg_catalog.now() - INTERVAL '15 minutes')::INT
      INTO
        v_total_meals, v_integral_meals, v_partial_meals, v_recent_5m_meals, v_recent_15m_meals
      FROM public.meal_consumptions mc
      JOIN public.student_categories sc ON sc.id = mc.category_id
     WHERE mc.tenant_id = v_tenant_id
       AND mc.unit_id = p_unit_id
       AND mc.consumption_date = p_service_date
       AND mc.status IN ('approved', 'financially_refunded')
       AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id);

    v_speed_per_minute := pg_catalog.round((v_recent_5m_meals::NUMERIC / 5.0), 2);

    SELECT COUNT(*)::INT
      INTO v_total_blocked
      FROM public.blocked_attempts ba
     WHERE ba.tenant_id = v_tenant_id
       AND ba.unit_id = p_unit_id
       AND ba.attempted_at::DATE = p_service_date
       AND (p_meal_type_id IS NULL OR ba.meal_type_id = p_meal_type_id);

    WITH time_buckets AS (
        SELECT
            pg_catalog.to_char(
                pg_catalog.date_bin('15 minutes', mc.consumed_at, TIMESTAMPTZ '2000-01-01 00:00:00+00'),
                'HH24:MI'
            ) AS interval_label,
            pg_catalog.date_bin('15 minutes', mc.consumed_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS interval_ts,
            COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE sc.code = 'integral')::INT AS integral,
            COUNT(*) FILTER (WHERE sc.code <> 'integral')::INT AS partial
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
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object('interval', interval_label, 'total', total, 'integral', integral, 'partial', partial)
        ), '[]'::jsonb
    ) INTO v_hourly_flow FROM time_buckets;

    WITH ranked_peaks AS (
        SELECT
            pg_catalog.to_char(
                pg_catalog.date_bin('15 minutes', mc.consumed_at, TIMESTAMPTZ '2000-01-01 00:00:00+00'),
                'HH24:MI'
            ) AS interval_label,
            COUNT(*)::INT AS total
          FROM public.meal_consumptions mc
         WHERE mc.tenant_id = v_tenant_id
           AND mc.unit_id = p_unit_id
           AND mc.consumption_date = p_service_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id)
         GROUP BY 1 ORDER BY 2 DESC LIMIT 1
    )
    SELECT interval_label, total INTO v_peak_interval, v_peak_volume FROM ranked_peaks;

    WITH reasons AS (
        SELECT ba.reason_code, ba.reason_message, COUNT(*)::INT AS count,
               pg_catalog.round((COUNT(*)::NUMERIC / NULLIF(v_total_blocked, 0) * 100), 1) AS percentage
          FROM public.blocked_attempts ba
         WHERE ba.tenant_id = v_tenant_id
           AND ba.unit_id = p_unit_id
           AND ba.attempted_at::DATE = p_service_date
           AND (p_meal_type_id IS NULL OR ba.meal_type_id = p_meal_type_id)
         GROUP BY ba.reason_code, ba.reason_message
         ORDER BY count DESC LIMIT 10
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'reason_code', reason_code, 'reason_message', reason_message,
                'count', count, 'percentage', COALESCE(percentage, 0.0)
            )
        ), '[]'::jsonb
    ) INTO v_blocked_reasons FROM reasons;

    WITH categories AS (
        SELECT sc.id AS category_id, sc.name AS category_name, sc.code AS category_code,
               (sc.code = 'integral') AS is_integral, COUNT(mc.id)::INT AS count,
               pg_catalog.round((COUNT(mc.id)::NUMERIC / NULLIF(v_total_meals, 0) * 100), 1) AS percentage,
               COALESCE(SUM(mc.full_price), 0.00) AS total_full_price,
               COALESCE(SUM(mc.subsidy_amount), 0.00) AS total_subsidy
          FROM public.meal_consumptions mc
          JOIN public.student_categories sc ON sc.id = mc.category_id
         WHERE mc.tenant_id = v_tenant_id
           AND mc.unit_id = p_unit_id
           AND mc.consumption_date = p_service_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id)
         GROUP BY sc.id, sc.name, sc.code ORDER BY count DESC
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'category_id', category_id, 'category_name', category_name, 'category_code', category_code,
                'is_integral', is_integral, 'count', count, 'percentage', COALESCE(percentage, 0.0),
                'total_full_price', total_full_price, 'total_subsidy', total_subsidy
            )
        ), '[]'::jsonb
    ) INTO v_category_breakdown FROM categories;

    WITH terminal_data AS (
        SELECT COALESCE(mc.terminal_id, 'TERMINAL-01') AS terminal_id, p.full_name AS operator_name,
               COUNT(mc.id)::INT AS total_served, MAX(mc.consumed_at) AS last_consumed_at,
               pg_catalog.round(EXTRACT(EPOCH FROM (pg_catalog.now() - MAX(mc.consumed_at))))::INT AS seconds_since_last_activity,
               COUNT(mc.id) FILTER (WHERE mc.consumed_at >= pg_catalog.now() - INTERVAL '5 minutes')::INT AS recent_5m_served
          FROM public.meal_consumptions mc
          LEFT JOIN public.profiles p ON p.id = mc.operator_id
         WHERE mc.tenant_id = v_tenant_id
           AND mc.unit_id = p_unit_id
           AND mc.consumption_date = p_service_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id)
         GROUP BY 1, 2
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'terminal_id', terminal_id, 'operator_name', operator_name, 'total_served', total_served,
                'last_consumed_at', last_consumed_at, 'seconds_since_last_activity', seconds_since_last_activity,
                'speed_per_minute', pg_catalog.round((recent_5m_served::NUMERIC / 5.0), 2),
                'is_idle_alert', (seconds_since_last_activity > 120 AND v_recent_15m_meals > 0 AND p_service_date = CURRENT_DATE)
            ) ORDER BY terminal_id ASC
        ), '[]'::jsonb
    ) INTO v_terminal_statuses FROM terminal_data;

    v_result := pg_catalog.jsonb_build_object(
        'generated_at', pg_catalog.now(),
        'service_date', p_service_date,
        'unit_id', p_unit_id,
        'unit_name', v_unit_name,
        'meal_type_id', p_meal_type_id,
        'summary', pg_catalog.jsonb_build_object(
            'total_meals', v_total_meals,
            'integral_meals', v_integral_meals,
            'partial_meals', v_partial_meals,
            'recent_5m_meals', v_recent_5m_meals,
            'speed_per_minute', v_speed_per_minute,
            'total_blocked', v_total_blocked,
            'total_attempts', (v_total_meals + v_total_blocked),
            'block_rate_percentage', CASE WHEN (v_total_meals + v_total_blocked) > 0 THEN pg_catalog.round((v_total_blocked::NUMERIC / (v_total_meals + v_total_blocked) * 100), 1) ELSE 0.0 END,
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

REVOKE ALL ON FUNCTION public.get_realtime_operational_dashboard(UUID, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_realtime_operational_dashboard(UUID, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_realtime_operational_dashboard(UUID, DATE, UUID) TO service_role;

-- 5. P0-04: IMUTABILIDADE ESTRITA DO LIVRO-RAZÃO (wallet_transactions)
REVOKE UPDATE, DELETE, TRUNCATE ON public.wallet_transactions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_wallet_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: Registros do livro-razão financeiro (wallet_transactions) são estritamente imutáveis (append-only). Operação % bloqueada.', TG_OP
        USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_wallet_ledger_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wallet_transactions_immutable ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_immutable
    BEFORE UPDATE OR DELETE ON public.wallet_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_wallet_ledger_mutation();

DROP TRIGGER IF EXISTS trg_wallet_transactions_no_truncate ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_no_truncate
    BEFORE TRUNCATE ON public.wallet_transactions
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.prevent_wallet_ledger_mutation();

-- 6. P1-01: RPC DE AUDITORIA PATRIMONIAL DE CUSTÓDIA (CARTEIRAS VS LEDGER)
CREATE OR REPLACE FUNCTION public.audit_wallet_custody_integrity(
    p_tenant_id UUID
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
    v_wallets_balance NUMERIC(14,2) := 0.00;
    v_ledger_net_sum NUMERIC(14,2) := 0.00;
    v_custody_drift NUMERIC(14,2) := 0.00;
    v_inconsistent_wallets_count INT := 0;
    v_negative_wallets_count INT := 0;
BEGIN
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

    IF v_profile.role NOT IN ('admin_general', 'operations_director', 'finance') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Apenas diretoria ou financeiro podem auditar custódia.' USING ERRCODE = '42501';
    END IF;

    IF v_profile.tenant_id <> p_tenant_id THEN
        RAISE EXCEPTION 'TENANT_MISMATCH: Acesso negado a outro tenant.' USING ERRCODE = '42501';
    END IF;

    SELECT
        COALESCE(SUM(w.balance), 0.00),
        COUNT(*) FILTER (WHERE w.balance < 0.00)::INT
      INTO
        v_wallets_balance,
        v_negative_wallets_count
      FROM public.wallets w
     WHERE w.tenant_id = p_tenant_id;

    SELECT COALESCE(SUM(wt.amount), 0.00)
      INTO v_ledger_net_sum
      FROM public.wallet_transactions wt
     WHERE wt.tenant_id = p_tenant_id;

    SELECT COUNT(*)::INT
      INTO v_inconsistent_wallets_count
      FROM (
          SELECT w.id,
                 w.balance,
                 COALESCE(SUM(wt.amount), 0.00) AS ledger_sum
            FROM public.wallets w
            LEFT JOIN public.wallet_transactions wt
              ON wt.wallet_id = w.id AND wt.tenant_id = w.tenant_id
           WHERE w.tenant_id = p_tenant_id
           GROUP BY w.id, w.balance
          HAVING pg_catalog.round(w.balance, 2) <> pg_catalog.round(COALESCE(SUM(wt.amount), 0.00), 2)
      ) drift;

    v_custody_drift := pg_catalog.round(v_wallets_balance - v_ledger_net_sum, 2);

    RETURN pg_catalog.jsonb_build_object(
        'audited_at', pg_catalog.now(),
        'tenant_id', p_tenant_id,
        'wallets_custody_balance', v_wallets_balance,
        'ledger_net_sum', v_ledger_net_sum,
        'custody_drift', v_custody_drift,
        'inconsistent_wallets_count', v_inconsistent_wallets_count,
        'negative_wallets_count', v_negative_wallets_count,
        'is_patrimony_balanced', (v_custody_drift = 0.00 AND v_inconsistent_wallets_count = 0 AND v_negative_wallets_count = 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.audit_wallet_custody_integrity(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_wallet_custody_integrity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_wallet_custody_integrity(UUID) TO service_role;

COMMENT ON FUNCTION public.audit_wallet_custody_integrity IS
'Auditoria patrimonial da Sprint 17: comprova matematicamente se o passivo devido nas carteiras (wallets.balance) coincide 1:1 com a soma líquida do livro-razão (wallet_transactions.amount).';

