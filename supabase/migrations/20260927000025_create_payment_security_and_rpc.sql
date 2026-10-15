-- ==============================================================================
-- Migration: 20260927000025_create_payment_security_and_rpc.sql
-- Descrição: Configuração de RLS forçado, bloqueio total de mutações client-side
--            diretas e RPCs transacionais atômicas (create_payment_order e
--            confirm_payment_recharge) com lock FOR UPDATE e proteção de idempotência.
-- ==============================================================================

-- 1. Habilitar RLS forçado em todas as tabelas de pagamento
ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_providers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.recharges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recharges FORCE ROW LEVEL SECURITY;

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events FORCE ROW LEVEL SECURITY;

-- ==============================================================================
-- POLICIES DE LEITURA (SELECT)
-- ==============================================================================

-- Provedores: Staff pode ler lista de provedores ativos do seu tenant
DROP POLICY IF EXISTS sel_payment_providers_staff ON public.payment_providers;
CREATE POLICY sel_payment_providers_staff ON public.payment_providers
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

-- Pagamentos: Alunos visualizam apenas suas próprias cobranças
DROP POLICY IF EXISTS sel_payments_student ON public.payments;
CREATE POLICY sel_payments_student ON public.payments
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = payments.student_id
          AND s.user_id = auth.uid()
          AND s.tenant_id = payments.tenant_id
    )
);

-- Pagamentos: Staff visualiza cobranças do seu tenant
DROP POLICY IF EXISTS sel_payments_staff ON public.payments;
CREATE POLICY sel_payments_staff ON public.payments
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
);

-- Recargas: Alunos visualizam apenas suas próprias recargas
DROP POLICY IF EXISTS sel_recharges_student ON public.recharges;
CREATE POLICY sel_recharges_student ON public.recharges
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = recharges.student_id
          AND s.user_id = auth.uid()
          AND s.tenant_id = recharges.tenant_id
    )
);

-- Recargas: Staff visualiza recargas do tenant
DROP POLICY IF EXISTS sel_recharges_staff ON public.recharges;
CREATE POLICY sel_recharges_staff ON public.recharges
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
);

-- Webhook Events: Apenas administradores e financeiro visualizam logs de webhook
DROP POLICY IF EXISTS sel_webhook_events_admin ON public.payment_webhook_events;
CREATE POLICY sel_webhook_events_admin ON public.payment_webhook_events
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

-- ==============================================================================
-- RPC 1: Criar Pedido de Recarga (create_payment_order)
-- ==============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT oid::regprocedure AS func_signature FROM pg_proc WHERE proname = 'create_payment_order' AND pronamespace = 'public'::regnamespace LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_payment_order(
    p_requesting_user_id UUID,
    p_student_id UUID,
    p_method TEXT,
    p_amount NUMERIC(12, 2),
    p_provider_code TEXT,
    p_external_payment_id TEXT,
    p_pix_qr_code TEXT DEFAULT NULL,
    p_pix_copy_paste TEXT DEFAULT NULL,
    p_raw_response JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_category_requires_wallet BOOLEAN;
    v_wallet_id UUID;
    v_provider_id UUID;
    v_new_payment_id UUID;
    v_new_recharge_id UUID;
BEGIN
    -- 1. Validar valor da recarga
    IF p_amount <= 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: O valor da recarga deve ser maior que R$ 0.00';
    END IF;

    -- 2. Obter tenant do aluno e validar categoria
    SELECT s.tenant_id, sc.requires_wallet INTO v_tenant_id, v_category_requires_wallet
    FROM public.students s
    JOIN public.student_categories sc ON sc.id = s.category_id AND sc.tenant_id = s.tenant_id
    WHERE s.id = p_student_id;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Aluno não encontrado no sistema';
    END IF;

    -- REGRA CRÍTICA: Bolsistas Integrais NÃO podem realizar recargas
    IF v_category_requires_wallet IS FALSE THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Alunos da categoria Bolsista Integral são isentos e não realizam recargas financeiras.';
    END IF;

    -- 3. Obter ou criar carteira do aluno
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE student_id = p_student_id AND tenant_id = v_tenant_id;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (tenant_id, student_id, balance, status)
        VALUES (v_tenant_id, p_student_id, 0.00, 'active')
        RETURNING id INTO v_wallet_id;
    END IF;

    -- 4. Obter o provedor de pagamento ativo do tenant
    SELECT id INTO v_provider_id
    FROM public.payment_providers
    WHERE tenant_id = v_tenant_id AND code = p_provider_code AND is_active = true
    LIMIT 1;

    -- Caso o tenant ainda não tenha linha específica, provisionar provedor padrão se aplicável
    IF v_provider_id IS NULL THEN
        INSERT INTO public.payment_providers (tenant_id, code, name, is_active)
        VALUES (v_tenant_id, p_provider_code, UPPER(p_provider_code), true)
        ON CONFLICT (tenant_id, code) DO UPDATE SET is_active = true
        RETURNING id INTO v_provider_id;
    END IF;

    -- 5. Inserir registro de cobrança em status 'pending'
    INSERT INTO public.payments (
        tenant_id,
        student_id,
        provider_id,
        external_payment_id,
        method,
        amount,
        status,
        pix_qr_code,
        pix_copy_paste,
        raw_response
    )
    VALUES (
        v_tenant_id,
        p_student_id,
        v_provider_id,
        p_external_payment_id,
        p_method,
        p_amount,
        'pending',
        p_pix_qr_code,
        p_pix_copy_paste,
        p_raw_response
    )
    RETURNING id INTO v_new_payment_id;

    -- 6. Inserir registro de recarga em status 'pending'
    INSERT INTO public.recharges (
        tenant_id,
        student_id,
        wallet_id,
        payment_id,
        amount,
        status,
        source
    )
    VALUES (
        v_tenant_id,
        p_student_id,
        v_wallet_id,
        v_new_payment_id,
        p_amount,
        'pending',
        p_method
    )
    RETURNING id INTO v_new_recharge_id;

    RETURN jsonb_build_object(
        'payment_id', v_new_payment_id,
        'recharge_id', v_new_recharge_id,
        'wallet_id', v_wallet_id,
        'amount', p_amount,
        'status', 'pending'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_payment_order FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payment_order FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_order TO service_role;

-- ==============================================================================
-- RPC 2: Confirmação Atômica de Pagamento e Crédito no Ledger (confirm_payment_recharge)
-- ==============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT oid::regprocedure AS func_signature FROM pg_proc WHERE proname = 'confirm_payment_recharge' AND pronamespace = 'public'::regnamespace LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_payment_recharge(
    p_external_payment_id TEXT,
    p_provider_code TEXT,
    p_event_id TEXT DEFAULT NULL,
    p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment_id UUID;
    v_tenant_id UUID;
    v_student_id UUID;
    v_provider_id UUID;
    v_payment_amount NUMERIC(12, 2);
    v_payment_method TEXT;
    v_payment_status public.payment_status;
    v_wallet_id UUID;
    v_recharge_id UUID;
    v_recharge_status public.recharge_status;
    v_current_balance NUMERIC(12, 2);
    v_new_balance NUMERIC(12, 2);
    v_ledger_tx_id UUID;
    v_event_already_processed BOOLEAN;
BEGIN
    -- 1. Tratamento de Idempotência do Evento de Webhook
    IF p_event_id IS NOT NULL THEN
        SELECT processed INTO v_event_already_processed
        FROM public.payment_webhook_events
        WHERE provider_code = p_provider_code AND event_id = p_event_id;

        IF v_event_already_processed IS TRUE THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_processed', true,
                'message', 'Evento de webhook já processado anteriormente com sucesso.'
            );
        END IF;
    END IF;

    -- 2. Localizar cobrança correspondente no banco
    SELECT p.id, p.tenant_id, p.student_id, p.provider_id, p.amount, p.method, p.status
    INTO v_payment_id, v_tenant_id, v_student_id, v_provider_id, v_payment_amount, v_payment_method, v_payment_status
    FROM public.payments p
    JOIN public.payment_providers pp ON pp.id = p.provider_id
    WHERE p.external_payment_id = p_external_payment_id
      AND pp.code = p_provider_code;

    IF v_payment_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Cobrança externa % do provedor % não encontrada no sistema', p_external_payment_id, p_provider_code;
    END IF;

    -- Se já foi confirmada anteriormente, garantir retorno idempotente
    IF v_payment_status = 'confirmed' THEN
        -- Registrar webhook como processado se aplicável
        IF p_event_id IS NOT NULL THEN
            INSERT INTO public.payment_webhook_events (
                tenant_id, provider_code, event_id, event_type, external_payment_id, payload, processed, processed_at
            )
            VALUES (
                v_tenant_id, p_provider_code, p_event_id, 'PAYMENT_CONFIRMED', p_external_payment_id, p_payload, true, NOW()
            )
            ON CONFLICT (provider_code, event_id) DO UPDATE SET processed = true, processed_at = NOW();
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'already_confirmed', true,
            'payment_id', v_payment_id,
            'message', 'Pagamento já havia sido confirmado e creditado.'
        );
    END IF;

    -- 3. Localizar registro de recarga pendente correspondente
    SELECT id, wallet_id, status
    INTO v_recharge_id, v_wallet_id, v_recharge_status
    FROM public.recharges
    WHERE payment_id = v_payment_id AND tenant_id = v_tenant_id;

    IF v_recharge_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Recarga pendente associada ao pagamento % não encontrada', v_payment_id;
    END IF;

    -- 4. Lock pessimista FOR UPDATE na carteira do aluno para garantir atomicidade contábil
    SELECT balance INTO v_current_balance
    FROM public.wallets
    WHERE id = v_wallet_id AND tenant_id = v_tenant_id AND status = 'active'
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Carteira financeira não encontrada ou inativa para este aluno';
    END IF;

    v_new_balance := ROUND(v_current_balance + v_payment_amount, 2);

    -- 5. Atualizar status da cobrança para 'confirmed'
    UPDATE public.payments
    SET 
        status = 'confirmed',
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = v_payment_id;

    -- 6. Atualizar status da recarga para 'confirmed'
    UPDATE public.recharges
    SET 
        status = 'confirmed',
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = v_recharge_id;

    -- 7. Atualizar saldo da carteira atomicamente
    UPDATE public.wallets
    SET 
        balance = v_new_balance,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    -- 8. Registrar lançamento no Livro Razão Imutável (wallet_transactions)
    INSERT INTO public.wallet_transactions (
        tenant_id,
        wallet_id,
        student_id,
        type, amount, balance_before, balance_after,
        reference_type,
        reference_id,
        description
    )
    VALUES (
        v_tenant_id,
        v_wallet_id,
        v_student_id,
        'recharge',
        v_payment_amount,
        v_current_balance,
        v_new_balance,
        'payment',
        v_payment_id,
        'Recarga automática via ' || UPPER(v_payment_method) || ' (' || UPPER(p_provider_code) || ')'
    )
    RETURNING id INTO v_ledger_tx_id;

    -- 9. Registrar evento na barreira de idempotência de webhooks
    IF p_event_id IS NOT NULL THEN
        INSERT INTO public.payment_webhook_events (
            tenant_id, provider_code, event_id, event_type, external_payment_id, payload, processed, processed_at
        )
        VALUES (
            v_tenant_id, p_provider_code, p_event_id, 'PAYMENT_CONFIRMED', p_external_payment_id, p_payload, true, NOW()
        )
        ON CONFLICT (provider_code, event_id) DO UPDATE SET processed = true, processed_at = NOW();
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'recharge_id', v_recharge_id,
        'wallet_id', v_wallet_id,
        'ledger_transaction_id', v_ledger_tx_id,
        'credited_amount', v_payment_amount,
        'balance_before', v_current_balance,
        'balance_after', v_new_balance
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_payment_recharge FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_recharge FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_recharge TO service_role;
