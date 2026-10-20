-- Sessao operacional do terminal vinculada ao operador autenticado.
-- Migration aditiva: preserva as RPCs legadas e expoe pontos de entrada
-- exclusivos para o Terminal/PDV.

CREATE OR REPLACE FUNCTION public.get_operator_terminal_shift(
    p_unit_id UUID,
    p_terminal_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator UUID := auth.uid();
    v_shift RECORD;
    v_movements JSONB;
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
        RETURN jsonb_build_object('has_active_shift', false, 'cash_shift', NULL, 'movements', '[]'::jsonb);
    END IF;

    IF v_shift.operator_id <> v_operator THEN
        RETURN jsonb_build_object(
            'has_active_shift', false,
            'terminal_locked', true,
            'message', 'Este terminal possui um caixa aberto por outro operador. O turno anterior deve ser encerrado.'
        );
    END IF;

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

CREATE OR REPLACE FUNCTION public.open_operator_cash_shift(
    p_unit_id UUID,
    p_terminal_id TEXT,
    p_meal_type_id UUID DEFAULT NULL,
    p_initial_float NUMERIC(10,2) DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator UUID := auth.uid();
    v_shift RECORD;
BEGIN
    IF v_operator IS NULL OR NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Operador sem acesso a unidade selecionada.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_unit_id::text || ':' || p_terminal_id, 0));

    SELECT * INTO v_shift
      FROM public.cash_shifts
     WHERE unit_id = p_unit_id AND terminal_id = p_terminal_id AND status = 'opened'
     LIMIT 1;

    IF v_shift.id IS NOT NULL AND v_shift.operator_id <> v_operator THEN
        RAISE EXCEPTION 'Terminal em uso por outro operador. Encerre o caixa anterior antes de iniciar um novo turno.';
    END IF;

    RETURN public.open_cash_shift(p_unit_id, p_terminal_id::VARCHAR, p_meal_type_id, p_initial_float);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_operator_cash_shift(
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
    v_operator UUID := auth.uid();
    v_shift RECORD;
BEGIN
    SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_cash_shift_id FOR UPDATE;
    IF v_shift.id IS NULL OR v_shift.status <> 'opened' THEN
        RAISE EXCEPTION 'Caixa aberto nao encontrado.';
    END IF;
    IF v_operator IS NULL OR v_shift.operator_id <> v_operator THEN
        RAISE EXCEPTION 'Somente o operador que abriu o caixa pode encerra-lo.';
    END IF;
    RETURN public.close_cash_shift(p_cash_shift_id, p_counted_amount, p_closing_notes);
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_shift RECORD;
BEGIN
    SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_cash_shift_id;
    IF v_shift.id IS NULL OR v_shift.status <> 'opened' OR v_shift.operator_id <> auth.uid() THEN
        RAISE EXCEPTION 'Movimentacao permitida somente no caixa aberto pelo operador atual.';
    END IF;
    RETURN public.record_cash_movement(
        p_cash_shift_id,
        p_type::VARCHAR,
        p_amount,
        p_payment_method::VARCHAR,
        p_description
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
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id
           AND terminal_id = p_terminal_id
           AND operator_id = auth.uid()
           AND status = 'opened'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra o caixa deste terminal antes de iniciar o atendimento.');
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
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id
           AND terminal_id = p_terminal_id
           AND operator_id = auth.uid()
           AND status = 'opened'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Caixa do operador nao esta aberto neste terminal.');
    END IF;
    RETURN public.confirm_terminal_meal_payment(
        p_unit_id, p_identifier, p_meal_type_id, p_terminal_id,
        p_idempotency_key, p_payment_method, p_amount_received
    );
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
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts
         WHERE unit_id = p_unit_id
           AND terminal_id = p_terminal_id
           AND operator_id = auth.uid()
           AND status = 'opened'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra o caixa deste terminal antes de registrar visitante.');
    END IF;
    RETURN public.register_terminal_visitor_entry(p_unit_id, p_meal_type_id, p_terminal_id, p_payment_method);
END;
$$;

REVOKE ALL ON FUNCTION public.get_operator_terminal_shift(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_operator_cash_shift(UUID, TEXT, UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_operator_cash_shift(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_operator_cash_movement(UUID, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_operator_terminal_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_operator_terminal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_operator_visitor_entry(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_operator_terminal_shift(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_operator_cash_shift(UUID, TEXT, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_operator_cash_shift(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_operator_cash_movement(UUID, TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_operator_terminal_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_operator_terminal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_operator_visitor_entry(UUID, UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
