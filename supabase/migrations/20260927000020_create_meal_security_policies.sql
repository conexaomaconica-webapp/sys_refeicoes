-- ==============================================================================
-- Migration: 20260927000020_create_meal_security_policies.sql
-- Descrição: Configuração de RLS forçado para public.meal_types,
--            public.unit_meal_types e public.meal_rules, policies por perfil e
--            RPC server-side atômica set_meal_rule com autorização rigorosa por perfil.
-- ==============================================================================

-- 1. Habilitar RLS forçado em todas as tabelas
ALTER TABLE public.meal_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_types FORCE ROW LEVEL SECURITY;

ALTER TABLE public.unit_meal_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_meal_types FORCE ROW LEVEL SECURITY;

ALTER TABLE public.meal_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_rules FORCE ROW LEVEL SECURITY;

-- ==============================================================================
-- POLICIES DE LEITURA (SELECT)
-- ==============================================================================

-- Qualquer usuário autenticado do mesmo tenant pode ler meal_types
DROP POLICY IF EXISTS sel_meal_types_tenant ON public.meal_types;
CREATE POLICY sel_meal_types_tenant ON public.meal_types
FOR SELECT TO authenticated
USING (tenant_id = public.get_auth_tenant_id());

-- Qualquer usuário autenticado do mesmo tenant pode ler unit_meal_types
DROP POLICY IF EXISTS sel_unit_meal_types_tenant ON public.unit_meal_types;
CREATE POLICY sel_unit_meal_types_tenant ON public.unit_meal_types
FOR SELECT TO authenticated
USING (tenant_id = public.get_auth_tenant_id());

-- Qualquer usuário autenticado do mesmo tenant pode ler meal_rules
DROP POLICY IF EXISTS sel_meal_rules_tenant ON public.meal_rules;
CREATE POLICY sel_meal_rules_tenant ON public.meal_rules
FOR SELECT TO authenticated
USING (tenant_id = public.get_auth_tenant_id());

-- ==============================================================================
-- POLICIES DE ESCRITA (INSERT / UPDATE / DELETE)
-- ==============================================================================

-- meal_types: Apenas admin_general e operations_director podem alterar catálogo global de refeições
DROP POLICY IF EXISTS mut_meal_types_admin ON public.meal_types;
CREATE POLICY mut_meal_types_admin ON public.meal_types
FOR ALL TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director')
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director')
);

-- unit_meal_types: admin_general, operations_director e unit_manager da unidade podem configurar
DROP POLICY IF EXISTS mut_unit_meal_types_admin ON public.unit_meal_types;
CREATE POLICY mut_unit_meal_types_admin ON public.unit_meal_types
FOR ALL TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_user_role() IN ('admin_general', 'operations_director')
        OR (
            public.get_auth_user_role() = 'unit_manager'
            AND EXISTS (
                SELECT 1 FROM public.user_unit_access uua
                WHERE uua.user_id = auth.uid()
                  AND uua.unit_id = unit_meal_types.unit_id
                  AND uua.tenant_id = unit_meal_types.tenant_id
            )
        )
    )
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_user_role() IN ('admin_general', 'operations_director')
        OR (
            public.get_auth_user_role() = 'unit_manager'
            AND EXISTS (
                SELECT 1 FROM public.user_unit_access uua
                WHERE uua.user_id = auth.uid()
                  AND uua.unit_id = unit_meal_types.unit_id
                  AND uua.tenant_id = unit_meal_types.tenant_id
            )
        )
    )
);

-- meal_rules: Apenas admin_general e operations_director gerenciam regras financeiras de preços
DROP POLICY IF EXISTS mut_meal_rules_admin ON public.meal_rules;
CREATE POLICY mut_meal_rules_admin ON public.meal_rules
FOR ALL TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director')
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director')
);

-- ==============================================================================
-- RPC: Criar/Atualizar Regra de Preço Preservando Histórico de Vigência (Server-Side)
-- ==============================================================================

-- Eliminação dinâmica e absoluta de TODAS as assinaturas anteriores de set_meal_rule em pg_proc
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
    v_subsidy_amount NUMERIC(12, 2);
    v_new_rule_id UUID;
    v_now TIMESTAMPTZ := COALESCE(p_effective_from, NOW());
BEGIN
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

    v_subsidy_amount := ROUND(p_full_price - p_student_price, 2);

    -- 5. Encerrar vigência da regra ativa anterior para a mesma combinação (se existir)
    UPDATE public.meal_rules
    SET 
        effective_to = v_now,
        enabled = false,
        updated_at = NOW()
    WHERE tenant_id = v_tenant_id
      AND unit_id = p_unit_id
      AND meal_type_id = p_meal_type_id
      AND category_id = p_category_id
      AND enabled = true
      AND (effective_to IS NULL OR effective_to > v_now);

    -- 6. Inserir a nova regra com vigência atual
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

-- Hardening estrito de revogação de permissão pública e authenticated especificando a assinatura exata
REVOKE ALL ON FUNCTION public.set_meal_rule(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_meal_rule(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_meal_rule(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TIMESTAMPTZ) TO service_role;
