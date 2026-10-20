-- ==============================================================================
-- Migration: 20260927000030_fix_lock_timeout_handling.sql
-- Descrição: Hardening de concorrência com captura estrita do SQLSTATE 55P03
--            (lock_not_available / query_canceled) na RPC consume_meal(),
--            preservação integral de rollback atômico, inclusão de
--            LOCK_TIMEOUT_EXCEEDED no catálogo de auditoria de blocked_attempts,
--            inclusão de extensions no search_path para funções criptográficas (digest)
--            e saneamento de variáveis de registro não inicializadas.
-- ==============================================================================

-- 1. Atualizar Constraint de Catálogo de Bloqueios em blocked_attempts
ALTER TABLE public.blocked_attempts 
    DROP CONSTRAINT IF EXISTS chk_blocked_attempts_reason;

ALTER TABLE public.blocked_attempts 
    ADD CONSTRAINT chk_blocked_attempts_reason CHECK (reason_code IN (
        'AUTH_REQUIRED',
        'UNAUTHORIZED_CALLER',
        'PERMISSION_DENIED',
        'ACCESS_DENIED_UNIT',
        'UNIT_UNAVAILABLE',
        'INVALID_IDENTIFIER',
        'INVALID_IDENTIFIER_FORMAT',
        'IDEMPOTENCY_KEY_REUSE_MISMATCH',
        'STUDENT_NOT_FOUND',
        'STUDENT_INACTIVE',
        'CARD_INACTIVE',
        'TOKEN_NOT_FOUND',
        'TOKEN_REVOKED',
        'TOKEN_ALREADY_USED',
        'TOKEN_EXPIRED',
        'PHYSICAL_CARD_NOT_FOUND',
        'MEAL_NOT_ENABLED_FOR_UNIT',
        'OUT_OF_SCHEDULE',
        'ALREADY_CONSUMED_TODAY',
        'NO_PRICE_RULE_CONFIGURED',
        'WALLET_NOT_FOUND',
        'WALLET_INACTIVE',
        'INSUFFICIENT_FUNDS',
        'CONCURRENT_CONSUMPTION_CONFLICT',
        'LOCK_TIMEOUT_EXCEEDED'
    ));

-- 2. Recriação da RPC consume_meal com Bloco EXCEPTION Específico para 55P03
CREATE OR REPLACE FUNCTION public.consume_meal(
    p_unit_id UUID,
    p_identifier TEXT,
    p_meal_type_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_terminal_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_unit RECORD;
    v_clean_id TEXT;
    v_clean_idempotency TEXT;
    v_request_hash TEXT;
    v_method TEXT;
    v_token_hash TEXT;
    v_token RECORD;
    v_qr_token_id UUID := NULL;
    v_card RECORD;
    v_student RECORD;
    v_category RECORD;
    v_unit_meal RECORD;
    v_local_timestamp TIMESTAMP WITHOUT TIME ZONE;
    v_local_date DATE;
    v_local_time TIME WITHOUT TIME ZONE;
    v_consumption_date DATE;
    v_existing_consumption RECORD;
    v_meal_rule RECORD;
    v_full_price NUMERIC(12, 2);
    v_student_price NUMERIC(12, 2);
    v_subsidy_amount NUMERIC(12, 2);
    v_consumption_id UUID;
    v_wallet RECORD;
    v_wallet_tx_id UUID := NULL;
    v_balance_remaining NUMERIC(12, 2) := NULL;
    v_lock_key BIGINT;
BEGIN
    -- -------------------------------------------------------------------------
    -- 0. Configurar Timeout Operacional Estrito para Evitar Retenção de Catraca
    -- -------------------------------------------------------------------------
    SET LOCAL lock_timeout = '2000ms';

    -- -------------------------------------------------------------------------
    -- 1. Autenticação e Autorização do Operador
    -- -------------------------------------------------------------------------
    IF v_caller_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'message', 'Operação exige usuário autenticado.');
    END IF;

    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Perfil inativo ou inexistente.');
    END IF;

    IF v_caller.role NOT IN ('operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Perfil sem permissão operacional para registro de refeições.');
    END IF;

    -- Validar escopo de unidade do operador
    IF NOT public.has_unit_access(p_unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED_UNIT', 'message', 'Operador sem permissão de acesso à unidade.');
    END IF;

    SELECT id, tenant_id, institution_id, timezone, status INTO v_unit
    FROM public.units
    WHERE id = p_unit_id AND tenant_id = v_caller.tenant_id;

    IF v_unit.id IS NULL OR v_unit.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNIT_UNAVAILABLE', 'message', 'Unidade inativa ou de outro tenant.');
    END IF;

    -- -------------------------------------------------------------------------
    -- 2. Normalização e Validação do Identificador e Idempotência
    -- -------------------------------------------------------------------------
    v_clean_id := trim(p_identifier);
    IF v_clean_id IS NULL OR v_clean_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_IDENTIFIER', 'message', 'Identificador de aluno obrigatório.');
    END IF;

    v_clean_idempotency := trim(p_idempotency_key);
    IF v_clean_idempotency IS NULL OR v_clean_idempotency = '' THEN
        v_clean_idempotency := gen_random_uuid()::text;
    END IF;

    -- Hash canônico da requisição para proteção contra reuso indevido de chave de idempotência
    v_request_hash := encode(digest(v_clean_id || ':' || p_unit_id::text || ':' || COALESCE(p_meal_type_id::text, 'auto'), 'sha256'), 'hex');

    -- -------------------------------------------------------------------------
    -- 3. Verificação de Idempotência
    -- -------------------------------------------------------------------------
    SELECT * INTO v_existing_consumption
    FROM public.meal_consumptions
    WHERE idempotency_key = v_clean_idempotency AND tenant_id = v_unit.tenant_id;

    IF v_existing_consumption.id IS NOT NULL THEN
        -- Se a mesma chave foi enviada com parâmetros divergentes, bloquear categoricamente
        IF v_existing_consumption.request_hash IS DISTINCT FROM v_request_hash THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, 'unknown', 'IDEMPOTENCY_KEY_REUSE_MISMATCH', 'Reuso espúrio de chave de idempotência com parâmetros distintos.', p_terminal_id, v_caller.id);
            
            RETURN jsonb_build_object(
                'success', false, 
                'error_code', 'IDEMPOTENCY_KEY_REUSE_MISMATCH', 
                'message', 'Chave de idempotência já utilizada com outros parâmetros operacionais.'
            );
        END IF;

        -- Reenvio legítimo idêntico: retornar o consumo original de forma segura e transparente
        SELECT s.* INTO v_student FROM public.students s WHERE s.id = v_existing_consumption.student_id;
        SELECT sc.* INTO v_category FROM public.student_categories sc WHERE sc.id = v_existing_consumption.category_id;

        RETURN jsonb_build_object(
            'success', true,
            'status', v_existing_consumption.status,
            'consumption_id', v_existing_consumption.id,
            'consumed_at', v_existing_consumption.consumed_at,
            'consumption_date', v_existing_consumption.consumption_date,
            'already_processed', true,
            'student', jsonb_build_object(
                'id', v_student.id,
                'full_name', v_student.full_name,
                'registration_number', v_student.registration_number,
                'category_code', v_category.code,
                'is_integral', (v_category.code = 'integral')
            ),
            'financial', jsonb_build_object(
                'student_price', v_existing_consumption.student_price,
                'subsidy_amount', v_existing_consumption.subsidy_amount
            )
        );
    END IF;

    -- -------------------------------------------------------------------------
    -- 4. Resolução da Identidade do Aluno e Validação do Método
    -- -------------------------------------------------------------------------
    IF v_clean_id LIKE 'MAR:Q1:%' THEN
        v_method := 'qr_dynamic';
        v_token_hash := encode(digest(substring(v_clean_id FROM 8), 'sha256'), 'hex');

        SELECT qt.* INTO v_token
        FROM public.qr_tokens qt
        WHERE qt.token_hash = v_token_hash AND qt.tenant_id = v_unit.tenant_id;

        IF v_token.id IS NULL THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_NOT_FOUND', 'QR Code não localizado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_NOT_FOUND', 'message', 'QR Code não localizado.');
        END IF;

        v_qr_token_id := v_token.id;

        IF v_token.status = 'revoked' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_REVOKED', 'QR Code revogado por nova emissão.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_REVOKED', 'message', 'QR Code foi revogado por uma nova emissão.');
        END IF;

        IF v_token.status = 'used' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_ALREADY_USED', 'QR Code de uso único já utilizado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_ALREADY_USED', 'message', 'QR Code já foi utilizado.');
        END IF;

        IF v_token.expires_at <= clock_timestamp() THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_EXPIRED', 'QR Code expirado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_EXPIRED', 'message', 'QR Code expirado.');
        END IF;

        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.id = v_token.card_id AND c.tenant_id = v_unit.tenant_id AND c.status = 'active';

        IF v_card.id IS NULL THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'CARD_INACTIVE', 'Carteirinha vinculada ao token inativa ou bloqueada.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'CARD_INACTIVE', 'message', 'Carteirinha digital inativa ou bloqueada.');
        END IF;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_card.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:C1:%' THEN
        v_method := 'physical_card';
        v_token_hash := encode(digest(substring(v_clean_id FROM 8), 'sha256'), 'hex');

        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.tenant_id = v_unit.tenant_id AND c.card_type = 'physical' AND c.physical_code_hash = v_token_hash AND c.status = 'active';

        IF v_card.id IS NULL THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'PHYSICAL_CARD_NOT_FOUND', 'Cartão físico inativo ou não cadastrado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'PHYSICAL_CARD_NOT_FOUND', 'message', 'Cartão físico não cadastrado ou inativo.');
        END IF;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_card.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:%' THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, 'unknown', 'INVALID_IDENTIFIER_FORMAT', 'Prefixo de identificador não suportado: ' || v_clean_id, p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_IDENTIFIER_FORMAT', 'message', 'Formato de identificador inválido.');

    ELSE
        v_method := 'registration_number';

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.registration_number = v_clean_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;
    END IF;

    IF v_student.id IS NULL THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_clean_id, v_method, 'STUDENT_NOT_FOUND', 'Estudante não encontrado na instituição vinculada.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'STUDENT_NOT_FOUND', 'message', 'Aluno não encontrado para esta instituição.');
    END IF;

    IF v_student.status <> 'active' THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.registration_number, v_method, 'STUDENT_INACTIVE', 'Estudante com status inativo/bloqueado.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'STUDENT_INACTIVE', 'message', 'Matrícula do estudante encontra-se inativa ou trancada.');
    END IF;

    SELECT id, code, name INTO v_category
    FROM public.student_categories
    WHERE id = v_student.category_id AND tenant_id = v_unit.tenant_id;

    -- -------------------------------------------------------------------------
    -- 5. Determinação do Tipo de Refeição e Horário Operacional
    -- -------------------------------------------------------------------------
    v_local_timestamp := timezone(COALESCE(v_unit.timezone, 'America/Sao_Paulo'), now());
    v_local_date := v_local_timestamp::date;
    v_local_time := v_local_timestamp::time;

    IF p_meal_type_id IS NOT NULL THEN
        SELECT umt.* INTO v_unit_meal
        FROM public.unit_meal_types umt
        WHERE umt.unit_id = v_unit.id AND umt.meal_type_id = p_meal_type_id AND umt.tenant_id = v_unit.tenant_id;
    ELSE
        SELECT umt.* INTO v_unit_meal
        FROM public.unit_meal_types umt
        WHERE umt.unit_id = v_unit.id
          AND umt.tenant_id = v_unit.tenant_id
          AND umt.enabled = true
          AND (
            (umt.start_time <= umt.end_time AND v_local_time BETWEEN umt.start_time AND umt.end_time)
            OR
            (umt.start_time > umt.end_time AND (v_local_time >= umt.start_time OR v_local_time <= umt.end_time))
          )
        ORDER BY umt.start_time ASC
        LIMIT 1;
    END IF;

    IF v_unit_meal.id IS NULL OR NOT v_unit_meal.enabled THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_student.registration_number, v_method, 'MEAL_NOT_ENABLED_FOR_UNIT', 'Refeição não habilitada na unidade.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'MEAL_NOT_ENABLED_FOR_UNIT', 'message', 'Refeição não configurada ou inativa para esta unidade.');
    END IF;

    -- Validação de Janela de Horário
    IF v_unit_meal.start_time IS NOT NULL AND v_unit_meal.end_time IS NOT NULL THEN
        IF v_unit_meal.start_time <= v_unit_meal.end_time THEN
            IF v_local_time < v_unit_meal.start_time OR v_local_time > v_unit_meal.end_time THEN
                INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
                VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'OUT_OF_SCHEDULE', 'Fora do horário de atendimento.', p_terminal_id, v_caller.id);
                RETURN jsonb_build_object(
                    'success', false, 
                    'error_code', 'OUT_OF_SCHEDULE', 
                    'message', 'Horário atual (' || to_char(v_local_time, 'HH24:MI') || ') fora da janela de atendimento da refeição.',
                    'start_time', v_unit_meal.start_time,
                    'end_time', v_unit_meal.end_time
                );
            END IF;
            v_consumption_date := v_local_date;
        ELSE
            IF v_local_time < v_unit_meal.start_time AND v_local_time > v_unit_meal.end_time THEN
                INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
                VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'OUT_OF_SCHEDULE', 'Fora do horário noturno de atendimento.', p_terminal_id, v_caller.id);
                RETURN jsonb_build_object(
                    'success', false, 
                    'error_code', 'OUT_OF_SCHEDULE', 
                    'message', 'Horário atual fora da janela noturna de atendimento.',
                    'start_time', v_unit_meal.start_time,
                    'end_time', v_unit_meal.end_time
                );
            END IF;

            IF v_local_time <= v_unit_meal.end_time THEN
                v_consumption_date := v_local_date - INTERVAL '1 day';
            ELSE
                v_consumption_date := v_local_date;
            END IF;
        END IF;
    ELSE
        v_consumption_date := v_local_date;
    END IF;

    -- -------------------------------------------------------------------------
    -- 6. Lock 1: Lock de Aluno para Concorrência e Cota Única por Turno
    -- -------------------------------------------------------------------------
    v_lock_key := ('x' || substr(md5(v_student.id::text || ':' || v_consumption_date::text || ':' || v_unit_meal.meal_type_id::text), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- -------------------------------------------------------------------------
    -- 7. Verificação de Duplicidade no Dia Operacional
    -- -------------------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM public.meal_consumptions
        WHERE student_id = v_student.id
          AND meal_type_id = v_unit_meal.meal_type_id
          AND consumption_date = v_consumption_date
          AND tenant_id = v_unit.tenant_id
          AND status IN ('approved', 'financially_refunded')
    ) THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'ALREADY_CONSUMED_TODAY', 'Aluno já utilizou a cota desta refeição na data operacional.', p_terminal_id, v_caller.id);
        
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'ALREADY_CONSUMED_TODAY', 
            'message', 'Aluno já realizou esta refeição no dia operacional de hoje (' || to_char(v_consumption_date, 'DD/MM/YYYY') || ').'
        );
    END IF;

    -- -------------------------------------------------------------------------
    -- 8. Busca de Regra de Preço Vigente
    -- -------------------------------------------------------------------------
    SELECT * INTO v_meal_rule
    FROM public.meal_rules
    WHERE unit_id = v_unit.id
      AND meal_type_id = v_unit_meal.meal_type_id
      AND category_id = v_student.category_id
      AND tenant_id = v_unit.tenant_id
      AND enabled = true
      AND effective_from <= now()
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_meal_rule.id IS NULL THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'NO_PRICE_RULE_CONFIGURED', 'Regra de preço não configurada.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'NO_PRICE_RULE_CONFIGURED', 'message', 'Regra de preço não configurada para a categoria do estudante.');
    END IF;

    v_full_price := v_meal_rule.full_price;
    v_consumption_id := gen_random_uuid();

    -- -------------------------------------------------------------------------
    -- 9. Processamento Financeiro e Lock 2 (Carteira)
    -- -------------------------------------------------------------------------
    IF v_category.code = 'integral' THEN
        v_student_price := 0.00;
        v_subsidy_amount := v_full_price;
        v_wallet_tx_id := NULL;
        v_balance_remaining := NULL;
    ELSE
        SELECT * INTO v_wallet
        FROM public.wallets
        WHERE student_id = v_student.id AND tenant_id = v_unit.tenant_id
        FOR UPDATE;

        IF v_wallet.id IS NULL THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'WALLET_NOT_FOUND', 'Carteira não localizada para aluno parcial.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'WALLET_NOT_FOUND', 'message', 'Carteira financeira do aluno não localizada.');
        END IF;

        IF v_wallet.status <> 'active' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'WALLET_INACTIVE', 'Carteira inativa (' || v_wallet.status || ').', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'WALLET_INACTIVE', 'message', 'Carteira financeira está inativa ou bloqueada.');
        END IF;

        v_student_price := v_meal_rule.student_price;
        v_subsidy_amount := v_meal_rule.subsidy_amount;

        IF v_student_price > 0.00 THEN
            IF v_wallet.balance < v_student_price THEN
                INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
                VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'INSUFFICIENT_FUNDS', 'Saldo insuficiente: R$ ' || v_wallet.balance, p_terminal_id, v_caller.id);
                RETURN jsonb_build_object(
                    'success', false,
                    'error_code', 'INSUFFICIENT_FUNDS',
                    'message', 'Saldo insuficiente para liberação da refeição.',
                    'required_amount', v_student_price,
                    'current_balance', v_wallet.balance
                );
            END IF;

            UPDATE public.wallets
            SET balance = balance - v_student_price,
                updated_at = now()
            WHERE id = v_wallet.id;

            v_balance_remaining := v_wallet.balance - v_student_price;

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
                v_unit.tenant_id,
                v_wallet.id,
                v_student.id,
                'meal_debit',
                -v_student_price,
                v_wallet.balance,
                v_balance_remaining,
                'meal_consumption',
                v_consumption_id,
                'Débito de refeição no restaurante: ' || v_clean_id,
                v_caller.id
            ) RETURNING id INTO v_wallet_tx_id;
        ELSE
            v_wallet_tx_id := NULL;
            v_balance_remaining := v_wallet.balance;
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- 10. Lock 3 e Queima Atômica do QR Token Dinâmico (Se aplicável)
    -- -------------------------------------------------------------------------
    IF v_method = 'qr_dynamic' THEN
        UPDATE public.qr_tokens
        SET status = 'used',
            used_at = now()
        WHERE id = v_token.id;
    END IF;

    -- -------------------------------------------------------------------------
    -- 11. Registro do Consumo Aprovado
    -- -------------------------------------------------------------------------
    INSERT INTO public.meal_consumptions (
        id,
        tenant_id,
        unit_id,
        institution_id,
        student_id,
        category_id,
        meal_type_id,
        consumption_date,
        consumed_at,
        full_price,
        student_price,
        subsidy_amount,
        wallet_transaction_id,
        operator_id,
        terminal_id,
        verification_method,
        idempotency_key,
        request_hash,
        qr_token_id,
        status
    ) VALUES (
        v_consumption_id,
        v_unit.tenant_id,
        v_unit.id,
        v_student.institution_id,
        v_student.id,
        v_student.category_id,
        v_unit_meal.meal_type_id,
        v_consumption_date,
        now(),
        v_full_price,
        v_student_price,
        v_subsidy_amount,
        v_wallet_tx_id,
        v_caller.id,
        p_terminal_id,
        v_method,
        v_clean_idempotency,
        v_request_hash,
        v_qr_token_id,
        'approved'
    );

    -- -------------------------------------------------------------------------
    -- 12. Resposta Estruturada para o Terminal
    -- -------------------------------------------------------------------------
    RETURN jsonb_build_object(
        'success', true,
        'status', 'approved',
        'consumption_id', v_consumption_id,
        'consumed_at', now(),
        'consumption_date', v_consumption_date,
        'student', jsonb_build_object(
            'id', v_student.id,
            'full_name', v_student.full_name,
            'registration_number', v_student.registration_number,
            'course', v_student.course,
            'photo_path', v_student.photo_path,
            'category_code', v_category.code,
            'is_integral', (v_category.code = 'integral')
        ),
        'financial', jsonb_build_object(
            'student_price', v_student_price,
            'subsidy_amount', v_subsidy_amount,
            'balance_remaining', v_balance_remaining
        )
    );

-- -----------------------------------------------------------------------------
-- 13. Tratamento Estrito de Exceção SQLSTATE 55P03 (LOCK TIMEOUT)
-- -----------------------------------------------------------------------------
EXCEPTION
    WHEN lock_not_available THEN
        -- O bloco de exceção captura especificamente o SQLSTATE 55P03 (lock_timeout)
        -- e reverte automaticamente qualquer comando executado anteriormente no bloco,
        -- preservando integralmente a atomicidade financeira e o saldo do aluno.
        -- Auditoria autônoma do bloqueio por timeout de concorrência (55P03)
        INSERT INTO public.blocked_attempts (
            tenant_id, unit_id, student_id, verification_method,
            reason_code, reason_message, terminal_id, operator_id
        )
        VALUES (
            COALESCE(v_unit.tenant_id, v_caller.tenant_id),
            p_unit_id,
            v_student.id,
            COALESCE(v_method, 'unknown'),
            'LOCK_TIMEOUT_EXCEEDED',
            'Tempo limite de bloqueio (2s) atingido sob concorrência simultânea.',
            p_terminal_id,
            v_caller.id
        );

        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'LOCK_TIMEOUT_EXCEEDED',
            'message', 'Operação em processamento por outro terminal. Tente novamente em instantes.'
        );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;

-- 3. Atualização de resolve_student_identity e RPCs acessórias para search_path e projeção de categoria
CREATE OR REPLACE FUNCTION public.resolve_student_identity(
    p_unit_id UUID,
    p_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_unit RECORD;
    v_clean_id TEXT;
    v_token_hash TEXT;
    v_student RECORD;
    v_category RECORD;
    v_card RECORD;
    v_token RECORD;
    v_method TEXT;
BEGIN
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Operador não autenticado.';
    END IF;

    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED_CALLER: Perfil inativo ou inexistente.';
    END IF;

    IF v_caller.role NOT IN ('operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem autorização para identificação de alunos.';
    END IF;

    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Operador sem permissão de acesso à unidade.';
    END IF;

    SELECT id, tenant_id, institution_id, status INTO v_unit
    FROM public.units
    WHERE id = p_unit_id AND tenant_id = v_caller.tenant_id;

    IF v_unit.id IS NULL OR v_unit.status <> 'active' THEN
        RAISE EXCEPTION 'UNIT_UNAVAILABLE: Unidade inativa ou de outro tenant.';
    END IF;

    v_clean_id := trim(p_identifier);
    IF v_clean_id IS NULL OR v_clean_id = '' THEN
        RAISE EXCEPTION 'INVALID_IDENTIFIER: Identificador não informado.';
    END IF;

    IF v_clean_id LIKE 'MAR:Q1:%' THEN
        v_method := 'qr_dynamic';
        v_token_hash := encode(digest(substring(v_clean_id FROM 8), 'sha256'), 'hex');

        SELECT qt.* INTO v_token
        FROM public.qr_tokens qt
        WHERE qt.token_hash = v_token_hash AND qt.tenant_id = v_unit.tenant_id;

        IF v_token.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_NOT_FOUND', 'message', 'QR Code não localizado.');
        END IF;

        IF v_token.status = 'revoked' THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_REVOKED', 'message', 'QR Code foi revogado por uma nova emissão.');
        END IF;

        IF v_token.status = 'used' THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_ALREADY_USED', 'message', 'QR Code de uso único já utilizado.');
        END IF;

        IF v_token.status <> 'active' THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_INACTIVE', 'message', 'Status do QR Code inválido.');
        END IF;

        IF v_token.expires_at <= clock_timestamp() THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_EXPIRED', 'message', 'QR Code expirado.');
        END IF;

        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.id = v_token.card_id AND c.tenant_id = v_unit.tenant_id AND c.status = 'active';

        IF v_card.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'CARD_INACTIVE', 'message', 'Carteirinha digital inativa ou bloqueada.');
        END IF;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_card.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:C1:%' THEN
        v_method := 'physical_card';
        v_token_hash := encode(digest(substring(v_clean_id FROM 8), 'sha256'), 'hex');

        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.tenant_id = v_unit.tenant_id AND c.card_type = 'physical' AND c.physical_code_hash = v_token_hash AND c.status = 'active';

        IF v_card.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'PHYSICAL_CARD_NOT_FOUND', 'message', 'Cartão físico não cadastrado ou inativo.');
        END IF;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_card.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:%' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNSUPPORTED_PREFIX', 'message', 'Prefixo de cartão não suportado.');

    ELSE
        v_method := 'registration_number';

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.registration_number = v_clean_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;
    END IF;

    IF v_student.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'STUDENT_NOT_FOUND', 
            'message', 'Aluno não encontrado para a instituição vinculada a este restaurante.'
        );
    END IF;

    IF v_student.status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'STUDENT_INACTIVE', 
            'message', 'Cadastro do aluno está ' || v_student.status || '.'
        );
    END IF;

    SELECT id, name, code INTO v_category
    FROM public.student_categories
    WHERE id = v_student.category_id AND tenant_id = v_unit.tenant_id;

    RETURN jsonb_build_object(
        'success', true,
        'identification_method', v_method,
        'token_id', CASE WHEN v_method = 'qr_dynamic' THEN v_token.id ELSE NULL END,
        'student', jsonb_build_object(
            'id', v_student.id,
            'registration_number', v_student.registration_number,
            'full_name', v_student.full_name,
            'course', v_student.course,
            'photo_path', v_student.photo_path,
            'status', v_student.status,
            'category', jsonb_build_object(
                'id', v_category.id,
                'name', v_category.name,
                'code', v_category.code,
                'is_integral', (v_category.code = 'integral')
            )
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_student_identity(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_student_identity(UUID, TEXT) TO authenticated;

-- 4. Garantir que outras funções de emissão possuam schema extensions no search_path
ALTER FUNCTION public.admin_issue_card(UUID, TEXT, TEXT) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.generate_student_qr_token(UUID) SET search_path = public, extensions, pg_temp;
