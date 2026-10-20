-- ==============================================================================
-- Migration: 20260927000033_support_visitor_category_and_multi_meal.sql
-- Descrição: 1. Suporte a categorias 'visitante' e 'servidor' no catálogo de categorias
--            2. Isenção da trava de cota única diária (ALREADY_CONSUMED_TODAY) para visitantes
--            3. Cobrança do valor integral por refeição com débito a cada passagem
--            4. Isenção de conflito de duplicidade na reconciliação offline
--            5. Mensagens neutras e inclusivas para todos os comensais
-- ==============================================================================

-- 1. Atualizar provisionamento padrão de categorias
CREATE OR REPLACE FUNCTION public.provision_default_student_categories(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.student_categories (tenant_id, code, name, description, requires_wallet, status)
    VALUES 
        (p_tenant_id, 'integral', 'Bolsista Integral', 'Isento de pagamento de refeições', false, 'active'),
        (p_tenant_id, 'partial', 'Bolsista Parcial / Pagante', 'Exige recarga na carteira para consumo', true, 'active'),
        (p_tenant_id, 'servidor', 'Servidor / Colaborador', 'Servidores, docentes e funcionários da instituição', true, 'active'),
        (p_tenant_id, 'visitante', 'Visitante', 'Visitante avulso com código único, refeições múltiplas e pagamento integral', true, 'active')
    ON CONFLICT (tenant_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        requires_wallet = EXCLUDED.requires_wallet;
END;
$$;

-- Executa provisionamento para todos os tenants
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.tenants LOOP
        PERFORM public.provision_default_student_categories(r.id);
    END LOOP;
END $$;

-- 2. Adicionar coluna allow_multi_meal em meal_consumptions e atualizar índice de cota diária
ALTER TABLE public.meal_consumptions 
    ADD COLUMN IF NOT EXISTS allow_multi_meal BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS public.idx_meal_consumptions_active_daily;

CREATE UNIQUE INDEX idx_meal_consumptions_active_daily 
    ON public.meal_consumptions(student_id, consumption_date, meal_type_id) 
    WHERE (status IN ('approved', 'financially_refunded') AND NOT allow_multi_meal);

-- 3. Atualizar consume_meal RPC
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
    v_existing_blocked RECORD;
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
BEGIN
    -- -------------------------------------------------------------------------
    -- 1. Autenticação e Permissão Operacional
    -- -------------------------------------------------------------------------
    SELECT p.id, p.tenant_id, p.role INTO v_caller
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF v_caller.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'message', 'Autenticação necessária.');
    END IF;

    IF v_caller.role NOT IN ('admin_general', 'operations_director', 'unit_manager', 'supervisor', 'operator') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Perfil sem permissão operacional.');
    END IF;

    -- -------------------------------------------------------------------------
    -- 2. Validação da Unidade Operacional e Escopo
    -- -------------------------------------------------------------------------
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

    -- -------------------------------------------------------------------------
    -- 3. Idempotência Preventiva
    -- -------------------------------------------------------------------------
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
                    'is_integral', (v_category.code = 'integral'),
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

    -- -------------------------------------------------------------------------
    -- 4. Resolução da Identidade do Comensal
    -- -------------------------------------------------------------------------
    IF v_clean_id LIKE 'MAR:T:%' THEN
        v_method := 'qr_dynamic';
        v_token_hash := encode(digest(v_clean_id, 'sha256'), 'hex');

        SELECT t.* INTO v_token
        FROM public.qr_tokens t
        WHERE t.tenant_id = v_unit.tenant_id AND t.token_hash = v_token_hash;

        IF v_token.id IS NULL THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_NOT_FOUND', 'QR Code dinâmico não localizado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_NOT_FOUND', 'message', 'QR Code inválido ou não localizado.');
        END IF;

        IF v_token.status = 'revoked' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_REVOKED', 'QR Code revogado pelo usuário.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_REVOKED', 'message', 'QR Code revogado.');
        END IF;

        IF v_token.status = 'used' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_ALREADY_USED', 'QR Code já consumido.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_ALREADY_USED', 'message', 'QR Code já utilizado anteriormente.');
        END IF;

        IF v_token.expires_at < now() THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_method, 'TOKEN_EXPIRED', 'QR Code dinâmico expirado.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_EXPIRED', 'message', 'QR Code expirado.');
        END IF;

        v_qr_token_id := v_token.id;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_token.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:C:%' THEN
        v_method := 'physical_card';
        v_token_hash := encode(digest(v_clean_id, 'sha256'), 'hex');

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
        VALUES (v_unit.tenant_id, v_unit.id, v_clean_id, v_method, 'STUDENT_NOT_FOUND', 'Identificação não encontrada na instituição vinculada.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'STUDENT_NOT_FOUND', 'message', 'Identificação/matrícula não encontrada nesta instituição.');
    END IF;

    IF v_student.status <> 'active' THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.registration_number, v_method, 'STUDENT_INACTIVE', 'Cadastro com status inativo/bloqueado.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'STUDENT_INACTIVE', 'message', 'Cadastro inativo ou trancado.');
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
    -- 6. Lock 1: Lock de Comensal para Concorrência
    -- -------------------------------------------------------------------------
    v_lock_key := ('x' || substr(md5(v_student.id::text || ':' || v_consumption_date::text || ':' || v_unit_meal.meal_type_id::text), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- -------------------------------------------------------------------------
    -- 7. Verificação de Duplicidade no Dia Operacional
    -- -------------------------------------------------------------------------
    -- Categoria 'visitante' é isenta da trava de cota única (permite múltiplas refeições no turno pagando integral)
    IF v_category.code <> 'visitante' AND EXISTS (
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
            'message', 'Usuário já realizou esta refeição no dia operacional de hoje (' || to_char(v_consumption_date, 'DD/MM/YYYY') || ').'
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

    -- Fallback inteligente para visitante se não houver regra explícita para sua categoria:
    -- Utiliza a regra ativa da refeição nesta unidade com preço integral e subsídio zero
    IF v_meal_rule.id IS NULL AND v_category.code = 'visitante' THEN
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

        IF v_meal_rule.id IS NOT NULL THEN
            v_meal_rule.student_price := v_meal_rule.full_price;
            v_meal_rule.subsidy_amount := 0.00;
        END IF;
    END IF;

    IF v_meal_rule.id IS NULL THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'NO_PRICE_RULE_CONFIGURED', 'Regra de preço não configurada.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'NO_PRICE_RULE_CONFIGURED', 'message', 'Regra de preço não configurada para esta categoria de comensal.');
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

        -- Auto-provisionamento de carteira se ausente para pagantes
        IF v_wallet.id IS NULL THEN
            INSERT INTO public.wallets (tenant_id, student_id, balance, status)
            VALUES (v_unit.tenant_id, v_student.id, 0.00, 'active')
            RETURNING * INTO v_wallet;
        END IF;

        IF v_wallet.status <> 'active' THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'WALLET_INACTIVE', 'Carteira inativa (' || v_wallet.status || ').', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'WALLET_INACTIVE', 'message', 'Carteira financeira está inativa ou bloqueada.');
        END IF;

        IF v_category.code = 'visitante' THEN
            v_student_price := COALESCE(v_meal_rule.student_price, v_full_price);
            v_subsidy_amount := 0.00;
        ELSE
            v_student_price := v_meal_rule.student_price;
            v_subsidy_amount := v_meal_rule.subsidy_amount;
        END IF;

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
        allow_multi_meal,
        status
    ) VALUES (
        v_consumption_id,
        v_unit.tenant_id,
        v_unit.id,
        v_unit.institution_id,
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
        p_idempotency_key,
        encode(digest(v_consumption_id::text, 'sha256'), 'hex'),
        v_qr_token_id,
        (v_category.code = 'visitante'),
        'approved'
    );

    -- -------------------------------------------------------------------------
    -- 12. Retorno com Auditoria e Detalhes
    -- -------------------------------------------------------------------------
    RETURN jsonb_build_object(
        'success', true,
        'consumption_id', v_consumption_id,
        'consumed_at', now(),
        'meal_type', jsonb_build_object(
            'id', v_unit_meal.meal_type_id,
            'name', (SELECT mt.name FROM public.meal_types mt WHERE mt.id = v_unit_meal.meal_type_id)
        ),
        'student', jsonb_build_object(
            'id', v_student.id,
            'full_name', v_student.full_name,
            'registration_number', v_student.registration_number,
            'category_code', v_category.code,
            'is_integral', (v_category.code = 'integral'),
            'photo_path', v_student.photo_path
        ),
        'financial', jsonb_build_object(
            'full_price', v_full_price,
            'student_price', v_student_price,
            'subsidy_amount', v_subsidy_amount,
            'wallet_transaction_id', v_wallet_tx_id,
            'balance_remaining', v_balance_remaining
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;

-- 3. Atualizar reconcile_offline_consumptions RPC (Isentar 'visitante' de conflito duplicado)
CREATE OR REPLACE FUNCTION public.reconcile_offline_consumptions(
    p_batch JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_profile RECORD;
    v_unit RECORD;
    v_unit_meal RECORD;
    v_student RECORD;
    v_wallet RECORD;
    v_existing_event RECORD;
    v_existing_consumption RECORD;
    v_meal_rule RECORD;
    v_results JSONB := '[]'::jsonb;
    v_event JSONB;
    v_event_idx INT := 0;

    -- Variáveis de extração do evento
    v_client_event_id TEXT;
    v_unit_id UUID;
    v_terminal_id TEXT;
    v_operator_id UUID;
    v_student_id UUID;
    v_registration_attempted TEXT;
    v_meal_type_id UUID;
    v_consumption_date DATE;
    v_device_timestamp TIMESTAMPTZ;
    v_sequence_num INT;
    v_idempotency_key TEXT;
    v_prev_hash TEXT;
    v_integrity_hash TEXT;

    -- Cálculos
    v_full_price NUMERIC(10,2);
    v_student_price NUMERIC(10,2);
    v_subsidy_amount NUMERIC(10,2);
    v_wallet_tx_id UUID;
    v_new_consumption_id UUID;
    v_new_event_id UUID;
    v_new_balance NUMERIC(10,2);
    v_calculated_hash TEXT;
BEGIN
    SELECT id, tenant_id, role INTO v_caller_profile
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_caller_profile.id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação necessária para reconciliação offline.';
    END IF;

    IF v_caller_profile.role NOT IN ('operator', 'supervisor', 'unit_manager', 'admin_general', 'operations_director') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil não possui permissão para reconciliar eventos offline.';
    END IF;

    IF p_batch IS NULL OR jsonb_array_length(p_batch) = 0 THEN
        RETURN jsonb_build_object('success', true, 'reconciled_count', 0, 'results', '[]'::jsonb);
    END IF;

    FOR v_event IN SELECT * FROM jsonb_array_elements(p_batch)
    LOOP
        v_event_idx := v_event_idx + 1;
        v_client_event_id := COALESCE(v_event->>'event_id', v_event->>'id', 'EVENT_' || v_event_idx::text);
        v_idempotency_key := v_event->>'idempotency_key';

        IF v_idempotency_key IS NULL OR length(trim(v_idempotency_key)) = 0 THEN
            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'status', 'failed_irrecoverable',
                'error_code', 'MISSING_IDEMPOTENCY_KEY',
                'message', 'Evento offline rejeitado: idempotency_key é obrigatório.'
            );
            CONTINUE;
        END IF;

        BEGIN
            v_unit_id := (v_event->>'unit_id')::UUID;
            v_student_id := (v_event->>'student_id')::UUID;
            v_meal_type_id := (v_event->>'meal_type_id')::UUID;
            v_consumption_date := (v_event->>'consumption_date')::DATE;
            v_device_timestamp := (v_event->>'device_timestamp')::TIMESTAMPTZ;
            v_sequence_num := (v_event->>'sequence_num')::INT;
        EXCEPTION WHEN OTHERS THEN
            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'failed_irrecoverable',
                'error_code', 'INVALID_PAYLOAD_FORMAT',
                'message', 'Falha ao converter campos UUID/DATE/INT do evento: ' || SQLERRM
            );
            CONTINUE;
        END;

        v_terminal_id := COALESCE(v_event->>'terminal_id', 'TERM_UNKNOWN');
        v_registration_attempted := COALESCE(v_event->>'registration_attempted', 'UNKNOWN');
        v_prev_hash := v_event->>'previous_event_hash';
        v_integrity_hash := v_event->>'integrity_hash';

        IF v_event->>'operator_id' IS NOT NULL THEN
            BEGIN
                v_operator_id := (v_event->>'operator_id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                v_operator_id := v_caller_profile.id;
            END;
        ELSE
            v_operator_id := v_caller_profile.id;
        END IF;

        SELECT id, tenant_id, institution_id, status
        INTO v_unit
        FROM public.units
        WHERE id = v_unit_id AND tenant_id = v_caller_profile.tenant_id;

        IF v_unit.id IS NULL THEN
            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'failed_irrecoverable',
                'error_code', 'ACCESS_DENIED_UNIT',
                'message', 'Unidade operacional informada não pertence ao tenant autenticado.'
            );
            CONTINUE;
        END IF;

        SELECT id, status, linked_consumption_id
        INTO v_existing_event
        FROM public.offline_contingency_events
        WHERE idempotency_key = v_idempotency_key AND tenant_id = v_caller_profile.tenant_id;

        IF v_existing_event.id IS NOT NULL THEN
            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', v_existing_event.status,
                'linked_consumption_id', v_existing_event.linked_consumption_id,
                'idempotent_replay', true,
                'message', 'Evento já reconciliado anteriormente com esta idempotency_key.'
            );
            CONTINUE;
        END IF;

        -- Validação de integridade de hash
        IF v_integrity_hash IS NOT NULL AND length(v_integrity_hash) > 0 THEN
            v_calculated_hash := encode(digest(
                v_unit_id::text || ':' ||
                v_terminal_id || ':' ||
                v_sequence_num::text || ':' ||
                v_student_id::text || ':' ||
                v_meal_type_id::text || ':' ||
                to_char(v_device_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' ||
                COALESCE(v_prev_hash, ''),
                'sha256'
            ), 'hex');

            IF v_calculated_hash <> v_integrity_hash THEN
                INSERT INTO public.offline_contingency_events (
                    tenant_id, unit_id, institution_id, terminal_id, operator_id,
                    student_id, registration_attempted, meal_type_id, consumption_date,
                    sequence_num, device_timestamp, idempotency_key, previous_event_hash,
                    integrity_hash, status, conflict_reason, notes
                ) VALUES (
                    v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_terminal_id, v_operator_id,
                    v_student_id, v_registration_attempted, v_meal_type_id, v_consumption_date,
                    v_sequence_num, v_device_timestamp, v_idempotency_key, v_prev_hash,
                    v_integrity_hash, 'flagged_audit_tampered', 'INTEGRITY_HASH_MISMATCH',
                    'Hash de integridade HMAC/SHA256 divergiu da computação canônica do servidor.'
                );

                v_results := v_results || jsonb_build_object(
                    'event_id', v_client_event_id,
                    'idempotency_key', v_idempotency_key,
                    'status', 'flagged_audit_tampered',
                    'error_code', 'INTEGRITY_HASH_MISMATCH',
                    'message', 'Alerta de auditoria: hash de integridade divergiu do cálculo do servidor.'
                );
                CONTINUE;
            END IF;
        END IF;

        -- Validar Comensal e Categoria
        SELECT s.id, s.institution_id, s.status, s.category_id, c.code AS category_code, (NOT c.requires_wallet) AS is_integral
        INTO v_student
        FROM public.students s
        JOIN public.student_categories c ON c.id = s.category_id
        WHERE s.id = v_student_id AND s.tenant_id = v_caller_profile.tenant_id;

        IF v_student.id IS NULL THEN
            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'failed_irrecoverable',
                'error_code', 'STUDENT_NOT_FOUND_OR_TENANT_MISMATCH',
                'message', 'Usuário não encontrado ou não pertence ao tenant autenticado.'
            );
            CONTINUE;
        ELSIF v_student.status <> 'active' THEN
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
                'Refeição entregue offline para cadastro inativo ou suspenso.'
            );

            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'pending_administrative_review',
                'error_code', 'STUDENT_INACTIVE_OR_SUSPENDED',
                'message', 'Cadastro inativo. Fato físico preservado para análise administrativa.'
            );
            CONTINUE;
        END IF;

        -- Preço
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
            -- Se for visitante, busca regra ativa geral da refeição
            IF v_student.category_code = 'visitante' THEN
                SELECT full_price, student_price, subsidy_amount
                INTO v_meal_rule
                FROM public.meal_rules
                WHERE tenant_id = v_caller_profile.tenant_id
                  AND unit_id = v_unit_id
                  AND meal_type_id = v_meal_type_id
                  AND effective_from <= v_device_timestamp
                  AND (effective_to IS NULL OR effective_to > v_device_timestamp)
                ORDER BY effective_from DESC
                LIMIT 1;
            END IF;

            v_full_price := COALESCE(v_meal_rule.full_price, 10.00);
            v_student_price := CASE 
                WHEN v_student.category_code = 'visitante' THEN v_full_price
                WHEN v_student.is_integral THEN 0.00 
                ELSE 3.50 
            END;
            v_subsidy_amount := v_full_price - v_student_price;
        ELSE
            v_full_price := v_meal_rule.full_price;
            v_student_price := CASE 
                WHEN v_student.category_code = 'visitante' THEN COALESCE(v_meal_rule.student_price, v_full_price)
                WHEN v_student.is_integral THEN 0.00 
                ELSE v_meal_rule.student_price 
            END;
            v_subsidy_amount := v_full_price - v_student_price;
        END IF;

        -- Verificação de cota duplicada (ISENTA categoria visitante)
        IF v_student.category_code <> 'visitante' THEN
            SELECT id, consumed_at, terminal_id, status
            INTO v_existing_consumption
            FROM public.meal_consumptions
            WHERE student_id = v_student_id
              AND consumption_date = v_consumption_date
              AND meal_type_id = v_meal_type_id
              AND status IN ('approved', 'financially_refunded')
            LIMIT 1;
        ELSE
            v_existing_consumption.id := NULL;
        END IF;

        IF v_existing_consumption.id IS NOT NULL THEN
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
                'Usuário recebeu refeição em terminal offline, mas já possuía consumo registrado hoje. Sem débito duplicado.'
            );

            v_results := v_results || jsonb_build_object(
                'event_id', v_client_event_id,
                'idempotency_key', v_idempotency_key,
                'status', 'conflict_duplicate',
                'linked_consumption_id', v_existing_consumption.id,
                'financial_debit_applied', false,
                'message', 'Consumo duplicado em contingência detectado. Refeição física entregue sem débito financeiro.'
            );
            CONTINUE;
        END IF;

        -- Processamento Financeiro
        v_new_consumption_id := gen_random_uuid();
        v_wallet_tx_id := NULL;

        IF v_student_price > 0.00 THEN
            SELECT id, balance, status
            INTO v_wallet
            FROM public.wallets
            WHERE student_id = v_student_id AND tenant_id = v_caller_profile.tenant_id
            FOR UPDATE;

            IF v_wallet.id IS NULL THEN
                INSERT INTO public.wallets (tenant_id, student_id, balance, status)
                VALUES (v_caller_profile.tenant_id, v_student_id, 0.00, 'active')
                RETURNING id, balance, status INTO v_wallet;
            END IF;

            v_new_balance := v_wallet.balance - v_student_price;

            UPDATE public.wallets
            SET balance = v_new_balance,
                updated_at = now()
            WHERE id = v_wallet.id;

            INSERT INTO public.wallet_transactions (
                tenant_id, wallet_id, student_id, type, amount,
                balance_before, balance_after, reference_type, reference_id,
                description, created_by
            ) VALUES (
                v_caller_profile.tenant_id, v_wallet.id, v_student_id, 'meal_debit', -v_student_price,
                v_wallet.balance, v_new_balance, 'meal_consumption', v_new_consumption_id,
                'Débito reconciliado de refeição contingência offline (' || v_terminal_id || ')',
                v_caller_profile.id
            ) RETURNING id INTO v_wallet_tx_id;
        END IF;

        -- Inserir Consumo Aprovado
        INSERT INTO public.meal_consumptions (
            id, tenant_id, unit_id, institution_id, student_id, category_id,
            meal_type_id, consumption_date, consumed_at, full_price, student_price,
            subsidy_amount, wallet_transaction_id, operator_id, terminal_id,
            verification_method, idempotency_key, request_hash, allow_multi_meal, status
        ) VALUES (
            v_new_consumption_id, v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id,
            v_student_id, v_student.category_id, v_meal_type_id, v_consumption_date,
            v_device_timestamp, v_full_price, v_student_price, v_subsidy_amount,
            v_wallet_tx_id, v_operator_id, v_terminal_id, 'offline_contingency',
            v_idempotency_key, v_integrity_hash, (v_student.category_code = 'visitante'), 'approved'
        );

        -- Inserir na trilha de auditoria de eventos offline
        INSERT INTO public.offline_contingency_events (
            tenant_id, unit_id, institution_id, terminal_id, operator_id,
            student_id, registration_attempted, meal_type_id, consumption_date,
            sequence_num, device_timestamp, idempotency_key, previous_event_hash,
            integrity_hash, status, linked_consumption_id, financial_debit_applied
        ) VALUES (
            v_caller_profile.tenant_id, v_unit_id, v_unit.institution_id, v_terminal_id, v_operator_id,
            v_student_id, v_registration_attempted, v_meal_type_id, v_consumption_date,
            v_sequence_num, v_device_timestamp, v_idempotency_key, v_prev_hash,
            v_integrity_hash, 'reconciled_clean', v_new_consumption_id,
            (v_student_price > 0.00)
        ) RETURNING id INTO v_new_event_id;

        v_results := v_results || jsonb_build_object(
            'event_id', v_client_event_id,
            'idempotency_key', v_idempotency_key,
            'status', 'reconciled_clean',
            'consumption_id', v_new_consumption_id,
            'offline_event_id', v_new_event_id,
            'financial_debit_applied', (v_student_price > 0.00),
            'message', 'Consumo offline integrado e reconciliado com sucesso.'
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'reconciled_count', jsonb_array_length(v_results),
        'results', v_results
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_offline_consumptions(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_offline_consumptions(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_offline_consumptions(JSONB) TO authenticated;
