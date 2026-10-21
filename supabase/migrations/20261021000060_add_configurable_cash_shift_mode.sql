-- Permite que cada unidade opere o caixa por refeicao (padrao) ou por dia.
-- Os consumos continuam vinculados ao tipo de refeicao; somente o ciclo
-- financeiro de abertura e fechamento do caixa muda.

ALTER TABLE public.units
    ADD COLUMN IF NOT EXISTS cash_shift_mode TEXT NOT NULL DEFAULT 'per_meal';

ALTER TABLE public.units
    DROP CONSTRAINT IF EXISTS units_cash_shift_mode_check;
ALTER TABLE public.units
    ADD CONSTRAINT units_cash_shift_mode_check
    CHECK (cash_shift_mode IN ('per_meal', 'daily'));

ALTER TABLE public.cash_shifts
    ADD COLUMN IF NOT EXISTS cash_shift_mode TEXT NOT NULL DEFAULT 'per_meal';

ALTER TABLE public.cash_shifts
    DROP CONSTRAINT IF EXISTS cash_shifts_cash_shift_mode_check;
ALTER TABLE public.cash_shifts
    ADD CONSTRAINT cash_shifts_cash_shift_mode_check
    CHECK (cash_shift_mode IN ('per_meal', 'daily'));

COMMENT ON COLUMN public.units.cash_shift_mode IS
    'Ciclo financeiro da unidade: per_meal fecha por refeicao; daily permanece aberto durante o mesmo dia.';
COMMENT ON COLUMN public.cash_shifts.cash_shift_mode IS
    'Snapshot do ciclo financeiro usado quando o caixa foi aberto.';

CREATE OR REPLACE FUNCTION public.get_unit_cash_shift_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller RECORD;
    v_result JSONB;
BEGIN
    SELECT p.tenant_id, p.role, p.status
      INTO v_caller
      FROM public.profiles AS p
     WHERE p.id = auth.uid();

    IF v_caller.tenant_id IS NULL
       OR v_caller.status <> 'active'
       OR v_caller.role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager') THEN
        RAISE EXCEPTION 'Acesso negado as configuracoes de caixa.';
    END IF;

    SELECT coalesce(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'unit_id', u.id,
                'unit_name', u.name,
                'cash_shift_mode', u.cash_shift_mode,
                'can_manage', v_caller.role IN ('admin_general', 'operations_director', 'unit_manager')
            ) ORDER BY u.name
        ),
        '[]'::JSONB
    )
      INTO v_result
      FROM public.units AS u
     WHERE u.tenant_id = v_caller.tenant_id
       AND u.status = 'active'
       AND public.has_unit_access(u.id);

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_unit_cash_shift_mode(
    p_unit_id UUID,
    p_cash_shift_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller RECORD;
    v_mode TEXT := pg_catalog.lower(pg_catalog.btrim(p_cash_shift_mode));
BEGIN
    SELECT p.tenant_id, p.role, p.status
      INTO v_caller
      FROM public.profiles AS p
     WHERE p.id = auth.uid();

    IF v_caller.tenant_id IS NULL
       OR v_caller.status <> 'active'
       OR v_caller.role NOT IN ('admin_general', 'operations_director', 'unit_manager')
       OR NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Perfil sem permissao para configurar o caixa desta unidade.';
    END IF;

    IF v_mode IS NULL OR v_mode NOT IN ('per_meal', 'daily') THEN
        RAISE EXCEPTION 'Modo de caixa invalido.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id
           AND cs.status = 'opened'
    ) THEN
        RAISE EXCEPTION 'Feche todos os caixas abertos da unidade antes de alterar o modo de funcionamento.';
    END IF;

    UPDATE public.units AS u
       SET cash_shift_mode = v_mode,
           updated_at = pg_catalog.now()
     WHERE u.id = p_unit_id
       AND u.tenant_id = v_caller.tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unidade nao encontrada no escopo autorizado.';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'unit_id', p_unit_id,
        'cash_shift_mode', v_mode
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.open_cash_shift(
    p_unit_id UUID,
    p_terminal_id VARCHAR(50),
    p_meal_type_id UUID DEFAULT NULL,
    p_initial_float NUMERIC(10,2) DEFAULT 0.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_tenant_id UUID;
    v_user_role public.user_role;
    v_cash_shift_mode TEXT;
    v_effective_meal_type_id UUID;
    v_existing_shift RECORD;
    v_new_shift RECORD;
BEGIN
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Operador nao autenticado.';
    END IF;

    SELECT p.role, p.tenant_id
      INTO v_user_role, v_tenant_id
      FROM public.profiles AS p
     WHERE p.id = v_operator_id
       AND p.status = 'active';

    IF v_user_role IS NULL OR v_user_role NOT IN ('admin_general', 'operations_director', 'unit_manager', 'operator') THEN
        RAISE EXCEPTION 'Permissao negada para abertura de caixa.';
    END IF;
    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Operador nao possui acesso a unidade selecionada.';
    END IF;
    IF p_initial_float IS NULL OR p_initial_float < 0 THEN
        RAISE EXCEPTION 'O fundo de troco deve ser maior ou igual a zero.';
    END IF;

    SELECT u.cash_shift_mode
      INTO v_cash_shift_mode
      FROM public.units AS u
     WHERE u.id = p_unit_id
       AND u.tenant_id = v_tenant_id
       AND u.status = 'active';

    IF v_cash_shift_mode IS NULL THEN
        RAISE EXCEPTION 'Unidade ativa nao encontrada.';
    END IF;

    IF v_cash_shift_mode = 'per_meal' THEN
        IF p_meal_type_id IS NULL OR NOT EXISTS (
            SELECT 1
              FROM public.unit_meal_types AS umt
             WHERE umt.unit_id = p_unit_id
               AND umt.meal_type_id = p_meal_type_id
               AND umt.enabled = true
        ) THEN
            RAISE EXCEPTION 'Selecione uma refeicao habilitada antes de abrir o caixa por turno.';
        END IF;
        v_effective_meal_type_id := p_meal_type_id;
    ELSE
        v_effective_meal_type_id := NULL;
    END IF;

    SELECT cs.*
      INTO v_existing_shift
      FROM public.cash_shifts AS cs
     WHERE cs.unit_id = p_unit_id
       AND cs.terminal_id = p_terminal_id
       AND cs.status = 'opened'
     ORDER BY cs.opened_at DESC
     LIMIT 1;

    IF v_existing_shift.id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'already_opened', true,
            'cash_shift', pg_catalog.to_jsonb(v_existing_shift)
        );
    END IF;

    INSERT INTO public.cash_shifts (
        tenant_id, unit_id, meal_type_id, terminal_id, operator_id,
        status, opened_at, initial_float_amount, cash_shift_mode
    ) VALUES (
        v_tenant_id, p_unit_id, v_effective_meal_type_id, p_terminal_id,
        v_operator_id, 'opened', pg_catalog.now(), p_initial_float,
        v_cash_shift_mode
    )
    RETURNING * INTO v_new_shift;

    IF p_initial_float > 0 THEN
        INSERT INTO public.cash_movements (
            cash_shift_id, type, amount, payment_method, description, operator_id
        ) VALUES (
            v_new_shift.id, 'initial_float', p_initial_float, 'cash',
            'Fundo de troco inicial informado na abertura', v_operator_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'already_opened', false,
        'cash_shift', pg_catalog.to_jsonb(v_new_shift)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_operator_terminal_meal(
    p_unit_id UUID,
    p_identifier TEXT,
    p_meal_type_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_terminal_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_meal_type_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'MEAL_TYPE_REQUIRED', 'message', 'Selecione a refeicao antes de iniciar o atendimento.');
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id AND cs.terminal_id = p_terminal_id
           AND cs.operator_id = auth.uid() AND cs.status = 'opened'
           AND (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'STALE_CASH_SHIFT', 'message', 'O caixa aberto pertence a uma data anterior e deve ser fechado.');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id AND cs.terminal_id = p_terminal_id
           AND cs.operator_id = auth.uid() AND cs.status = 'opened'
           AND (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               = (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
           AND (cs.cash_shift_mode = 'daily' OR cs.meal_type_id = p_meal_type_id)
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra um caixa compativel com a refeicao selecionada antes de iniciar o atendimento.');
    END IF;
    RETURN public.consume_meal(p_unit_id, p_identifier, p_meal_type_id, p_idempotency_key, p_terminal_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_operator_terminal_payment(
    p_unit_id UUID,
    p_identifier TEXT,
    p_meal_type_id UUID,
    p_terminal_id TEXT,
    p_idempotency_key TEXT,
    p_payment_method TEXT,
    p_amount_received NUMERIC(10,2) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_unit_access(p_unit_id) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED_UNIT', 'message', 'Operador sem acesso a unidade selecionada.');
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id AND cs.terminal_id = p_terminal_id
           AND cs.operator_id = auth.uid() AND cs.status = 'opened'
           AND (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'STALE_CASH_SHIFT', 'message', 'O caixa aberto pertence a uma data anterior e deve ser fechado.');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id AND cs.terminal_id = p_terminal_id
           AND cs.operator_id = auth.uid() AND cs.status = 'opened'
           AND (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               = (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
           AND (cs.cash_shift_mode = 'daily' OR cs.meal_type_id = p_meal_type_id)
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra um caixa compativel com a refeicao selecionada antes de confirmar o pagamento.');
    END IF;
    RETURN public.confirm_terminal_meal_payment(p_unit_id, p_identifier, p_meal_type_id, p_terminal_id, p_idempotency_key, p_payment_method, p_amount_received);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_operator_visitor_entry(
    p_unit_id UUID,
    p_meal_type_id UUID DEFAULT NULL,
    p_terminal_id TEXT DEFAULT 'TERM-01',
    p_payment_method TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_meal_type_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'MEAL_TYPE_REQUIRED', 'message', 'Selecione a refeicao antes de registrar visitante.');
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id AND cs.terminal_id = p_terminal_id
           AND cs.operator_id = auth.uid() AND cs.status = 'opened'
           AND (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'STALE_CASH_SHIFT', 'message', 'O caixa aberto pertence a uma data anterior e deve ser fechado.');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id AND cs.terminal_id = p_terminal_id
           AND cs.operator_id = auth.uid() AND cs.status = 'opened'
           AND (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               = (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
           AND (cs.cash_shift_mode = 'daily' OR cs.meal_type_id = p_meal_type_id)
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra um caixa compativel com a refeicao selecionada antes de registrar visitante.');
    END IF;
    RETURN public.register_terminal_visitor_entry(p_unit_id, p_meal_type_id, p_terminal_id, p_payment_method);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_cash_shifts(
    p_unit_id UUID DEFAULT NULL,
    p_meal_type_id UUID DEFAULT NULL,
    p_status VARCHAR(20) DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller RECORD;
    v_result JSONB;
BEGIN
    SELECT p.tenant_id, p.role, p.status INTO v_caller
      FROM public.profiles AS p WHERE p.id = auth.uid();

    IF v_caller.tenant_id IS NULL OR v_caller.status <> 'active'
       OR v_caller.role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager') THEN
        RAISE EXCEPTION 'Acesso negado aos relatorios de caixa.';
    END IF;

    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', cs.id, 'tenant_id', cs.tenant_id, 'unit_id', cs.unit_id,
        'unit_name', u.name, 'terminal_id', cs.terminal_id,
        'meal_type_id', cs.meal_type_id, 'meal_type_name', mt.name,
        'cash_shift_mode', cs.cash_shift_mode,
        'operator_id', cs.operator_id, 'operator_name', op.full_name,
        'status', cs.status, 'opened_at', cs.opened_at, 'closed_at', cs.closed_at,
        'closed_by', cs.closed_by, 'initial_float_amount', cs.initial_float_amount,
        'total_visitors_count', cs.total_visitors_count, 'total_visitors_amount', cs.total_visitors_amount,
        'total_supplies_amount', cs.total_supplies_amount, 'total_bleed_amount', cs.total_bleed_amount,
        'system_expected_balance', cs.system_expected_balance, 'expected_cash_balance', cs.expected_cash_balance,
        'counter_payments_count', cs.counter_payments_count, 'counter_payments_amount', cs.counter_payments_amount,
        'counter_cash_amount', cs.counter_cash_amount, 'counter_pix_amount', cs.counter_pix_amount,
        'counter_card_amount', cs.counter_card_amount, 'counter_other_amount', cs.counter_other_amount,
        'counter_refunds_amount', cs.counter_refunds_amount,
        'counted_closing_balance', cs.counted_closing_balance,
        'difference_amount', cs.difference_amount, 'closing_notes', cs.closing_notes
    ) ORDER BY cs.opened_at DESC), '[]'::JSONB)
      INTO v_result
      FROM public.cash_shifts AS cs
      JOIN public.units AS u ON u.id = cs.unit_id
      LEFT JOIN public.meal_types AS mt ON mt.id = cs.meal_type_id
      JOIN public.profiles AS op ON op.id = cs.operator_id
     WHERE cs.tenant_id = v_caller.tenant_id
       AND public.has_unit_access(cs.unit_id)
       AND (p_unit_id IS NULL OR cs.unit_id = p_unit_id)
       AND (p_meal_type_id IS NULL OR cs.meal_type_id = p_meal_type_id)
       AND (p_status IS NULL OR cs.status = p_status)
       AND (p_start_date IS NULL OR (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE >= p_start_date)
       AND (p_end_date IS NULL OR (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE <= p_end_date);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unit_cash_shift_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_unit_cash_shift_mode(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_cash_shift(UUID, VARCHAR, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_operator_terminal_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_operator_terminal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_operator_visitor_entry(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_cash_shifts(UUID, UUID, VARCHAR, DATE, DATE) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_unit_cash_shift_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_unit_cash_shift_mode(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_operator_terminal_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_operator_terminal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_operator_visitor_entry(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_cash_shifts(UUID, UUID, VARCHAR, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
