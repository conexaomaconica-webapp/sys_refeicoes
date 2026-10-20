-- ==============================================================================
-- Migration: 20260927000031_create_offline_contingency_tables_and_rpc.sql
-- Descrição: Tabela imutável de contingência offline e RPC reconciliadora
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.offline_contingency_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL,
    terminal_id TEXT NOT NULL,
    operator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
    registration_attempted TEXT NOT NULL,
    meal_type_id UUID NOT NULL REFERENCES public.meal_types(id) ON DELETE RESTRICT,
    device_timestamp TIMESTAMPTZ NOT NULL,
    sequence_num BIGINT NOT NULL,
    idempotency_key TEXT NOT NULL,
    previous_event_hash TEXT NOT NULL,
    integrity_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reconciled_at TIMESTAMPTZ,
    consumption_id UUID REFERENCES public.meal_consumptions(id) ON DELETE SET NULL,
    wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
    reconciliation_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_offline_events_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT chk_offline_events_status CHECK (status IN ('pending', 'confirmed_regular', 'conflict_duplicate', 'pending_administrative_review', 'failed_irrecoverable'))
);

CREATE INDEX IF NOT EXISTS idx_offline_events_tenant_terminal ON public.offline_contingency_events(tenant_id, terminal_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_offline_events_student_date ON public.offline_contingency_events(tenant_id, student_id, device_timestamp);
CREATE INDEX IF NOT EXISTS idx_offline_events_status ON public.offline_contingency_events(tenant_id, status);

ALTER TABLE public.offline_contingency_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_offline_events_staff ON public.offline_contingency_events;
CREATE POLICY sel_offline_events_staff ON public.offline_contingency_events
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager', 'operator')
);

CREATE OR REPLACE FUNCTION public.reconcile_offline_consumptions(p_batch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_event JSONB;
    v_results JSONB := '[]'::JSONB;
    
    -- Variáveis de iteração do evento
    v_client_event_id TEXT;
    v_terminal_id TEXT;
    v_unit_id UUID;
    v_operator_id UUID;
    v_student_id UUID;
    v_registration_attempted TEXT;
    v_meal_type_id UUID;
    v_device_timestamp TIMESTAMPTZ;
    v_consumption_date DATE;
    v_sequence_num INT;
    v_idempotency_key TEXT;
    v_prev_hash TEXT;
    v_integrity_hash TEXT;
    
    -- Dados de suporte
    v_existing_event RECORD;
    v_student RECORD;
    v_unit RECORD;
    v_meal_type RECORD;
    v_meal_rule RECORD;
    v_existing_consumption RECORD;
    v_consumption_id UUID;
    v_wallet RECORD;
    v_wallet_tx_id UUID;
    v_now TIMESTAMPTZ := now();
    v_full_price NUMERIC(12, 2);
    v_student_price NUMERIC(12, 2);
    v_subsidy_amount NUMERIC(12, 2);
BEGIN
    -- 1. Identificar e autenticar o operador chamador
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Operador não autenticado.';
    END IF;

    SELECT id, tenant_id, role, status
    INTO v_caller_profile
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_profile.id IS NULL OR v_caller_profile.status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED_CALLER: Perfil inativo ou inexistente.';
    END IF;

    IF v_caller_profile.role NOT IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager', 'operator') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem permissão para conciliar eventos offline.';
    END IF;

    -- Validar que o batch é um array JSON
    IF jsonb_typeof(p_batch) <> 'array' THEN
        RAISE EXCEPTION 'INVALID_BATCH: p_batch deve ser um array JSON.';
    END IF;

    -- 2. Iterar sobre cada evento do lote
    FOR v_event IN SELECT * FROM jsonb_array_elements(p_batch)
    LOOP
        v_client_event_id := v_event->>'id';
        v_terminal_id := v_event->>'terminal_id';
        v_unit_id := (v_event->>'unit_id')::UUID;
        v_operator_id := (v_event->>'operator_id')::UUID;
        v_student_id := (v_event->>'student_id')::UUID;
        v_registration_attempted := v_event->>'registration_attempted';
        v_meal_type_id := (v_event->>'meal_type_id')::UUID;
        v_device_timestamp := (v_event->>'device_timestamp')::TIMESTAMPTZ;
        v_consumption_date := (v_device_timestamp AT TIME ZONE 'America/Sao_Paulo')::DATE;
        v_sequence_num := (v_event->>'sequence_num')::INT;
        v_idempotency_key := v_event->>'idempotency_key';
        v_prev_hash := v_event->>'previous_event_hash';
        v_integrity_hash := v_event->>'integrity_hash';

        -- A. Verificação Canônica de Idempotência
        SELECT id, status, conflict_reason, linked_consumption_id, financial_debit_applied
        INTO v_existing_event
        FROM public.offline_contingency_events
        WHERE tenant_id = v_caller_profile.tenant_id
          AND idempotency_key = v_idempotency_key;

        IF v_existing_event.id IS NOT NULL THEN
            -- Evento já processado anteriormente -> Retorno idempotente
            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', v_existing_event.status,
                'already_processed', true,
                'linked_consumption_id', v_existing_event.linked_consumption_id,
                'financial_debit_applied', v_existing_event.financial_debit_applied,
                'reconciled_at', v_now
            );
            CONTINUE;
        END IF;

        -- B. Validar Unidade e Escopo do Tenant
        SELECT id, institution_id, timezone
        INTO v_unit
        FROM public.units
        WHERE id = v_unit_id AND tenant_id = v_caller_profile.tenant_id;

        IF v_unit.id IS NULL THEN
            -- Unidade inválida ou de outro tenant (rejeição irrevogável imediata sem violação relacional)
            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'failed_irrecoverable',
                'error_code', 'UNIT_TENANT_MISMATCH',
                'message', 'Unidade não pertence ao tenant autenticado.'
            );
            CONTINUE;
        END IF;

        -- C. Validar Aluno e Categoria
        SELECT s.id, s.institution_id, s.status, s.category_id, c.code AS category_code, (NOT c.requires_wallet) AS is_integral
        INTO v_student
        FROM public.students s
        JOIN public.student_categories c ON c.id = s.category_id
        WHERE s.id = v_student_id AND s.tenant_id = v_caller_profile.tenant_id;

        IF v_student.id IS NULL THEN
            -- Aluno não pertence ao tenant ou não existe
            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'failed_irrecoverable',
                'error_code', 'STUDENT_NOT_FOUND_OR_TENANT_MISMATCH',
                'message', 'Aluno não encontrado ou não pertence ao tenant autenticado.'
            );
            CONTINUE;
        ELSIF v_student.status <> 'active' THEN
            -- Aluno existe no tenant mas está inativo/suspenso -> Preservar fato físico para auditoria/análise administrativa
            INSERT INTO public.offline_contingency_events (
                tenant_id, unit_id, institution_id, terminal_id, operator_id,
                student_id, registration_attempted, meal_type_id, consumption_date,
                sequence_num, device_timestamp, idempotency_key, previous_event_hash,
                integrity_hash, status, conflict_reason, notes
            ) VALUES (
                v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_terminal_id, v_operator_id,
                v_student_id, v_registration_attempted, v_meal_type_id, v_consumption_date,
                v_sequence_num, v_device_timestamp, v_idempotency_key, v_prev_hash,
                v_integrity_hash, 'pending_administrative_review', 'STUDENT_INACTIVE_OR_SUSPENDED',
                'Refeição entregue offline para matrícula que se encontra inativa ou suspensa'
            );

            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'pending_administrative_review',
                'error_code', 'STUDENT_INACTIVE_OR_SUSPENDED',
                'message', 'Matrícula inativa. Fato físico preservado para análise administrativa.'
            );
            CONTINUE;
        END IF;

        -- D. Obter Regra de Preço Aplicável
        SELECT full_price, student_price, subsidy_amount
        INTO v_meal_rule
        FROM public.meal_rules
        WHERE tenant_id = v_caller_profile.tenant_id
          AND unit_id = v_unit_id
          AND category_id = v_student.category_id
          AND meal_type_id = v_meal_type_id
          AND effective_from <= v_device_timestamp
          AND (effective_to IS NULL OR effective_to > v_device_timestamp)
        ORDER BY effective_from DESC
        LIMIT 1;

        IF v_meal_rule.full_price IS NULL THEN
            v_full_price := 10.00;
            v_student_price := CASE WHEN v_student.is_integral THEN 0.00 ELSE 3.50 END;
            v_subsidy_amount := v_full_price - v_student_price;
        ELSE
            v_full_price := v_meal_rule.full_price;
            v_student_price := CASE WHEN v_student.is_integral THEN 0.00 ELSE v_meal_rule.student_price END;
            v_subsidy_amount := v_full_price - v_student_price;
        END IF;

        -- E. VERIFICAÇÃO DE COTA / CONSUMO DUPLICADO NO MESMO DIA E TIPO
        SELECT id, consumed_at, terminal_id, status
        INTO v_existing_consumption
        FROM public.meal_consumptions
        WHERE student_id = v_student_id
          AND consumption_date = v_consumption_date
          AND meal_type_id = v_meal_type_id
          AND status IN ('approved', 'financially_refunded')
        LIMIT 1;

        IF v_existing_consumption.id IS NOT NULL THEN
            -- =========================================================================
            -- CONFLITO OFFLINE (ENTREGA DUPLICADA EM CONTINGÊNCIA)
            -- REGRA DE OURO: Preserva o fato da entrega física, SEM SEGUNDO DÉBITO FINANCEIRO!
            -- =========================================================================
            INSERT INTO public.offline_contingency_events (
                tenant_id, unit_id, institution_id, terminal_id, operator_id,
                student_id, registration_attempted, meal_type_id, consumption_date,
                sequence_num, device_timestamp, idempotency_key, previous_event_hash,
                integrity_hash, status, conflict_reason, linked_consumption_id,
                financial_debit_applied, notes
            ) VALUES (
                v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_terminal_id, v_operator_id,
                v_student_id, v_registration_attempted, v_meal_type_id, v_consumption_date,
                v_sequence_num, v_device_timestamp, v_idempotency_key, v_prev_hash,
                v_integrity_hash, 'conflict_duplicate',
                'DUPLICATE_OFFLINE_DELIVERY_PREVIOUS_CONSUMPTION_EXISTS',
                v_existing_consumption.id,
                false,
                'Aluno recebeu refeição em terminal offline, mas já possuía consumo registrado hoje. Sem débito duplicado.'
            );

            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'conflict_duplicate',
                'linked_consumption_id', v_existing_consumption.id,
                'financial_debit_applied', false,
                'message', 'Entrega física preservada em conflito de auditoria. Segundo débito financeiro rejeitado.'
            );
            CONTINUE;
        END IF;

        -- F. CONSUMO REGULAR (PRIMEIRA REFEIÇÃO DO TURNO)
        IF v_student.is_integral THEN
            -- -------------------------------------------------------------
            -- F1. Bolsista Integral: Refeição Isenta (Subsídio 100%)
            -- -------------------------------------------------------------
            INSERT INTO public.meal_consumptions (
                tenant_id, unit_id, institution_id, student_id, category_id,
                meal_type_id, consumption_date, consumed_at, full_price,
                student_price, subsidy_amount, operator_id, terminal_id,
                verification_method, idempotency_key, status
            ) VALUES (
                v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_student_id, v_student.category_id,
                v_meal_type_id, v_consumption_date, v_device_timestamp, v_full_price,
                0.00, v_full_price, v_operator_id, v_terminal_id,
                'offline_contingency', v_idempotency_key, 'approved'
            ) RETURNING id INTO v_consumption_id;

            INSERT INTO public.offline_contingency_events (
                tenant_id, unit_id, institution_id, terminal_id, operator_id,
                student_id, registration_attempted, meal_type_id, consumption_date,
                sequence_num, device_timestamp, reconciled_at, idempotency_key,
                previous_event_hash, integrity_hash, status, linked_consumption_id,
                financial_debit_applied
            ) VALUES (
                v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_terminal_id, v_operator_id,
                v_student_id, v_registration_attempted, v_meal_type_id, v_consumption_date,
                v_sequence_num, v_device_timestamp, v_now, v_idempotency_key,
                v_prev_hash, v_integrity_hash, 'confirmed_regular', v_consumption_id,
                false
            );

            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'confirmed_regular',
                'linked_consumption_id', v_consumption_id,
                'financial_debit_applied', false,
                'message', 'Consumo de bolsista integral confirmado com sucesso.'
            );
        ELSE
            -- -------------------------------------------------------------
            -- F2. Aluno Parcial: Exige Débito no Livro-Razão Imutável
            -- -------------------------------------------------------------
            SELECT id, balance, status
            INTO v_wallet
            FROM public.wallets
            WHERE student_id = v_student_id
            FOR UPDATE;

            IF v_wallet.id IS NULL OR v_wallet.status <> 'active' THEN
                -- Carteira não encontrada ou inativa
                INSERT INTO public.offline_contingency_events (
                    tenant_id, unit_id, institution_id, terminal_id, operator_id,
                    student_id, registration_attempted, meal_type_id, consumption_date,
                    sequence_num, device_timestamp, idempotency_key, previous_event_hash,
                    integrity_hash, status, conflict_reason, notes
                ) VALUES (
                    v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_terminal_id, v_operator_id,
                    v_student_id, v_registration_attempted, v_meal_type_id, v_consumption_date,
                    v_sequence_num, v_device_timestamp, v_idempotency_key, v_prev_hash,
                    v_integrity_hash, 'pending_administrative_review', 'WALLET_INACTIVE_OR_NOT_FOUND',
                    'Entrega realizada offline porém carteira do aluno não está ativa'
                );

                v_results := v_results || jsonb_build_object(
                    'event_id', v_client_event_id,
                    'idempotency_key', v_idempotency_key,
                    'status', 'pending_administrative_review',
                    'error_code', 'WALLET_INACTIVE',
                    'message', 'Carteira inativa. Retido para revisão administrativa.'
                );
            ELSIF v_wallet.balance < v_student_price THEN
                -- ---------------------------------------------------------------------
                -- SALDO INSUFICIENTE PÓS-FATO (Snapshot offline desatualizado)
                -- Diretriz do Usuário: NÃO lança saldo negativo automático; preserva
                -- o fato físico em pending_administrative_review para regularização.
                -- ---------------------------------------------------------------------
                INSERT INTO public.offline_contingency_events (
                    tenant_id, unit_id, institution_id, terminal_id, operator_id,
                    student_id, registration_attempted, meal_type_id, consumption_date,
                    sequence_num, device_timestamp, idempotency_key, previous_event_hash,
                    integrity_hash, status, conflict_reason, financial_debit_applied, notes
                ) VALUES (
                    v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_terminal_id, v_operator_id,
                    v_student_id, v_registration_attempted, v_meal_type_id, v_consumption_date,
                    v_sequence_num, v_device_timestamp, v_idempotency_key, v_prev_hash,
                    v_integrity_hash, 'pending_administrative_review', 'INSUFFICIENT_FUNDS_POST_FACTUM',
                    false, 'Refeição entregue offline, mas saldo atual no banco é insuficiente. Sem débito negativo automático.'
                );

                v_results := v_results || jsonb_build_object(
                    'event_id', v_client_event_id,
                    'idempotency_key', v_idempotency_key,
                    'status', 'pending_administrative_review',
                    'error_code', 'INSUFFICIENT_FUNDS_POST_FACTUM',
                    'message', 'Saldo atual insuficiente. Fato preservado para conciliação administrativa sem saldo negativo.'
                );
            ELSE
                -- Saldo suficiente: Efetuar débito atômico no livro-razão imutável
                v_consumption_id := gen_random_uuid();

                INSERT INTO public.wallet_transactions (
                    tenant_id,
                    wallet_id,
                    student_id,
                    type,
                    amount,
                    balance_before,
                    balance_after,
                    reference_type,
                    reference_id,
                    description,
                    created_by
                ) VALUES (
                    v_caller_profile.tenant_id,
                    v_wallet.id,
                    v_student_id,
                    'meal_debit',
                    -v_student_price,
                    v_wallet.balance,
                    v_wallet.balance - v_student_price,
                    'meal_consumption',
                    v_consumption_id,
                    'Débito de refeição conciliada de contingência offline: ' || v_registration_attempted,
                    v_operator_id
                ) RETURNING id INTO v_wallet_tx_id;

                UPDATE public.wallets
                SET balance = balance - v_student_price,
                    updated_at = v_now
                WHERE id = v_wallet.id;

                INSERT INTO public.meal_consumptions (
                    id,
                    tenant_id, unit_id, institution_id, student_id, category_id,
                    meal_type_id, consumption_date, consumed_at, full_price,
                    student_price, subsidy_amount, wallet_transaction_id,
                    operator_id, terminal_id, verification_method, idempotency_key,
                    status
                ) VALUES (
                    v_consumption_id,
                    v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_student_id, v_student.category_id,
                    v_meal_type_id, v_consumption_date, v_device_timestamp, v_full_price,
                    v_student_price, v_subsidy_amount, v_wallet_tx_id,
                    v_operator_id, v_terminal_id, 'offline_contingency', v_idempotency_key,
                    'approved'
                );

                INSERT INTO public.offline_contingency_events (
                    tenant_id, unit_id, institution_id, terminal_id, operator_id,
                    student_id, registration_attempted, meal_type_id, consumption_date,
                    sequence_num, device_timestamp, reconciled_at, idempotency_key,
                    previous_event_hash, integrity_hash, status, linked_consumption_id,
                    financial_debit_applied, wallet_transaction_id
                ) VALUES (
                    v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_terminal_id, v_operator_id,
                    v_student_id, v_registration_attempted, v_meal_type_id, v_consumption_date,
                    v_sequence_num, v_device_timestamp, v_now, v_idempotency_key,
                    v_prev_hash, v_integrity_hash, 'confirmed_regular', v_consumption_id,
                    true, v_wallet_tx_id
                );

                v_results := v_results || jsonb_build_object(
                    'event_id', v_client_event_id,
                    'idempotency_key', v_idempotency_key,
                    'status', 'confirmed_regular',
                    'linked_consumption_id', v_consumption_id,
                    'financial_debit_applied', true,
                    'wallet_transaction_id', v_wallet_tx_id,
                    'message', 'Consumo parcial debitado e confirmado com sucesso.'
                );
            END IF;
        END IF;
    END LOOP;

    RETURN v_results;
END;
$function$
;

REVOKE ALL ON FUNCTION public.reconcile_offline_consumptions(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_offline_consumptions(JSONB) TO authenticated;
