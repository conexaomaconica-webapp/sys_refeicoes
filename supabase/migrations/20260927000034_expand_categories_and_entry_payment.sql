-- ==============================================================================
-- Migration: 20260927000034_expand_categories_and_entry_payment.sql
-- Descrição: 1. Expansão da tabela student_categories com regras de precificação (% ou fixo),
--               tipos de refeições autorizadas, modalidade de pagamento (carteira ou na entrada)
--               e permissão de recarga.
--            2. RPCs administrativas para gestão de categorias (save, list, delete).
--            3. Atualização de consume_meal para respeitar as novas regras de categoria e pagamento na entrada.
--            4. RPC register_visitor_entry para liberação rápida de visitante avulso no caixa/recepção.
-- ==============================================================================

-- 1. Expansão das colunas em public.student_categories
ALTER TABLE public.student_categories
    ADD COLUMN IF NOT EXISTS pricing_type TEXT NOT NULL DEFAULT 'percentage' CHECK (pricing_type IN ('percentage', 'fixed')),
    ADD COLUMN IF NOT EXISTS charge_percentage NUMERIC(5,2) NOT NULL DEFAULT 100.00 CHECK (charge_percentage >= 0 AND charge_percentage <= 100),
    ADD COLUMN IF NOT EXISTS fixed_price NUMERIC(10,2) CHECK (fixed_price >= 0),
    ADD COLUMN IF NOT EXISTS allow_multi_meal BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'wallet' CHECK (payment_mode IN ('wallet', 'on_entry')),
    ADD COLUMN IF NOT EXISTS allowed_meal_types UUID[] DEFAULT NULL;

-- 2. Atualizar função de provisionamento com os novos atributos
CREATE OR REPLACE FUNCTION public.provision_default_student_categories(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
    INSERT INTO public.student_categories (
        tenant_id, code, name, description, requires_wallet,
        pricing_type, charge_percentage, fixed_price, allow_multi_meal, payment_mode, status
    )
    VALUES 
        (p_tenant_id, 'integral', 'Bolsista Integral', 'Isento de pagamento de refeições', false, 'percentage', 0.00, NULL, false, 'wallet', 'active'),
        (p_tenant_id, 'partial', 'Bolsista Parcial / Pagante', 'Exige recarga na carteira para consumo', true, 'fixed', 100.00, 3.50, false, 'wallet', 'active'),
        (p_tenant_id, 'servidor', 'Servidor / Colaborador', 'Servidores, docentes e funcionários da instituição', true, 'percentage', 100.00, NULL, false, 'wallet', 'active'),
        (p_tenant_id, 'visitante', 'Visitante', 'Visitante avulso com código único, refeições múltiplas e pagamento integral na entrada', false, 'percentage', 100.00, NULL, true, 'on_entry', 'active')
    ON CONFLICT (tenant_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        requires_wallet = EXCLUDED.requires_wallet,
        pricing_type = EXCLUDED.pricing_type,
        charge_percentage = EXCLUDED.charge_percentage,
        fixed_price = EXCLUDED.fixed_price,
        allow_multi_meal = EXCLUDED.allow_multi_meal,
        payment_mode = EXCLUDED.payment_mode;
END;
$$;

-- Executa o provisionamento para todos os tenants
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.tenants LOOP
        PERFORM public.provision_default_student_categories(r.id);
    END LOOP;
END $$;

-- 3. Políticas RLS para Gestão de Categorias por Administradores
DROP POLICY IF EXISTS mut_student_categories_admin ON public.student_categories;
CREATE POLICY mut_student_categories_admin ON public.student_categories
FOR ALL TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'unit_manager', 'supervisor')
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'unit_manager', 'supervisor')
);

-- 4. RPC Administrativa: Salvar / Atualizar Categoria
CREATE OR REPLACE FUNCTION public.admin_save_category(
    p_category JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller RECORD;
    v_category_id UUID;
    v_code TEXT;
    v_name TEXT;
    v_description TEXT;
    v_pricing_type TEXT;
    v_charge_percentage NUMERIC(5,2);
    v_fixed_price NUMERIC(10,2);
    v_requires_wallet BOOLEAN;
    v_allow_multi_meal BOOLEAN;
    v_payment_mode TEXT;
    v_status TEXT;
    v_allowed_meal_types UUID[];
    v_raw_meal_types JSONB;
    v_res RECORD;
BEGIN
    SELECT p.id, p.tenant_id, p.role INTO v_caller
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF v_caller.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'message', 'Autenticação necessária.');
    END IF;

    IF v_caller.role NOT IN ('admin_general', 'operations_director', 'unit_manager', 'supervisor') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Apenas administradores podem gerenciar categorias.');
    END IF;

    v_code := lower(trim(p_category->>'code'));
    v_name := trim(p_category->>'name');
    v_description := p_category->>'description';
    v_pricing_type := COALESCE(p_category->>'pricing_type', 'percentage');
    v_charge_percentage := COALESCE((p_category->>'charge_percentage')::NUMERIC, 100.00);
    v_fixed_price := (p_category->>'fixed_price')::NUMERIC;
    v_requires_wallet := COALESCE((p_category->>'requires_wallet')::BOOLEAN, true);
    v_allow_multi_meal := COALESCE((p_category->>'allow_multi_meal')::BOOLEAN, false);
    v_payment_mode := COALESCE(p_category->>'payment_mode', 'wallet');
    v_status := COALESCE(p_category->>'status', 'active');

    IF v_code IS NULL OR length(v_code) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_CODE', 'message', 'Código da categoria é obrigatório.');
    END IF;

    IF v_name IS NULL OR length(v_name) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_NAME', 'message', 'Nome da categoria é obrigatório.');
    END IF;

    -- Extração de allowed_meal_types
    v_raw_meal_types := p_category->'allowed_meal_types';
    IF v_raw_meal_types IS NOT NULL AND jsonb_typeof(v_raw_meal_types) = 'array' AND jsonb_array_length(v_raw_meal_types) > 0 THEN
        SELECT array_agg(value::text::UUID) INTO v_allowed_meal_types
        FROM jsonb_array_elements_text(v_raw_meal_types);
    ELSE
        v_allowed_meal_types := NULL;
    END IF;

    IF p_category->>'id' IS NOT NULL AND length(trim(p_category->>'id')) > 0 THEN
        v_category_id := (p_category->>'id')::UUID;

        UPDATE public.student_categories
        SET name = v_name,
            description = v_description,
            pricing_type = v_pricing_type,
            charge_percentage = v_charge_percentage,
            fixed_price = v_fixed_price,
            requires_wallet = v_requires_wallet,
            allow_multi_meal = v_allow_multi_meal,
            payment_mode = v_payment_mode,
            allowed_meal_types = v_allowed_meal_types,
            status = v_status,
            updated_at = now()
        WHERE id = v_category_id AND tenant_id = v_caller.tenant_id
        RETURNING * INTO v_res;

        IF v_res.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'CATEGORY_NOT_FOUND', 'message', 'Categoria não encontrada para este tenant.');
        END IF;
    ELSE
        INSERT INTO public.student_categories (
            tenant_id, code, name, description,
            pricing_type, charge_percentage, fixed_price,
            requires_wallet, allow_multi_meal, payment_mode,
            allowed_meal_types, status
        )
        VALUES (
            v_caller.tenant_id, v_code, v_name, v_description,
            v_pricing_type, v_charge_percentage, v_fixed_price,
            v_requires_wallet, v_allow_multi_meal, v_payment_mode,
            v_allowed_meal_types, v_status
        )
        ON CONFLICT (tenant_id, code) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            pricing_type = EXCLUDED.pricing_type,
            charge_percentage = EXCLUDED.charge_percentage,
            fixed_price = EXCLUDED.fixed_price,
            requires_wallet = EXCLUDED.requires_wallet,
            allow_multi_meal = EXCLUDED.allow_multi_meal,
            payment_mode = EXCLUDED.payment_mode,
            allowed_meal_types = EXCLUDED.allowed_meal_types,
            status = EXCLUDED.status,
            updated_at = now()
        RETURNING * INTO v_res;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'category', jsonb_build_object(
            'id', v_res.id,
            'code', v_res.code,
            'name', v_res.name,
            'description', v_res.description,
            'pricing_type', v_res.pricing_type,
            'charge_percentage', v_res.charge_percentage,
            'fixed_price', v_res.fixed_price,
            'requires_wallet', v_res.requires_wallet,
            'allow_multi_meal', v_res.allow_multi_meal,
            'payment_mode', v_res.payment_mode,
            'allowed_meal_types', v_res.allowed_meal_types,
            'status', v_res.status
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_category(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_category(JSONB) TO authenticated;

-- 5. RPC Administrativa: Listar Categorias com Contagem de Comensais
CREATE OR REPLACE FUNCTION public.admin_list_categories()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller RECORD;
    v_result JSONB;
BEGIN
    SELECT p.id, p.tenant_id, p.role INTO v_caller
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF v_caller.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'message', 'Autenticação necessária.');
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sc.id,
            'code', sc.code,
            'name', sc.name,
            'description', sc.description,
            'pricing_type', sc.pricing_type,
            'charge_percentage', sc.charge_percentage,
            'fixed_price', sc.fixed_price,
            'requires_wallet', sc.requires_wallet,
            'allow_multi_meal', sc.allow_multi_meal,
            'payment_mode', sc.payment_mode,
            'allowed_meal_types', sc.allowed_meal_types,
            'status', sc.status,
            'total_students', (
                SELECT COUNT(*)::int FROM public.students s
                WHERE s.category_id = sc.id AND s.tenant_id = sc.tenant_id AND s.status = 'active'
            )
        ) ORDER BY sc.name ASC
    ), '[]'::jsonb) INTO v_result
    FROM public.student_categories sc
    WHERE sc.tenant_id = v_caller.tenant_id;

    RETURN jsonb_build_object(
        'success', true,
        'categories', v_result
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_categories() TO authenticated;

-- 6. Atualização da RPC consume_meal para suporte pleno a categorias dinâmicas e pagamento na entrada
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

    SELECT * INTO v_category
    FROM public.student_categories
    WHERE id = v_student.category_id AND tenant_id = v_unit.tenant_id;

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
        RETURN jsonb_build_object('success', false, 'error_code', 'MEAL_NOT_ENABLED_FOR_UNIT', 'message', 'Refeição não configurada ou inativa para esta unidade.');
    END IF;

    -- Validação: Categoria tem permissão para este tipo de refeição?
    IF v_category.allowed_meal_types IS NOT NULL AND array_length(v_category.allowed_meal_types, 1) > 0 THEN
        IF NOT (v_unit_meal.meal_type_id = ANY(v_category.allowed_meal_types)) THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'MEAL_NOT_ALLOWED_FOR_CATEGORY', 'Tipo de refeição não autorizado para a categoria.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'MEAL_NOT_ALLOWED_FOR_CATEGORY', 'message', 'Esta refeição não é permitida para a categoria do comensal (' || v_category.name || ').');
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

    -- 6. Lock 1: Lock de Comensal para Concorrência
    v_lock_key := ('x' || substr(md5(v_student.id::text || ':' || v_consumption_date::text || ':' || v_unit_meal.meal_type_id::text), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- 7. Verificação de Duplicidade no Dia Operacional
    -- Isenta categorias com allow_multi_meal = true (ex: visitante)
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
            'message', 'Usuário já realizou esta refeição no dia operacional de hoje (' || to_char(v_consumption_date, 'DD/MM/YYYY') || ').'
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
        -- Fallback seguro para valor integral padrão se não houver regra explícita
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
        -- Visitante / Pagamento na entrada: pago diretamente no caixa/balcão
        v_wallet_tx_id := NULL;
        v_balance_remaining := NULL;
    ELSIF v_student_price = 0.00 THEN
        -- Beneficiário 100% isento
        v_wallet_tx_id := NULL;
        v_balance_remaining := NULL;
    ELSE
        -- Comensal pagante com carteira digital
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
            RETURN jsonb_build_object('success', false, 'error_code', 'WALLET_INACTIVE', 'message', 'Carteira financeira está inativa ou bloqueada.');
        END IF;

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
    END IF;

    -- 11. Lock 3 e Queima Atômica do QR Token Dinâmico (Se aplicável)
    IF v_method = 'qr_dynamic' THEN
        UPDATE public.qr_tokens
        SET status = 'used',
            used_at = now()
        WHERE id = v_token.id;
    END IF;

    -- 12. Registro do Consumo Aprovado
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
        v_category.allow_multi_meal,
        'approved'
    );

    -- 13. Retorno com Detalhes da Liberação
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
            'is_integral', (v_category.code = 'integral' OR v_student_price = 0.00),
            'payment_mode', v_category.payment_mode,
            'photo_path', v_student.photo_path
        ),
        'financial', jsonb_build_object(
            'full_price', v_full_price,
            'student_price', v_student_price,
            'subsidy_amount', v_subsidy_amount,
            'wallet_transaction_id', v_wallet_tx_id,
            'balance_remaining', v_balance_remaining,
            'paid_on_entry', (v_category.payment_mode = 'on_entry' OR v_category.code = 'visitante')
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;

-- 7. RPC de Liberação Direta de Visitante Avulso no Caixa (1 Clique)
CREATE OR REPLACE FUNCTION public.register_visitor_entry(
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
    v_cat_visitante RECORD;
    v_visitor_student RECORD;
    v_reg_number TEXT;
    v_idempotency TEXT;
BEGIN
    SELECT p.id, p.tenant_id, p.role INTO v_caller
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF v_caller.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'message', 'Autenticação necessária.');
    END IF;

    IF v_caller.role NOT IN ('admin_general', 'operations_director', 'unit_manager', 'supervisor', 'operator') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Perfil sem permissão operacional.');
    END IF;

    SELECT u.* INTO v_unit FROM public.units u WHERE u.id = p_unit_id AND u.tenant_id = v_caller.tenant_id;
    IF v_unit.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNIT_NOT_FOUND', 'message', 'Unidade não encontrada.');
    END IF;

    -- Obter ou criar categoria visitante
    SELECT * INTO v_cat_visitante FROM public.student_categories WHERE tenant_id = v_caller.tenant_id AND code = 'visitante';
    IF v_cat_visitante.id IS NULL THEN
        PERFORM public.provision_default_student_categories(v_caller.tenant_id);
        SELECT * INTO v_cat_visitante FROM public.student_categories WHERE tenant_id = v_caller.tenant_id AND code = 'visitante';
    END IF;

    -- Localizar ou criar comensal genérico de visitante para esta unidade
    v_reg_number := 'VISITANTE_' || upper(substr(p_unit_id::text, 1, 8));
    SELECT * INTO v_visitor_student FROM public.students WHERE institution_id = v_unit.institution_id AND registration_number = v_reg_number;

    IF v_visitor_student.id IS NULL THEN
        INSERT INTO public.students (
            tenant_id, institution_id, category_id, registration_number, full_name, status
        ) VALUES (
            v_caller.tenant_id, v_unit.institution_id, v_cat_visitante.id, v_reg_number, 'Visitante Avulso (Entrada)', 'active'
        ) RETURNING * INTO v_visitor_student;
    END IF;

    -- Chamar consume_meal com idempotency único de timestamp
    v_idempotency := 'VISIT_' || p_unit_id::text || '_' || extract(epoch from clock_timestamp())::text;

    RETURN public.consume_meal(
        p_unit_id,
        v_reg_number,
        p_meal_type_id,
        v_idempotency,
        p_terminal_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.register_visitor_entry(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_visitor_entry(UUID, UUID, TEXT) TO authenticated;
