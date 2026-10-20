-- ==============================================================================
-- Migration: 20260927000035_create_cash_shift_control.sql
-- Descrição: Estrutura completa para Controle de Caixa por Turno e Unidade (PDV):
--            - Abertura de Caixa com Fundo de Troco (Saldo Inicial)
--            - Registro de Entradas (Visitantes / Vendas na Catraca)
--            - Registro de Suprimentos e Sangrias (Retiradas parciais para cofre)
--            - Fechamento de Caixa com Conferência Cega e Cálculo de Diferença (Sobra/Falta)
--            - Políticas RLS por Perfil (Operador, Gerente, Supervisor, Financeiro, Admin)
-- ==============================================================================

-- 1. Tabela de Turnos/Sessões de Caixa (cash_shifts)
CREATE TABLE IF NOT EXISTS public.cash_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
    meal_type_id UUID REFERENCES public.meal_types(id) ON DELETE SET NULL,
    terminal_id VARCHAR(50) NOT NULL,
    operator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'opened' CHECK (status IN ('opened', 'closed')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    initial_float_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (initial_float_amount >= 0),
    total_visitors_count INTEGER NOT NULL DEFAULT 0 CHECK (total_visitors_count >= 0),
    total_visitors_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (total_visitors_amount >= 0),
    total_supplies_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (total_supplies_amount >= 0),
    total_bleed_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (total_bleed_amount >= 0),
    system_expected_balance NUMERIC(10,2) GENERATED ALWAYS AS (
        initial_float_amount + total_visitors_amount + total_supplies_amount - total_bleed_amount
    ) STORED,
    counted_closing_balance NUMERIC(10,2),
    difference_amount NUMERIC(10,2),
    closing_notes TEXT,
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_cash_shifts_tenant_unit_status ON public.cash_shifts (tenant_id, unit_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_terminal_status ON public.cash_shifts (terminal_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_operator ON public.cash_shifts (operator_id, opened_at DESC);

-- 2. Tabela de Movimentações de Caixa (cash_movements)
CREATE TABLE IF NOT EXISTS public.cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cash_shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('initial_float', 'visitor_sale', 'supply', 'bleed', 'adjustment')),
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'pix', 'card', 'other')),
    description TEXT,
    meal_consumption_id UUID REFERENCES public.meal_consumptions(id) ON DELETE SET NULL,
    operator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON public.cash_movements (cash_shift_id, created_at DESC);

-- 3. Habilitar RLS
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS para cash_shifts
DROP POLICY IF EXISTS "cash_shifts_select_policy" ON public.cash_shifts;
CREATE POLICY "cash_shifts_select_policy" ON public.cash_shifts
    FOR SELECT TO authenticated
    USING (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        OR (
            public.get_auth_user_role() IN ('supervisor', 'unit_manager', 'operator')
            AND public.has_unit_access(unit_id)
        )
    );

DROP POLICY IF EXISTS "cash_shifts_insert_policy" ON public.cash_shifts;
CREATE POLICY "cash_shifts_insert_policy" ON public.cash_shifts
    FOR INSERT TO authenticated
    WITH CHECK (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'unit_manager', 'operator')
        AND public.has_unit_access(unit_id)
    );

DROP POLICY IF EXISTS "cash_shifts_update_policy" ON public.cash_shifts;
CREATE POLICY "cash_shifts_update_policy" ON public.cash_shifts
    FOR UPDATE TO authenticated
    USING (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        OR (
            public.get_auth_user_role() IN ('unit_manager', 'operator')
            AND public.has_unit_access(unit_id)
        )
    );

-- 5. Políticas RLS para cash_movements
DROP POLICY IF EXISTS "cash_movements_select_policy" ON public.cash_movements;
CREATE POLICY "cash_movements_select_policy" ON public.cash_movements
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.cash_shifts s
            WHERE s.id = cash_movements.cash_shift_id
            AND (
                public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
                OR (
                    public.get_auth_user_role() IN ('supervisor', 'unit_manager', 'operator')
                    AND public.has_unit_access(s.unit_id)
                )
            )
        )
    );

DROP POLICY IF EXISTS "cash_movements_insert_policy" ON public.cash_movements;
CREATE POLICY "cash_movements_insert_policy" ON public.cash_movements
    FOR INSERT TO authenticated
    WITH CHECK (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'unit_manager', 'operator')
    );

-- 6. RPC: Abrir Turno de Caixa
CREATE OR REPLACE FUNCTION public.open_cash_shift(
    p_unit_id UUID,
    p_terminal_id VARCHAR(50),
    p_meal_type_id UUID DEFAULT NULL,
    p_initial_float NUMERIC(10,2) DEFAULT 0.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_tenant_id UUID;
    v_user_role public.user_role;
    v_existing_shift_id UUID;
    v_new_shift_id UUID;
    v_result JSONB;
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Operador não autenticado.';
    END IF;

    SELECT role, tenant_id INTO v_user_role, v_tenant_id
    FROM public.profiles
    WHERE id = v_operator_id;

    IF v_user_role NOT IN ('admin_general', 'operations_director', 'unit_manager', 'operator') THEN
        RAISE EXCEPTION 'Permissão negada para abertura de caixa.';
    END IF;

    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Operador não possui acesso à unidade selecionada.';
    END IF;

    -- Verificar se já existe um caixa aberto para este terminal
    SELECT id INTO v_existing_shift_id
    FROM public.cash_shifts
    WHERE unit_id = p_unit_id
      AND terminal_id = p_terminal_id
      AND status = 'opened'
    LIMIT 1;

    IF v_existing_shift_id IS NOT NULL THEN
        -- Retornar o caixa já aberto
        SELECT to_jsonb(s) INTO v_result
        FROM public.cash_shifts s
        WHERE s.id = v_existing_shift_id;
        
        RETURN jsonb_build_object(
            'success', true,
            'already_opened', true,
            'cash_shift', v_result
        );
    END IF;

    -- Criar novo turno de caixa
    INSERT INTO public.cash_shifts (
        tenant_id,
        unit_id,
        meal_type_id,
        terminal_id,
        operator_id,
        status,
        opened_at,
        initial_float_amount
    ) VALUES (
        v_tenant_id,
        p_unit_id,
        p_meal_type_id,
        p_terminal_id,
        v_operator_id,
        'opened',
        now(),
        p_initial_float
    ) RETURNING id INTO v_new_shift_id;

    -- Registrar movimentação de Fundo de Troco
    IF p_initial_float > 0 THEN
        INSERT INTO public.cash_movements (
            cash_shift_id,
            type,
            amount,
            payment_method,
            description,
            operator_id
        ) VALUES (
            v_new_shift_id,
            'initial_float',
            p_initial_float,
            'cash',
            'Fundo de troco inicial informado na abertura',
            v_operator_id
        );
    END IF;

    SELECT to_jsonb(s) INTO v_result
    FROM public.cash_shifts s
    WHERE s.id = v_new_shift_id;

    RETURN jsonb_build_object(
        'success', true,
        'already_opened', false,
        'cash_shift', v_result
    );
END;
$$;

-- 7. RPC: Obter Caixa Aberto do Terminal
CREATE OR REPLACE FUNCTION public.get_active_cash_shift(
    p_unit_id UUID,
    p_terminal_id VARCHAR(50)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_shift RECORD;
    v_movements JSONB;
BEGIN
    SELECT * INTO v_shift
    FROM public.cash_shifts
    WHERE unit_id = p_unit_id
      AND terminal_id = p_terminal_id
      AND status = 'opened'
    ORDER BY opened_at DESC
    LIMIT 1;

    IF v_shift.id IS NULL THEN
        RETURN jsonb_build_object(
            'has_active_shift', false,
            'cash_shift', NULL,
            'movements', '[]'::jsonb
        );
    END IF;

    -- Buscar últimas movimentações
    SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC), '[]'::jsonb)
    INTO v_movements
    FROM public.cash_movements m
    WHERE m.cash_shift_id = v_shift.id;

    RETURN jsonb_build_object(
        'has_active_shift', true,
        'cash_shift', to_jsonb(v_shift),
        'movements', v_movements
    );
END;
$$;

-- 8. RPC: Registrar Sangria ou Suprimento
CREATE OR REPLACE FUNCTION public.record_cash_movement(
    p_cash_shift_id UUID,
    p_type VARCHAR(30),
    p_amount NUMERIC(10,2),
    p_payment_method VARCHAR(20) DEFAULT 'cash',
    p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_shift RECORD;
    v_movement_id UUID;
    v_updated_shift JSONB;
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Operador não autenticado.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da movimentação deve ser maior que zero.';
    END IF;

    IF p_type NOT IN ('supply', 'bleed', 'adjustment') THEN
        RAISE EXCEPTION 'Tipo de movimentação inválido: %', p_type;
    END IF;

    SELECT * INTO v_shift
    FROM public.cash_shifts
    WHERE id = p_cash_shift_id;

    IF v_shift.id IS NULL THEN
        RAISE EXCEPTION 'Turno de caixa não encontrado.';
    END IF;

    IF v_shift.status != 'opened' THEN
        RAISE EXCEPTION 'O caixa já se encontra fechado.';
    END IF;

    -- Inserir movimentação
    INSERT INTO public.cash_movements (
        cash_shift_id,
        type,
        amount,
        payment_method,
        description,
        operator_id
    ) VALUES (
        p_cash_shift_id,
        p_type,
        p_amount,
        p_payment_method,
        coalesce(p_description, CASE WHEN p_type = 'bleed' THEN 'Sangria de caixa' ELSE 'Suprimento de troco' END),
        v_operator_id
    ) RETURNING id INTO v_movement_id;

    -- Atualizar totais no cash_shift
    IF p_type = 'bleed' THEN
        UPDATE public.cash_shifts
        SET total_bleed_amount = total_bleed_amount + p_amount,
            updated_at = now()
        WHERE id = p_cash_shift_id;
    ELSIF p_type = 'supply' THEN
        UPDATE public.cash_shifts
        SET total_supplies_amount = total_supplies_amount + p_amount,
            updated_at = now()
        WHERE id = p_cash_shift_id;
    END IF;

    SELECT to_jsonb(s) INTO v_updated_shift
    FROM public.cash_shifts s
    WHERE s.id = p_cash_shift_id;

    RETURN jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'cash_shift', v_updated_shift
    );
END;
$$;

-- 9. RPC: Fechar Turno de Caixa (Conferência Cega)
CREATE OR REPLACE FUNCTION public.close_cash_shift(
    p_cash_shift_id UUID,
    p_counted_amount NUMERIC(10,2),
    p_closing_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_shift RECORD;
    v_diff NUMERIC(10,2);
    v_expected NUMERIC(10,2);
    v_result JSONB;
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Operador não autenticado.';
    END IF;

    SELECT * INTO v_shift
    FROM public.cash_shifts
    WHERE id = p_cash_shift_id;

    IF v_shift.id IS NULL THEN
        RAISE EXCEPTION 'Turno de caixa não encontrado.';
    END IF;

    IF v_shift.status = 'closed' THEN
        RAISE EXCEPTION 'Este caixa já foi fechado anteriormente em %', v_shift.closed_at;
    END IF;

    v_expected := v_shift.system_expected_balance;
    v_diff := p_counted_amount - v_expected;

    UPDATE public.cash_shifts
    SET status = 'closed',
        counted_closing_balance = p_counted_amount,
        difference_amount = v_diff,
        closing_notes = p_closing_notes,
        closed_at = now(),
        closed_by = v_operator_id,
        updated_at = now()
    WHERE id = p_cash_shift_id;

    SELECT to_jsonb(s) INTO v_result
    FROM public.cash_shifts s
    WHERE s.id = p_cash_shift_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Caixa encerrado com sucesso.',
        'difference_amount', v_diff,
        'difference_status', CASE 
            WHEN v_diff = 0 THEN 'balanced'
            WHEN v_diff > 0 THEN 'surplus'
            ELSE 'shortage'
        END,
        'cash_shift', v_result
    );
END;
$$;

-- 10. Atualizar a RPC register_visitor_entry para amarrar ao caixa aberto do terminal
CREATE OR REPLACE FUNCTION public.register_visitor_entry(
    p_unit_id UUID,
    p_meal_type_id UUID DEFAULT NULL,
    p_terminal_id TEXT DEFAULT 'TERM-01',
    p_payment_method VARCHAR(20) DEFAULT 'cash'
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
    v_consume_res JSONB;
    v_active_shift_id UUID;
    v_price NUMERIC(10,2);
    v_consumption_id UUID;
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

    v_consume_res := public.consume_meal(
        p_unit_id,
        v_reg_number,
        p_meal_type_id,
        v_idempotency,
        p_terminal_id
    );

    -- Se o consumo foi registrado com sucesso, vincular ao caixa aberto do terminal
    IF (v_consume_res->>'success')::boolean = true THEN
        SELECT id INTO v_active_shift_id
        FROM public.cash_shifts
        WHERE unit_id = p_unit_id
          AND terminal_id = p_terminal_id
          AND status = 'opened'
        LIMIT 1;

        IF v_active_shift_id IS NOT NULL THEN
            v_price := coalesce((v_consume_res->'financial'->>'student_price')::numeric, 0.00);
            v_consumption_id := (v_consume_res->>'consumption_id')::uuid;

            INSERT INTO public.cash_movements (
                cash_shift_id,
                type,
                amount,
                payment_method,
                description,
                meal_consumption_id,
                operator_id
            ) VALUES (
                v_active_shift_id,
                'visitor_sale',
                v_price,
                p_payment_method,
                'Venda avulsa de refeição para visitante (Entrada)',
                v_consumption_id,
                v_caller.id
            );

            UPDATE public.cash_shifts
            SET total_visitors_count = total_visitors_count + 1,
                total_visitors_amount = total_visitors_amount + v_price,
                updated_at = now()
            WHERE id = v_active_shift_id;
        END IF;

        v_consume_res := jsonb_set(v_consume_res, '{cash_shift_id}', to_jsonb(v_active_shift_id));
    END IF;

    RETURN v_consume_res;
END;
$$;

-- 11. RPC: Listar Turnos de Caixa para Gestão e Auditoria
CREATE OR REPLACE FUNCTION public.admin_list_cash_shifts(
    p_unit_id UUID DEFAULT NULL,
    p_status VARCHAR(20) DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_role public.user_role;
    v_result JSONB;
BEGIN
    v_caller_role := public.get_auth_user_role();

    IF v_caller_role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager') THEN
        RAISE EXCEPTION 'Acesso negado aos relatórios de caixa.';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'id', s.id,
            'unit_id', s.unit_id,
            'unit_name', u.name,
            'terminal_id', s.terminal_id,
            'meal_type_id', s.meal_type_id,
            'meal_type_name', mt.name,
            'operator_id', s.operator_id,
            'operator_name', p.full_name,
            'status', s.status,
            'opened_at', s.opened_at,
            'closed_at', s.closed_at,
            'initial_float_amount', s.initial_float_amount,
            'total_visitors_count', s.total_visitors_count,
            'total_visitors_amount', s.total_visitors_amount,
            'total_supplies_amount', s.total_supplies_amount,
            'total_bleed_amount', s.total_bleed_amount,
            'system_expected_balance', s.system_expected_balance,
            'counted_closing_balance', s.counted_closing_balance,
            'difference_amount', s.difference_amount,
            'closing_notes', s.closing_notes
        ) ORDER BY s.opened_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM public.cash_shifts s
    JOIN public.units u ON u.id = s.unit_id
    LEFT JOIN public.meal_types mt ON mt.id = s.meal_type_id
    JOIN public.profiles p ON p.id = s.operator_id
    WHERE public.has_unit_access(s.unit_id)
    AND (p_unit_id IS NULL OR s.unit_id = p_unit_id)
    AND (p_status IS NULL OR s.status = p_status)
    AND (p_start_date IS NULL OR s.opened_at::date >= p_start_date)
    AND (p_end_date IS NULL OR s.opened_at::date <= p_end_date);

    RETURN v_result;
END;
$$;

-- Conceder permissões
GRANT EXECUTE ON FUNCTION public.open_cash_shift(UUID, VARCHAR, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_cash_shift(UUID, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_movement(UUID, VARCHAR, NUMERIC, VARCHAR, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_visitor_entry(UUID, UUID, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_cash_shifts(UUID, VARCHAR, DATE, DATE) TO authenticated;
