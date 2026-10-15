-- ==============================================================================
-- Migration: 20260927000023_create_wallet_security_and_functions.sql
-- Descrição: Configuração de RLS forçado, bloqueio total de mutações client-side
--            diretas e RPCs transacionais atômicas (create_student_wallet,
--            manual_wallet_adjustment e reverse_wallet_transaction) com lock FOR UPDATE.
-- ==============================================================================

-- 1. Habilitar RLS forçado em todas as tabelas financeiras
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets FORCE ROW LEVEL SECURITY;

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions FORCE ROW LEVEL SECURITY;

-- ==============================================================================
-- POLICIES DE LEITURA (SELECT)
-- ==============================================================================

-- Alunos podem visualizar apenas o seu próprio saldo/carteira
DROP POLICY IF EXISTS sel_wallets_student ON public.wallets;
CREATE POLICY sel_wallets_student ON public.wallets
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = wallets.student_id
          AND s.user_id = auth.uid()
          AND s.tenant_id = wallets.tenant_id
    )
);

-- Staff administrativo e financeiro podem visualizar carteiras do mesmo tenant
DROP POLICY IF EXISTS sel_wallets_staff ON public.wallets;
CREATE POLICY sel_wallets_staff ON public.wallets
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
);

-- Alunos podem visualizar o seu próprio extrato no livro razão
DROP POLICY IF EXISTS sel_wallet_tx_student ON public.wallet_transactions;
CREATE POLICY sel_wallet_tx_student ON public.wallet_transactions
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = wallet_transactions.student_id
          AND s.user_id = auth.uid()
          AND s.tenant_id = wallet_transactions.tenant_id
    )
);

-- Staff administrativo e financeiro podem visualizar o extrato de movimentações do tenant
DROP POLICY IF EXISTS sel_wallet_tx_staff ON public.wallet_transactions;
CREATE POLICY sel_wallet_tx_staff ON public.wallet_transactions
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
);

-- NOTA DE SEGURANÇA: NENHUMA policy de INSERT, UPDATE ou DELETE é criada para o papel 'authenticated' ou 'PUBLIC'.
-- Mutações na carteira e livro razão só podem ser realizadas server-side via RPCs com service_role.

-- ==============================================================================
-- RPC 1: Criar Carteira Financeira para Aluno (Somente se categoria exigir carteira)
-- ==============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT oid::regprocedure AS func_signature FROM pg_proc WHERE proname = 'create_student_wallet' AND pronamespace = 'public'::regnamespace LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_student_wallet(
    p_requesting_user_id UUID,
    p_student_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_requester_role public.user_role;
    v_requester_status TEXT;
    v_category_requires_wallet BOOLEAN;
    v_existing_wallet_id UUID;
    v_new_wallet_id UUID;
BEGIN
    -- 1. Validar solicitante e obter tenant_id, role e status
    SELECT tenant_id, role, status
    INTO v_tenant_id, v_requester_role, v_requester_status
    FROM public.profiles
    WHERE id = p_requesting_user_id;

    IF v_tenant_id IS NULL OR v_requester_status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Solicitante inválido ou inativo no tenant';
    END IF;

    IF v_requester_role NOT IN ('admin_general', 'operations_director', 'finance') THEN
        RAISE EXCEPTION 'FORBIDDEN: Permissão insuficiente para provisionar carteiras';
    END IF;

    -- 2. Buscar categoria do aluno e verificar se exige carteira
    SELECT sc.requires_wallet INTO v_category_requires_wallet
    FROM public.students s
    JOIN public.student_categories sc ON sc.id = s.category_id AND sc.tenant_id = s.tenant_id
    WHERE s.id = p_student_id AND s.tenant_id = v_tenant_id;

    IF v_category_requires_wallet IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Aluno ou categoria de aluno não encontrada no tenant';
    END IF;

    -- REGRA CRÍTICA: Aluno Integral (requires_wallet = false) NÃO possui carteira financeira
    IF v_category_requires_wallet IS FALSE THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Alunos da categoria Bolsista Integral não possuem carteira financeira operacional.';
    END IF;

    -- 3. Verificar se já existe carteira criada
    SELECT id INTO v_existing_wallet_id
    FROM public.wallets
    WHERE student_id = p_student_id AND tenant_id = v_tenant_id;

    IF v_existing_wallet_id IS NOT NULL THEN
        RETURN v_existing_wallet_id;
    END IF;

    -- 4. Criar a nova carteira com saldo inicial R$ 0.00
    INSERT INTO public.wallets (
        tenant_id,
        student_id,
        balance,
        status
    )
    VALUES (
        v_tenant_id,
        p_student_id,
        0.00,
        'active'
    )
    RETURNING id INTO v_new_wallet_id;

    RETURN v_new_wallet_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_student_wallet(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_student_wallet(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_student_wallet(UUID, UUID) TO service_role;

-- ==============================================================================
-- RPC 2: Ajuste Manual de Carteira (Crédito ou Débito com Justificativa e Lock)
-- ==============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT oid::regprocedure AS func_signature FROM pg_proc WHERE proname = 'manual_wallet_adjustment' AND pronamespace = 'public'::regnamespace LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.manual_wallet_adjustment(
    p_requesting_user_id UUID,
    p_student_id UUID,
    p_amount NUMERIC(12, 2),
    p_description TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_requester_role public.user_role;
    v_requester_status TEXT;
    v_wallet_id UUID;
    v_current_balance NUMERIC(12, 2);
    v_new_balance NUMERIC(12, 2);
    v_new_tx_id UUID;
BEGIN
    -- 1. Validação estrita de parâmetro de justificativa
    IF p_description IS NULL OR LENGTH(TRIM(p_description)) < 5 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: O ajuste manual exige uma justificativa/descrição clara de no mínimo 5 caracteres.';
    END IF;

    IF p_amount = 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: O valor do ajuste manual não pode ser igual a R$ 0.00';
    END IF;

    -- 2. Validar perfil e permissões do solicitante
    SELECT tenant_id, role, status
    INTO v_tenant_id, v_requester_role, v_requester_status
    FROM public.profiles
    WHERE id = p_requesting_user_id;

    IF v_tenant_id IS NULL OR v_requester_status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Solicitante inválido ou inativo no tenant';
    END IF;

    IF v_requester_role NOT IN ('admin_general', 'operations_director', 'finance') THEN
        RAISE EXCEPTION 'FORBIDDEN: Permissão insuficiente para realizar ajustes manuais de saldo';
    END IF;

    -- 3. Lock pessimista FOR UPDATE no registro da carteira para garantir atomicidade contábil
    SELECT id, balance INTO v_wallet_id, v_current_balance
    FROM public.wallets
    WHERE student_id = p_student_id AND tenant_id = v_tenant_id AND status = 'active'
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Carteira financeira não encontrada ou inativa para este aluno no tenant';
    END IF;

    v_new_balance := ROUND(v_current_balance + p_amount, 2);

    -- GARANTIA CRÍTICA: Saldo nunca pode ficar negativo
    IF v_new_balance < 0.00 THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Saldo insuficiente para realizar este ajuste de débito (Saldo atual: R$ %, Ajuste: R$ %)', v_current_balance, p_amount;
    END IF;

    -- 4. Atualizar saldo da carteira
    UPDATE public.wallets
    SET 
        balance = v_new_balance,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    -- 5. Registrar no Livro Razão Imutável (wallet_transactions)
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
    )
    VALUES (
        v_tenant_id,
        v_wallet_id,
        p_student_id,
        'manual_adjustment',
        p_amount,
        v_current_balance,
        v_new_balance,
        'manual_adjustment',
        gen_random_uuid(),
        TRIM(p_description),
        p_requesting_user_id
    )
    RETURNING id INTO v_new_tx_id;

    RETURN v_new_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manual_wallet_adjustment(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manual_wallet_adjustment(UUID, UUID, NUMERIC, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.manual_wallet_adjustment(UUID, UUID, NUMERIC, TEXT) TO service_role;

-- ==============================================================================
-- RPC 3: Reversão / Estorno Transacional com Lançamento Compensatório no Ledger
-- ==============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT oid::regprocedure AS func_signature FROM pg_proc WHERE proname = 'reverse_wallet_transaction' AND pronamespace = 'public'::regnamespace LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.reverse_wallet_transaction(
    p_requesting_user_id UUID,
    p_transaction_id UUID,
    p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_requester_role public.user_role;
    v_requester_status TEXT;
    v_target_wallet_id UUID;
    v_target_student_id UUID;
    v_target_amount NUMERIC(12, 2);
    v_already_reversed BOOLEAN;
    v_current_balance NUMERIC(12, 2);
    v_compensating_amount NUMERIC(12, 2);
    v_new_balance NUMERIC(12, 2);
    v_reversal_tx_id UUID;
BEGIN
    -- 1. Validar justificativa de estorno
    IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 5 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: O estorno exige um motivo/justificativa de no mínimo 5 caracteres.';
    END IF;

    -- 2. Validar solicitante
    SELECT tenant_id, role, status
    INTO v_tenant_id, v_requester_role, v_requester_status
    FROM public.profiles
    WHERE id = p_requesting_user_id;

    IF v_tenant_id IS NULL OR v_requester_status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Solicitante inválido ou inativo no tenant';
    END IF;

    IF v_requester_role NOT IN ('admin_general', 'operations_director', 'finance') THEN
        RAISE EXCEPTION 'FORBIDDEN: Permissão insuficiente para realizar estorno de transações';
    END IF;

    -- 3. Lock transacional na transação original e na carteira correspondente
    SELECT wallet_id, student_id, amount
    INTO v_target_wallet_id, v_target_student_id, v_target_amount
    FROM public.wallet_transactions
    WHERE id = p_transaction_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF v_target_wallet_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Transação financeira não encontrada no tenant';
    END IF;

    -- Verificar se esta transação já foi estornada anteriormente
    SELECT EXISTS (
        SELECT 1 FROM public.wallet_transactions
        WHERE reference_type = 'wallet_transaction_reversal'
          AND reference_id = p_transaction_id
          AND tenant_id = v_tenant_id
    ) INTO v_already_reversed;

    IF v_already_reversed THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Esta transação já possui um lançamento compensatório de estorno registrado.';
    END IF;

    -- Lock na carteira para atualização do saldo
    SELECT balance INTO v_current_balance
    FROM public.wallets
    WHERE id = v_target_wallet_id AND tenant_id = v_tenant_id AND status = 'active'
    FOR UPDATE;

    -- O valor compensatório é o inverso exato da transação original
    v_compensating_amount := -v_target_amount;
    v_new_balance := ROUND(v_current_balance + v_compensating_amount, 2);

    IF v_new_balance < 0.00 THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Não é possível estornar esta transação pois o saldo resultante ficaria negativo (Saldo atual: R$ %, Estorno: R$ %)', v_current_balance, v_compensating_amount;
    END IF;

    -- 4. Atualizar saldo da carteira
    UPDATE public.wallets
    SET 
        balance = v_new_balance,
        updated_at = NOW()
    WHERE id = v_target_wallet_id;

    -- 5. Registrar o lançamento compensatório no Livro Razão Imutável
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
    )
    VALUES (
        v_tenant_id,
        v_target_wallet_id,
        v_target_student_id,
        'reversal',
        v_compensating_amount,
        v_current_balance,
        v_new_balance,
        'wallet_transaction_reversal',
        p_transaction_id,
        'ESTORNO: ' || TRIM(p_reason),
        p_requesting_user_id
    )
    RETURNING id INTO v_reversal_tx_id;

    RETURN v_reversal_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_wallet_transaction(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_wallet_transaction(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_wallet_transaction(UUID, UUID, TEXT) TO service_role;
