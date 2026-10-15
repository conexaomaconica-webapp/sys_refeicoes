-- ==============================================================================
-- Migration: 20260927000021_fix_meal_rules_vigencia_and_rpc.sql
-- Descrição: Migration corretiva da Sprint 5:
--            1. Ajusta EXCLUSION CONSTRAINT ex_meal_rules_no_overlap para abranger
--               todo o histórico (removendo a limitação WHERE enabled=true).
--            2. Atualiza a RPC set_meal_rule para bloquear agendamentos de preços futuros
--               e validar que a nova vigência é posterior à atual.
-- ==============================================================================

-- 1. Remoção da constraint restritiva e recriação abrangendo regras ativas e históricas
ALTER TABLE public.meal_rules DROP CONSTRAINT IF EXISTS ex_meal_rules_no_overlap;

ALTER TABLE public.meal_rules ADD CONSTRAINT ex_meal_rules_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    unit_id WITH =,
    meal_type_id WITH =,
    category_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
);

-- 2. Eliminação dinâmica e absoluta de TODAS as assinaturas anteriores de set_meal_rule em pg_proc
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname = 'set_meal_rule'
          AND pronamespace = 'public'::regnamespace
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;

-- 3. Atualização da RPC set_meal_rule com tratamento explícito de preços futuros e concorrência
CREATE OR REPLACE FUNCTION public.set_meal_rule(
    p_requesting_user_id UUID,
    p_unit_id UUID,
    p_meal_type_id UUID,
    p_category_id UUID,
    p_full_price NUMERIC(12, 2),
    p_student_price NUMERIC(12, 2),
    p_effective_from TIMESTAMPTZ DEFAULT NOW()
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
    v_requires_wallet BOOLEAN;
    v_unit_enabled BOOLEAN;
    v_current_rule_id UUID;
    v_current_effective_from TIMESTAMPTZ;
    v_subsidy_amount NUMERIC(12, 2);
    v_new_rule_id UUID;
    v_now TIMESTAMPTZ := COALESCE(p_effective_from, NOW());
BEGIN
    -- Bloqueio explícito de agendamento de preços futuros nesta versão
    IF v_now > (NOW() + INTERVAL '1 minute') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Agendamento de preços futuros temporariamente bloqueado nesta versão.';
    END IF;

    -- 1. Validar solicitante e obter tenant_id, role e status diretamente da tabela profiles
    SELECT tenant_id, role, status
    INTO v_tenant_id, v_requester_role, v_requester_status
    FROM public.profiles
    WHERE id = p_requesting_user_id;

    IF v_tenant_id IS NULL OR v_requester_status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Solicitante inválido ou inativo no tenant';
    END IF;

    -- Escopo estrito de autorização: operador e gerente de unidade NÃO podem alterar preços
    IF v_requester_role NOT IN ('admin_general', 'operations_director') THEN
        RAISE EXCEPTION 'FORBIDDEN: Permissão insuficiente para alterar tabela de preços (exige admin_general ou operations_director)';
    END IF;

    -- 2. Lock transacional pessimista na combinação (unit_id, meal_type_id) para evitar concorrência simultânea
    SELECT enabled INTO v_unit_enabled
    FROM public.unit_meal_types
    WHERE unit_id = p_unit_id
      AND meal_type_id = p_meal_type_id
      AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF v_unit_enabled IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: A combinação de unidade e tipo de refeição não existe neste tenant';
    END IF;

    IF v_unit_enabled IS FALSE THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Esta refeição está desabilitada na unidade. Habilite-a antes de definir preços.';
    END IF;

    -- 3. Validação de Categoria do Aluno (Resolução Server-Side de isenção)
    SELECT requires_wallet INTO v_requires_wallet
    FROM public.student_categories
    WHERE id = p_category_id
      AND tenant_id = v_tenant_id;

    IF v_requires_wallet IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Categoria de aluno não encontrada neste tenant';
    END IF;

    -- 4. Validações Monetárias Financeiras
    IF p_full_price < 0 OR p_student_price < 0 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Os preços não podem ser valores negativos';
    END IF;

    -- Categoria Integral (requires_wallet = false) EXIGE student_price = 0.00 no backend
    IF v_requires_wallet IS FALSE THEN
        IF p_student_price <> 0.00 THEN
            RAISE EXCEPTION 'INVALID_ARGUMENT: Alunos de categoria isenta (Integral) exigem student_price igual a 0.00';
        END IF;
    END IF;

    IF p_student_price > p_full_price THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: O preço pago pelo aluno não pode ser maior que o preço cheio';
    END IF;

    -- 5. Verificar a regra ativa vigente atual
    SELECT id, effective_from INTO v_current_rule_id, v_current_effective_from
    FROM public.meal_rules
    WHERE tenant_id = v_tenant_id
      AND unit_id = p_unit_id
      AND meal_type_id = p_meal_type_id
      AND category_id = p_category_id
      AND enabled = true
      AND effective_to IS NULL
    FOR UPDATE;

    -- Validar que a nova vigência é estritamente posterior ao início da vigência atual
    IF v_current_effective_from IS NOT NULL AND v_now <= v_current_effective_from THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: A nova data de vigência deve ser estritamente posterior ao início da vigência atual (%s)', v_current_effective_from;
    END IF;

    v_subsidy_amount := ROUND(p_full_price - p_student_price, 2);

    -- 6. Encerrar vigência da regra ativa anterior
    IF v_current_rule_id IS NOT NULL THEN
        UPDATE public.meal_rules
        SET 
            effective_to = v_now,
            enabled = false,
            updated_at = NOW()
        WHERE id = v_current_rule_id;
    END IF;

    -- 7. Inserir a nova regra com vigência atual
    INSERT INTO public.meal_rules (
        tenant_id,
        unit_id,
        meal_type_id,
        category_id,
        full_price,
        student_price,
        subsidy_amount,
        enabled,
        effective_from,
        effective_to
    )
    VALUES (
        v_tenant_id,
        p_unit_id,
        p_meal_type_id,
        p_category_id,
        p_full_price,
        p_student_price,
        v_subsidy_amount,
        true,
        v_now,
        NULL
    )
    RETURNING id INTO v_new_rule_id;

    RETURN v_new_rule_id;
END;
$$;

-- Hardening estrito de permissões especificando a assinatura exata da função
REVOKE ALL ON FUNCTION public.set_meal_rule(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_meal_rule(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_meal_rule(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TIMESTAMPTZ) TO service_role;
