-- ==============================================================================
-- Migration 36: Add Student Info to Blocked Returns in consume_meal
-- and Create get_terminal_shift_reports RPC
-- MA Refeições
-- Permite que a tela exiba nome do usuário em bloqueios e relatórios detalhados.
-- ==============================================================================

-- 1. Atualizar consume_meal para sempre retornar os dados do aluno quando identificado
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
    v_caller RECORD;
    v_unit RECORD;
    v_unit_meal RECORD;
    v_meal_rule RECORD;
    v_student RECORD;
    v_category RECORD;
    v_wallet RECORD;
    v_existing_consumption RECORD;
    v_token RECORD;
    v_qr_token_id UUID := NULL;
    v_card RECORD;
    v_method TEXT;
    v_clean_id TEXT;
    v_token_hash TEXT;
    v_consumption_date DATE;
    v_local_timestamp TIMESTAMP;
    v_local_time TIME;
    v_local_date DATE;
    v_full_price NUMERIC(10,2);
    v_student_price NUMERIC(10,2);
    v_subsidy_amount NUMERIC(10,2);
    v_balance_remaining NUMERIC(10,2);
    v_consumption_id UUID;
    v_wallet_tx_id UUID;
    v_lock_key BIGINT;
    v_student_json JSONB;
BEGIN
    -- 1. Autenticação e Permissão Operacional
    SELECT p.id, p.tenant_id, p.role INTO v_caller
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF v_caller.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'message', 'Autenticação necessária.');
    END IF;

    IF v_caller.role NOT IN ('admin_general', 'operations_director', 'unit_manager', 'supervisor', 'operator') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Perfil sem permissão operacional.');
    END IF;

    -- 2. Validação da Unidade Operacional
    SELECT u.id, u.tenant_id, u.institution_id, u.timezone, u.status INTO v_unit
    FROM public.units u
    WHERE u.id = p_unit_id;

    IF v_unit.id IS NULL OR v_unit.tenant_id <> v_caller.tenant_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED_UNIT', 'message', 'Unidade inválida para o operador.');
    END IF;

    IF v_unit.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNIT_UNAVAILABLE', 'message', 'Unidade desativada.');
    END IF;

    v_clean_id := trim(p_identifier);
    IF v_clean_id IS NULL OR length(v_clean_id) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_IDENTIFIER', 'message', 'Identificador vazio.');
    END IF;

    -- 3. Idempotência Preventiva
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        SELECT mc.* INTO v_existing_consumption
        FROM public.meal_consumptions mc
        WHERE mc.idempotency_key = p_idempotency_key AND mc.tenant_id = v_unit.tenant_id;

        IF v_existing_consumption.id IS NOT NULL THEN
            SELECT sc.* INTO v_category FROM public.student_categories sc WHERE sc.id = v_existing_consumption.category_id;
            SELECT s.* INTO v_student FROM public.students s WHERE s.id = v_existing_consumption.student_id;
            
            RETURN jsonb_build_object(
                'success', true,
                'idempotent_replay', true,
                'consumption_id', v_existing_consumption.id,
                'consumed_at', v_existing_consumption.consumed_at,
                'student', jsonb_build_object(
                    'id', v_student.id,
                    'full_name', v_student.full_name,
                    'registration_number', v_student.registration_number,
                    'category_code', v_category.code,
                    'is_integral', (v_category.code = 'integral' OR v_category.charge_percentage = 0.00),
                    'photo_path', v_student.photo_path
                ),
                'financial', jsonb_build_object(
                    'full_price', v_existing_consumption.full_price,
                    'student_price', v_existing_consumption.student_price,
                    'subsidy_amount', v_existing_consumption.subsidy_amount,
                    'wallet_transaction_id', v_existing_consumption.wallet_transaction_id
                )
            );
        END IF;
    END IF;

    -- 4. Resolução da Identidade do Comensal
    IF v_clean_id LIKE 'MAR:T:%' THEN
        v_method := 'qr_dynamic';
        v_token_hash := encode(digest(v_clean_id, 'sha256'), 'hex');

        SELECT * INTO v_token
        FROM public.qr_tokens
        WHERE token_hash = v_token_hash AND tenant_id = v_unit.tenant_id;

        IF v_token.id IS NULL THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_NOT_FOUND', 'QR code não encontrado no sistema.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_NOT_FOUND', 'message', 'QR code inválido.');
        END IF;

        IF v_token.status = 'revoked' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_REVOKED', 'QR code revogado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_REVOKED', 'message', 'QR code revogado.');
        END IF;

        IF v_token.status = 'used' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_ALREADY_USED', 'QR code já utilizado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_ALREADY_USED', 'message', 'QR code já utilizado.');
        END IF;

        IF v_token.expires_at < now() THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_EXPIRED', 'QR code expirado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_EXPIRED', 'message', 'QR code expirado.');
        END IF;

        v_qr_token_id := v_token.id;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_token.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id ~ '^[0-9A-Fa-f]{8,32}$' AND length(v_clean_id) IN (8, 14, 16, 20, 24, 32) THEN
        v_method := 'mifare_card';

        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.card_serial = upper(v_clean_id) AND c.tenant_id = v_unit.tenant_id;

        IF v_card.id IS NULL THEN
            v_method := 'registration_number';
            SELECT s.* INTO v_student
            FROM public.students s
            WHERE s.registration_number = v_clean_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

            IF v_student.id IS NULL THEN
                INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
                VALUES (v_unit.tenant_id, v_unit.id, 'mifare_card', 'PHYSICAL_CARD_NOT_FOUND', 'Cartão físico não cadastrado.', p_terminal_id, v_caller.id);
                RETURN jsonb_build_object('success', false, 'error_code', 'PHYSICAL_CARD_NOT_FOUND', 'message', 'Cartão físico não cadastrado.');
            END IF;
        ELSE
            IF v_card.status = 'blocked' THEN
                INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
                VALUES (v_unit.tenant_id, v_unit.id, v_method, 'PHYSICAL_CARD_BLOCKED', 'Cartão físico bloqueado.', p_terminal_id, v_caller.id);
                RETURN jsonb_build_object('success', false, 'error_code', 'PHYSICAL_CARD_BLOCKED', 'message', 'Cartão físico bloqueado.');
            END IF;

            SELECT s.* INTO v_student
            FROM public.students s
            WHERE s.id = v_card.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;
        END IF;

    ELSE
        v_method := 'registration_number';

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.registration_number = v_clean_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;
    END IF;

    -- Se o estudante não foi encontrado na base
    IF v_student.id IS NULL THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_clean_id, v_method, 'STUDENT_NOT_FOUND', 'Identificação não encontrada na instituição vinculada.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'STUDENT_NOT_FOUND', 
            'message', 'Identificação/matrícula não encontrada nesta instituição.',
            'attempted_identifier', v_clean_id
        );
    END IF;

    -- Busca a categoria do estudante
    SELECT * INTO v_category
    FROM public.student_categories
    WHERE id = v_student.category_id AND tenant_id = v_unit.tenant_id;

    -- Constrói o objeto JSON enriquecido do estudante para sempre acompanhar a resposta
    v_student_json := jsonb_build_object(
        'id', v_student.id,
        'full_name', v_student.full_name,
        'registration_number', v_student.registration_number,
        'category_code', COALESCE(v_category.code, 'estudante'),
        'category_name', COALESCE(v_category.name, 'Estudante'),
        'is_integral', (COALESCE(v_category.code, '') = 'integral' OR COALESCE(v_category.charge_percentage, 100.00) = 0.00),
        'photo_path', v_student.photo_path
    );

    IF v_student.status <> 'active' THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.registration_number, v_method, 'STUDENT_INACTIVE', 'Cadastro com status inativo/bloqueado.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'STUDENT_INACTIVE', 
            'message', 'Cadastro inativo ou trancado.',
            'student', v_student_json
        );
    END IF;

    -- 5. Determinação do Tipo de Refeição e Horário Operacional
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
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'MEAL_NOT_ENABLED_FOR_UNIT', 
            'message', 'Refeição não configurada ou inativa para esta unidade.',
            'student', v_student_json
        );
    END IF;

    -- Validação: Categoria tem permissão para este tipo de refeição?
    IF v_category.allowed_meal_types IS NOT NULL AND array_length(v_category.allowed_meal_types, 1) > 0 THEN
        IF NOT (v_unit_meal.meal_type_id = ANY(v_category.allowed_meal_types)) THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'MEAL_NOT_ALLOWED_FOR_CATEGORY', 'Tipo de refeição não autorizado para a categoria.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object(
                'success', false, 
                'error_code', 'MEAL_NOT_ALLOWED_FOR_CATEGORY', 
                'message', 'Esta refeição não é permitida para a categoria do comensal (' || v_category.name || ').',
                'student', v_student_json
            );
        END IF;
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
                    'end_time', v_unit_meal.end_time,
                    'student', v_student_json
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
                    'end_time', v_unit_meal.end_time,
                    'student', v_student_json
                );
            END IF;
            IF v_local_time <= v_unit_meal.end_time THEN
                v_consumption_date := v_local_date - 1;
            ELSE
                v_consumption_date := v_local_date;
            END IF;
        END IF;
    ELSE
        v_consumption_date := v_local_date;
    END IF;

    -- 6. Lock Adquirido por Usuário e Dia (Prevenção de Duplo Acesso Simultâneo)
    v_lock_key := ('x' || substr(md5(v_student.id::text || v_consumption_date::text || v_unit_meal.meal_type_id::text), 1, 15))::bit(60)::bigint;

    IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'CONCURRENT_CONSUMPTION_CONFLICT', 'Tentativa de consumo concorrente detectada.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'CONCURRENT_CONSUMPTION_CONFLICT', 
            'message', 'Operação concorrente em andamento para esta identificação.',
            'student', v_student_json
        );
    END IF;

    -- 7. Validação de Consumo Único Diário (Anti-Passback)
    IF NOT v_category.allow_multi_meal AND EXISTS (
        SELECT 1 FROM public.meal_consumptions
        WHERE student_id = v_student.id
          AND meal_type_id = v_unit_meal.meal_type_id
          AND consumption_date = v_consumption_date
          AND tenant_id = v_unit.tenant_id
          AND status IN ('approved', 'financially_refunded')
    ) THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'ALREADY_CONSUMED_TODAY', 'Usuário já utilizou a cota desta refeição na data operacional.', p_terminal_id, v_caller.id);
        
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'ALREADY_CONSUMED_TODAY', 
            'message', 'Usuário já realizou esta refeição no dia operacional de hoje (' || to_char(v_consumption_date, 'DD/MM/YYYY') || ').',
            'student', v_student_json
        );
    END IF;

    -- 8. Busca do Preço Base da Unidade (meal_rules)
    SELECT * INTO v_meal_rule
    FROM public.meal_rules
    WHERE unit_id = v_unit.id
      AND meal_type_id = v_unit_meal.meal_type_id
      AND tenant_id = v_unit.tenant_id
      AND enabled = true
      AND effective_from <= now()
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_meal_rule.id IS NULL THEN
        v_full_price := 15.00;
    ELSE
        v_full_price := v_meal_rule.full_price;
    END IF;

    -- 9. Cálculo Dinâmico de Preço com Base na Categoria
    IF v_category.pricing_type = 'percentage' THEN
        v_student_price := ROUND(v_full_price * (v_category.charge_percentage / 100.00), 2);
    ELSE
        v_student_price := LEAST(COALESCE(v_category.fixed_price, v_full_price), v_full_price);
    END IF;

    v_subsidy_amount := v_full_price - v_student_price;
    v_consumption_id := gen_random_uuid();

    -- 10. Processamento Financeiro
    IF v_category.payment_mode = 'on_entry' OR v_category.code = 'visitante' THEN
        v_wallet_tx_id := NULL;
        v_balance_remaining := NULL;
    ELSIF v_student_price = 0.00 THEN
        v_wallet_tx_id := NULL;
        v_balance_remaining := NULL;
    ELSE
        SELECT * INTO v_wallet
        FROM public.wallets
        WHERE student_id = v_student.id AND tenant_id = v_unit.tenant_id
        FOR UPDATE;

        IF v_wallet.id IS NULL THEN
            INSERT INTO public.wallets (tenant_id, student_id, balance, status)
            VALUES (v_unit.tenant_id, v_student.id, 0.00, 'active')
            RETURNING * INTO v_wallet;
        END IF;

        IF v_wallet.status <> 'active' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'WALLET_INACTIVE', 'Carteira inativa (' || v_wallet.status || ').', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object(
                'success', false, 
                'error_code', 'WALLET_INACTIVE', 
                'message', 'Carteira financeira está inativa ou bloqueada.',
                'student', v_student_json
            );
        END IF;

        IF v_wallet.balance < v_student_price THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'INSUFFICIENT_FUNDS', 'Saldo insuficiente: R$ ' || v_wallet.balance, p_terminal_id, v_caller.id);
            RETURN jsonb_build_object(
                'success', false,
                'error_code', 'INSUFFICIENT_FUNDS',
                'message', 'Saldo insuficiente para liberação da refeição.',
                'required_amount', v_student_price,
                'current_balance', v_wallet.balance,
                'student', v_student_json
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
            'Consumo de refeição (' || v_unit_meal.meal_type_id || ') na unidade ' || v_unit.id,
            v_caller.id
        ) RETURNING id INTO v_wallet_tx_id;
    END IF;

    -- 11. Inserção do Registro de Consumo
    INSERT INTO public.meal_consumptions (
        id,
        tenant_id,
        unit_id,
        institution_id,
        meal_type_id,
        student_id,
        category_id,
        verification_method,
        consumed_at,
        consumption_date,
        full_price,
        student_price,
        subsidy_amount,
        terminal_id,
        operator_id,
        wallet_transaction_id,
        qr_token_id,
        idempotency_key,
        status
    ) VALUES (
        v_consumption_id,
        v_unit.tenant_id,
        v_unit.id,
        v_unit.institution_id,
        v_unit_meal.meal_type_id,
        v_student.id,
        v_category.id,
        v_method,
        now(),
        v_consumption_date,
        v_full_price,
        v_student_price,
        v_subsidy_amount,
        p_terminal_id,
        v_caller.id,
        v_wallet_tx_id,
        v_qr_token_id,
        p_idempotency_key,
        'approved'
    );

    -- 12. Se QR Code, marca como utilizado
    IF v_qr_token_id IS NOT NULL THEN
        UPDATE public.qr_tokens
        SET status = 'used',
            used_at = now()
        WHERE id = v_qr_token_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'consumption_id', v_consumption_id,
        'consumed_at', now(),
        'student', v_student_json,
        'financial', jsonb_build_object(
            'full_price', v_full_price,
            'student_price', v_student_price,
            'subsidy_amount', v_subsidy_amount,
            'balance_remaining', v_balance_remaining,
            'wallet_transaction_id', v_wallet_tx_id
        )
    );
END;
$$;


-- 2. Criar RPC para consulta consolidada dos relatórios de refeições do turno (Aprovadas e Bloqueadas)
CREATE OR REPLACE FUNCTION public.get_terminal_shift_reports(
    p_unit_id UUID,
    p_meal_type_id UUID DEFAULT NULL,
    p_terminal_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller RECORD;
    v_unit RECORD;
    v_approved JSONB;
    v_blocked JSONB;
    v_today DATE;
BEGIN
    SELECT p.id, p.tenant_id, p.role INTO v_caller
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF v_caller.id IS NULL THEN
        RAISE EXCEPTION 'Autenticação necessária.';
    END IF;

    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Acesso não autorizado para esta unidade.';
    END IF;

    SELECT timezone INTO v_unit FROM public.units WHERE id = p_unit_id;
    v_today := (timezone(COALESCE(v_unit.timezone, 'America/Sao_Paulo'), now()))::date;

    -- Refeições Aprovadas no Turno
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_approved
    FROM (
        SELECT 
            mc.id,
            mc.consumed_at,
            s.full_name,
            s.registration_number,
            COALESCE(sc.name, 'Estudante') as category_name,
            COALESCE(sc.code, 'estudante') as category_code,
            mc.student_price,
            mc.full_price,
            mc.subsidy_amount,
            mc.verification_method,
            mc.terminal_id,
            p.full_name as operator_name,
            mc.status
        FROM public.meal_consumptions mc
        INNER JOIN public.students s ON s.id = mc.student_id
        LEFT JOIN public.student_categories sc ON sc.id = mc.category_id
        LEFT JOIN public.profiles p ON p.id = mc.operator_id
        WHERE mc.unit_id = p_unit_id
          AND mc.tenant_id = v_caller.tenant_id
          AND mc.consumption_date = v_today
          AND (p_meal_type_id IS NULL OR mc.meal_type_id = p_meal_type_id)
          AND (p_terminal_id IS NULL OR mc.terminal_id = p_terminal_id)
        ORDER BY mc.consumed_at DESC
        LIMIT 500
    ) t;

    -- Tentativas Bloqueadas no Turno
    SELECT COALESCE(jsonb_agg(row_to_json(b)), '[]'::jsonb) INTO v_blocked
    FROM (
        SELECT 
            ba.id,
            ba.attempted_at,
            s.full_name,
            COALESCE(s.registration_number, ba.registration_attempted) as registration_number,
            COALESCE(sc.name, 'Geral') as category_name,
            ba.reason_code,
            ba.reason_message,
            ba.verification_method,
            ba.terminal_id
        FROM public.blocked_attempts ba
        LEFT JOIN public.students s ON s.id = ba.student_id
        LEFT JOIN public.student_categories sc ON sc.id = ba.category_id
        WHERE ba.unit_id = p_unit_id
          AND ba.tenant_id = v_caller.tenant_id
          AND ba.attempted_at::date = v_today
          AND (p_meal_type_id IS NULL OR ba.meal_type_id = p_meal_type_id)
          AND (p_terminal_id IS NULL OR ba.terminal_id = p_terminal_id)
        ORDER BY ba.attempted_at DESC
        LIMIT 500
    ) b;

    RETURN jsonb_build_object(
        'success', true,
        'approved_meals', v_approved,
        'blocked_attempts', v_blocked
    );
END;
$$;
