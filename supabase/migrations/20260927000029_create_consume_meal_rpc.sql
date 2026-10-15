-- ==============================================================================
-- Migration: 20260927000029_create_consume_meal_rpc.sql
-- Descrição: RPC transacional atômica consume_meal com advisory locks ordenados,
--            idempotência com assinatura canônica, suporte a horários noturnos,
--            RLS forçado e função de cancelamento/estorno auditável.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Habilitação e Imposição de RLS (Deny-by-Default com FORCE RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.meal_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_consumptions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.blocked_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_attempts FORCE ROW LEVEL SECURITY;

-- Aluno lê exclusivamente os seus próprios consumos
CREATE POLICY sel_meal_consumptions_student ON public.meal_consumptions
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.id = meal_consumptions.student_id
              AND s.tenant_id = meal_consumptions.tenant_id
              AND s.user_id = auth.uid()
        )
    );

-- Gestores e operadores leem consumos da sua unidade/tenant
CREATE POLICY sel_meal_consumptions_staff ON public.meal_consumptions
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.tenant_id = meal_consumptions.tenant_id
              AND p.status = 'active'
              AND p.role IN ('operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general', 'finance')
        )
        AND public.has_unit_access(meal_consumptions.unit_id)
    );

-- Gestores e operadores leem logs de tentativas bloqueadas da sua unidade/tenant
CREATE POLICY sel_blocked_attempts_staff ON public.blocked_attempts
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.tenant_id = blocked_attempts.tenant_id
              AND p.status = 'active'
              AND p.role IN ('operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general', 'finance')
        )
        AND public.has_unit_access(blocked_attempts.unit_id)
    );

-- NOTA DE SEGURANÇA: Nenhuma policy de INSERT, UPDATE ou DELETE é criada para o papel authenticated.
-- Todas as mutações são controladas exclusivamente via RPCs com SECURITY DEFINER.

-- ------------------------------------------------------------------------------
-- 2. RPC Principal: consume_meal (Motor de Consumo Atômico de Alta Concorrência)
-- ------------------------------------------------------------------------------
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_unit RECORD;
    v_clean_id TEXT;
    v_clean_idempotency TEXT;
    v_request_hash TEXT;
    v_token_hash TEXT;
    v_student RECORD;
    v_category RECORD;
    v_card RECORD;
    v_token RECORD;
    v_unit_meal RECORD;
    v_meal_rule RECORD;
    v_wallet RECORD;
    
    -- Tipagem estrita de horário local sem coerção de fuso
    v_local_timestamp TIMESTAMP WITHOUT TIME ZONE;
    v_local_date DATE;
    v_local_time TIME;
    v_consumption_date DATE;
    v_is_within_schedule BOOLEAN := false;
    
    v_method TEXT;
    v_consumption_id UUID;
    v_wallet_tx_id UUID := NULL;
    v_existing_consumption RECORD;
    v_lock_key BIGINT;
    v_student_price NUMERIC(12, 2);
    v_subsidy_amount NUMERIC(12, 2);
    v_full_price NUMERIC(12, 2);
BEGIN
    -- Configurar timeout de lock curto (2s) para evitar filas suspensas em concorrência extrema
    SET LOCAL lock_timeout = '2000ms';

    -- -------------------------------------------------------------------------
    -- 1. Verificação de Autenticação e Autorização Operacional
    -- -------------------------------------------------------------------------
    IF v_caller_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'message', 'Operador não autenticado.');
    END IF;

    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Perfil inativo ou inexistente.');
    END IF;

    IF v_caller.role NOT IN ('operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Perfil sem autorização para realizar liberações de refeição.');
    END IF;

    IF NOT public.has_unit_access(p_unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED_UNIT', 'message', 'Operador sem permissão operacional nesta unidade.');
    END IF;

    SELECT id, tenant_id, institution_id, timezone, status INTO v_unit
    FROM public.units
    WHERE id = p_unit_id AND tenant_id = v_caller.tenant_id;

    IF v_unit.id IS NULL OR v_unit.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNIT_UNAVAILABLE', 'message', 'Unidade inativa ou de outro tenant.');
    END IF;

    -- Cálculo preciso de data e horário local no fuso horário configurado da unidade (TIMESTAMP WITHOUT TIME ZONE)
    v_local_timestamp := (now() AT TIME ZONE v_unit.timezone);
    v_local_date := v_local_timestamp::date;
    v_local_time := v_local_timestamp::time;

    -- -------------------------------------------------------------------------
    -- 2. Limpeza de Identificador e Assinatura Canônica da Requisição
    -- -------------------------------------------------------------------------
    v_clean_id := trim(p_identifier);
    IF v_clean_id IS NULL OR v_clean_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_IDENTIFIER', 'message', 'Identificador não informado.');
    END IF;

    v_clean_idempotency := NULLIF(trim(p_idempotency_key), '');
    -- Assinatura canônica dos parâmetros da requisição
    v_request_hash := encode(digest(v_clean_id || ':' || p_unit_id::text || ':' || COALESCE(p_meal_type_id::text, 'auto'), 'sha256'), 'hex');

    -- -------------------------------------------------------------------------
    -- 3. Barreira de Idempotência com Validação de Assinatura
    -- -------------------------------------------------------------------------
    IF v_clean_idempotency IS NOT NULL THEN
        SELECT * INTO v_existing_consumption
        FROM public.meal_consumptions
        WHERE tenant_id = v_unit.tenant_id AND idempotency_key = v_clean_idempotency;

        IF v_existing_consumption.id IS NOT NULL THEN
            -- Se a chave foi reenviada com parâmetros diferentes, bloqueia reutilização espúria
            IF v_existing_consumption.request_hash IS NOT NULL AND v_existing_consumption.request_hash <> v_request_hash THEN
                INSERT INTO public.blocked_attempts (tenant_id, unit_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
                VALUES (v_unit.tenant_id, v_unit.id, v_clean_id, 'idempotency_check', 'IDEMPOTENCY_KEY_REUSE_MISMATCH', 'Chave de idempotência reutilizada com parâmetros divergentes.', p_terminal_id, v_caller.id);
                RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_KEY_REUSE_MISMATCH', 'Chave de idempotência já utilizada para outra operação.');
            END IF;

            -- Retorno seguro e idempotente do consumo original
            RETURN jsonb_build_object(
                'success', true,
                'already_processed', true,
                'status', v_existing_consumption.status,
                'consumption_id', v_existing_consumption.id,
                'consumed_at', v_existing_consumption.consumed_at,
                'consumption_date', v_existing_consumption.consumption_date,
                'student_id', v_existing_consumption.student_id,
                'student_price', v_existing_consumption.student_price,
                'message', 'Consumo já registrado anteriormente para esta requisição.'
            );
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- 4. Resolução da Identidade (Apenas leitura/localização, sem lock de token ainda)
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
        VALUES (v_unit.tenant_id, v_unit.id, 'unknown', 'INVALID_IDENTIFIER_FORMAT', 'Envelope MAR malformado.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_IDENTIFIER_FORMAT', 'message', 'Envelope MAR desconhecido ou malformado.');

    ELSE
        v_method := 'registration_number';
        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id AND s.registration_number = v_clean_id;
    END IF;

    -- Validar aluno ativo no restaurante
    IF v_student.id IS NULL THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_clean_id, v_method, 'STUDENT_NOT_FOUND', 'Aluno não encontrado para a instituição deste restaurante.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'STUDENT_NOT_FOUND', 'message', 'Aluno não cadastrado na instituição correspondente a este restaurante.');
    END IF;

    IF v_student.status <> 'active' THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_student.registration_number, v_method, 'STUDENT_INACTIVE', 'Estudante com status ' || v_student.status, p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'STUDENT_INACTIVE', 'message', 'Cadastro do aluno está inativo ou suspenso (' || v_student.status || ').');
    END IF;

    SELECT * INTO v_category
    FROM public.student_categories
    WHERE id = v_student.category_id AND tenant_id = v_unit.tenant_id;

    -- -------------------------------------------------------------------------
    -- 5. Detecção do Turno de Refeição e Cálculo de Horário / Meia-Noite
    -- -------------------------------------------------------------------------
    IF p_meal_type_id IS NOT NULL THEN
        SELECT * INTO v_unit_meal
        FROM public.unit_meal_types
        WHERE unit_id = v_unit.id AND meal_type_id = p_meal_type_id AND tenant_id = v_unit.tenant_id;
    ELSE
        SELECT * INTO v_unit_meal
        FROM public.unit_meal_types
        WHERE unit_id = v_unit.id 
          AND enabled = true 
          AND tenant_id = v_unit.tenant_id
          AND (
            (start_time <= end_time AND v_local_time >= start_time AND v_local_time <= end_time)
            OR
            (start_time > end_time AND (v_local_time >= start_time OR v_local_time <= end_time))
          )
        ORDER BY start_time ASC
        LIMIT 1;
    END IF;

    IF v_unit_meal.id IS NULL OR NOT v_unit_meal.enabled THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, p_meal_type_id, v_student.registration_number, v_method, 'MEAL_NOT_ENABLED_FOR_UNIT', 'Refeição não habilitada para esta unidade.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'MEAL_NOT_ENABLED_FOR_UNIT', 'message', 'Este tipo de refeição não está habilitado neste restaurante.');
    END IF;

    -- Determinar se está no horário e calcular a data operacional correta
    IF v_unit_meal.start_time IS NOT NULL AND v_unit_meal.end_time IS NOT NULL THEN
        IF v_unit_meal.start_time <= v_unit_meal.end_time THEN
            v_is_within_schedule := (v_local_time >= v_unit_meal.start_time AND v_local_time <= v_unit_meal.end_time);
            v_consumption_date := v_local_date;
        ELSE
            -- Turno noturno atravessando a meia-noite (ex: 22h às 02h)
            v_is_within_schedule := (v_local_time >= v_unit_meal.start_time OR v_local_time <= v_unit_meal.end_time);
            IF v_local_time <= v_unit_meal.end_time THEN
                -- Horário após meia-noite: data operacional é o dia em que o turno abriu
                v_consumption_date := v_local_date - 1;
            ELSE
                v_consumption_date := v_local_date;
            END IF;
        END IF;

        IF NOT v_is_within_schedule THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'OUT_OF_SCHEDULE', 'Fora do horário de funcionamento.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object(
                'success', false, 
                'error_code', 'OUT_OF_SCHEDULE', 
                'message', 'Restaurante fora do horário desta refeição (Horário permitido: ' || to_char(v_unit_meal.start_time, 'HH24:MI') || ' às ' || to_char(v_unit_meal.end_time, 'HH24:MI') || ').'
            );
        END IF;
    ELSE
        v_consumption_date := v_local_date;
    END IF;

    -- -------------------------------------------------------------------------
    -- 6. ORDEM RIGOROSA DE AQUISIÇÃO DE LOCKS (Prevenção de Deadlock)
    -- -------------------------------------------------------------------------
    -- Lock 1: Lock consultivo determinístico por Matrícula / Data Operacional / Tipo de Refeição
    -- Serializa de forma imediata e limpa requisições simultâneas para o mesmo aluno sem travar tabelas
    v_lock_key := ('x' || substr(md5(v_student.id::text || ':' || v_consumption_date::text || ':' || v_unit_meal.meal_type_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- -------------------------------------------------------------------------
    -- 7. Trava Inviolável de Cota Diária (1 Refeição por Turno / Dia)
    -- -------------------------------------------------------------------------
    -- status 'approved' ou 'financially_refunded' ocupam cota (refeição foi fornecida)
    IF EXISTS (
        SELECT 1 FROM public.meal_consumptions
        WHERE student_id = v_student.id
          AND consumption_date = v_consumption_date
          AND meal_type_id = v_unit_meal.meal_type_id
          AND status IN ('approved', 'financially_refunded')
    ) THEN
        INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
        VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'ALREADY_CONSUMED_TODAY', 'Aluno já recebeu esta refeição no dia.', p_terminal_id, v_caller.id);
        RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_CONSUMED_TODAY', 'message', 'Aluno já realizou esta refeição hoje.');
    END IF;

    -- -------------------------------------------------------------------------
    -- 8. Obtenção da Regra Financeira Vigente
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

    -- -------------------------------------------------------------------------
    -- 9. Pré-geração do UUID de Consumo (Garantia do Ledger Imutável)
    -- -------------------------------------------------------------------------
    v_consumption_id := gen_random_uuid();

    -- -------------------------------------------------------------------------
    -- 10. Processamento Financeiro e Lock 2 (Carteira)
    -- -------------------------------------------------------------------------
    IF v_category.code = 'integral' THEN
        -- Aluno Bolsista Integral: Refeição autorizada sem débito em carteira
        v_student_price := 0.00;
        v_subsidy_amount := v_full_price;
        v_wallet_tx_id := NULL;

    ELSE
        -- Aluno Parcial: Obter carteira com lock pessimista FOR UPDATE
        SELECT * INTO v_wallet
        FROM public.wallets
        WHERE student_id = v_student.id AND tenant_id = v_unit.tenant_id
        FOR UPDATE;

        IF v_wallet.id IS NULL THEN
            INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, registration_attempted, verification_method, reason_code, reason_message, terminal_id, operator_id)
            VALUES (v_unit.tenant_id, v_unit.id, v_student.id, v_student.category_id, v_unit_meal.meal_type_id, v_student.registration_number, v_method, 'WALLET_NOT_FOUND', 'Carteira não localizada para aluno parcial.', p_terminal_id, v_caller.id);
            RETURN jsonb_build_object('success', false, 'error_code', 'WALLET_NOT_FOUND', 'message', 'Carteira financeira do aluno não localizada.');
        END IF;

        -- Regra Obrigatória: Mesmo com refeição promocional a R$ 0,00, a carteira precisa estar ativa
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

            -- Débito atômico na carteira
            UPDATE public.wallets
            SET balance = balance - v_student_price,
                updated_at = now()
            WHERE id = v_wallet.id;

            -- Inserção ÚNICA no Ledger com a referência definitiva pré-gerada (Zero UPDATE posterior)
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
                v_wallet.balance - v_student_price,
                'meal_consumption',
                v_consumption_id,
                'Débito de refeição no restaurante: ' || v_clean_id,
                v_caller.id
            ) RETURNING id INTO v_wallet_tx_id;
        ELSE
            -- Aluno parcial com refeição promocional a R$ 0,00: sem débito monetário
            v_wallet_tx_id := NULL;
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- 11. Lock 3 e Queima Atômica do QR Token Dinâmico (Se aplicável)
    -- -------------------------------------------------------------------------
    IF v_method = 'qr_dynamic' THEN
        -- Lock pessimista e atualização atômica de status
        UPDATE public.qr_tokens
        SET status = 'used',
            used_at = now()
        WHERE id = v_token.id AND status = 'active';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CONCURRENT_CONSUMPTION_CONFLICT: Concorrência detectada, o token foi utilizado simultaneamente.';
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- 12. Inserção Definitiva do Consumo
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
        CASE WHEN v_method = 'qr_dynamic' THEN v_token.id ELSE NULL END,
        'approved'
    );

    -- -------------------------------------------------------------------------
    -- 13. Resposta Estruturada para o Terminal
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
            'balance_remaining', CASE 
                WHEN v_wallet_tx_id IS NOT NULL THEN (v_wallet.balance - v_student_price)
                ELSE NULL 
            END
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. RPC Administrativa: cancel_meal_consumption (Estorno Auditável com Regra de Cota)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_meal_consumption(
    p_consumption_id UUID,
    p_cancel_type TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_consumption RECORD;
    v_wallet RECORD;
    v_refund_tx_id UUID := NULL;
BEGIN
    IF v_caller_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'message', 'Usuário não autenticado.');
    END IF;

    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Perfil inativo ou inexistente.');
    END IF;

    IF v_caller.role NOT IN ('unit_manager', 'supervisor', 'operations_director', 'admin_general') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Perfil sem permissão para cancelar ou estornar consumos.');
    END IF;

    IF p_cancel_type NOT IN ('financially_refunded', 'cancelled_unserved') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_CANCEL_TYPE', 'message', 'Tipo de cancelamento deve ser financially_refunded ou cancelled_unserved.');
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'REASON_REQUIRED', 'message', 'Justificativa auditável obrigatória (mínimo de 5 caracteres).');
    END IF;

    SELECT * INTO v_consumption
    FROM public.meal_consumptions
    WHERE id = p_consumption_id AND tenant_id = v_caller.tenant_id
    FOR UPDATE;

    IF v_consumption.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CONSUMPTION_NOT_FOUND', 'message', 'Registro de consumo não localizado no tenant.');
    END IF;

    IF v_consumption.status <> 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_CANCELLED', 'message', 'Consumo já foi previamente estornado ou cancelado (' || v_consumption.status || ').');
    END IF;

    -- Se houve cobrança ao aluno, executar lançamento compensatório no livro-razão (reversal)
    IF v_consumption.student_price > 0.00 THEN
        SELECT * INTO v_wallet
        FROM public.wallets
        WHERE student_id = v_consumption.student_id AND tenant_id = v_caller.tenant_id
        FOR UPDATE;

        UPDATE public.wallets
        SET balance = balance + v_consumption.student_price,
            updated_at = now()
        WHERE id = v_wallet.id;

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
            v_caller.tenant_id,
            v_wallet.id,
            v_consumption.student_id,
            'refund',
            v_consumption.student_price,
            v_wallet.balance,
            v_wallet.balance + v_consumption.student_price,
            'meal_consumption_reversal',
            v_consumption.id,
            'Estorno de consumo (' || p_cancel_type || '): ' || trim(p_reason),
            v_caller.id
        ) RETURNING id INTO v_refund_tx_id;
    END IF;

    -- Atualizar status do consumo preservando auditoria
    UPDATE public.meal_consumptions
    SET status = p_cancel_type,
        reversal_reason = trim(p_reason),
        reversed_at = now(),
        reversed_by = v_caller.id,
        updated_at = now()
    WHERE id = v_consumption.id;

    RETURN jsonb_build_object(
        'success', true,
        'consumption_id', v_consumption.id,
        'new_status', p_cancel_type,
        'quota_released', (p_cancel_type = 'cancelled_unserved'),
        'refund_transaction_id', v_refund_tx_id,
        'message', CASE 
            WHEN p_cancel_type = 'cancelled_unserved' THEN 'Consumo cancelado por não fornecimento. Cota diária liberada e valor estornado.'
            ELSE 'Estorno financeiro realizado com sucesso. A cota diária permanece consumida.'
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_meal_consumption(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_meal_consumption(UUID, TEXT, TEXT) TO authenticated;
