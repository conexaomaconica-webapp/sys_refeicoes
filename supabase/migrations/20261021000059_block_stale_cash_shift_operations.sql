-- Impede novas operacoes em caixas de dias anteriores.
-- O caixa antigo permanece intacto e pode ser conferido/fechado normalmente.

CREATE OR REPLACE FUNCTION public.get_operator_terminal_shift(
    p_unit_id UUID,
    p_terminal_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator UUID := auth.uid();
    v_shift RECORD;
    v_movements JSONB;
    v_stale BOOLEAN;
BEGIN
    IF v_operator IS NULL OR NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Operador sem acesso a unidade selecionada.';
    END IF;

    SELECT * INTO v_shift
      FROM public.cash_shifts
     WHERE unit_id = p_unit_id
       AND terminal_id = p_terminal_id
       AND status = 'opened'
     ORDER BY opened_at DESC
     LIMIT 1;

    IF v_shift.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('has_active_shift', false, 'cash_shift', NULL, 'movements', '[]'::JSONB);
    END IF;

    IF v_shift.operator_id <> v_operator THEN
        RETURN pg_catalog.jsonb_build_object(
            'has_active_shift', false,
            'terminal_locked', true,
            'message', 'Este terminal possui um caixa aberto por outro operador. O turno anterior deve ser encerrado.'
        );
    END IF;

    v_stale := (v_shift.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
        <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE;

    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.created_at DESC), '[]'::JSONB)
      INTO v_movements
      FROM public.cash_movements AS m
     WHERE m.cash_shift_id = v_shift.id;

    RETURN pg_catalog.jsonb_build_object(
        'has_active_shift', true,
        'cash_shift', pg_catalog.to_jsonb(v_shift),
        'movements', v_movements,
        'stale_shift', v_stale
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_operator_cash_movement(
    p_cash_shift_id UUID,
    p_type TEXT,
    p_amount NUMERIC(10,2),
    p_payment_method TEXT DEFAULT 'cash',
    p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_shift RECORD;
BEGIN
    SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_cash_shift_id;
    IF v_shift.id IS NULL OR v_shift.status <> 'opened' OR v_shift.operator_id <> auth.uid() THEN
        RAISE EXCEPTION 'Movimentacao permitida somente no caixa aberto pelo operador atual.';
    END IF;
    IF (v_shift.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
        <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE THEN
        RAISE EXCEPTION 'Caixa de data anterior. Confira e feche o caixa antes de registrar novas movimentacoes.';
    END IF;
    RETURN public.record_cash_movement(p_cash_shift_id, p_type::VARCHAR, p_amount, p_payment_method::VARCHAR, p_description);
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
    IF EXISTS (
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id AND terminal_id = p_terminal_id
           AND operator_id = auth.uid() AND status = 'opened'
           AND (opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'STALE_CASH_SHIFT', 'message', 'O caixa aberto pertence a uma data anterior e deve ser fechado.');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id AND terminal_id = p_terminal_id
           AND operator_id = auth.uid() AND status = 'opened'
           AND (opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               = (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
           AND (p_meal_type_id IS NULL OR meal_type_id = p_meal_type_id)
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra o caixa do turno selecionado antes de iniciar o atendimento.');
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
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id AND terminal_id = p_terminal_id
           AND operator_id = auth.uid() AND status = 'opened'
           AND (opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'STALE_CASH_SHIFT', 'message', 'O caixa aberto pertence a uma data anterior e deve ser fechado.');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id AND terminal_id = p_terminal_id
           AND operator_id = auth.uid() AND status = 'opened'
           AND meal_type_id = p_meal_type_id
           AND (opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               = (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra o caixa do turno selecionado antes de confirmar o pagamento.');
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
    IF EXISTS (
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id AND terminal_id = p_terminal_id
           AND operator_id = auth.uid() AND status = 'opened'
           AND (opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'STALE_CASH_SHIFT', 'message', 'O caixa aberto pertence a uma data anterior e deve ser fechado.');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id AND terminal_id = p_terminal_id
           AND operator_id = auth.uid() AND status = 'opened'
           AND meal_type_id = p_meal_type_id
           AND (opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               = (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra o caixa do turno selecionado antes de registrar visitante.');
    END IF;
    RETURN public.register_terminal_visitor_entry(p_unit_id, p_meal_type_id, p_terminal_id, p_payment_method);
END;
$$;

REVOKE ALL ON FUNCTION public.get_operator_terminal_shift(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_operator_cash_movement(UUID, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_operator_terminal_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_operator_terminal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_operator_visitor_entry(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_operator_terminal_shift(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_operator_cash_movement(UUID, TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_operator_terminal_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_operator_terminal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_operator_visitor_entry(UUID, UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
