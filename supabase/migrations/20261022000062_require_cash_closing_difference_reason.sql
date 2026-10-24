-- Migration aditiva: exige justificativa auditavel para sobra ou falta no
-- fechamento de caixa. Mantem RLS e o contrato existente da RPC.

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
    v_operator UUID := auth.uid();
    v_role public.user_role;
    v_shift RECORD;
    v_difference NUMERIC(12,2);
    v_closing_notes TEXT := NULLIF(btrim(p_closing_notes), '');
    v_result JSONB;
BEGIN
    IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN
        RAISE EXCEPTION 'O valor contado deve ser maior ou igual a zero.';
    END IF;

    SELECT role
      INTO v_role
      FROM public.profiles
     WHERE id = v_operator
       AND status = 'active';

    SELECT *
      INTO v_shift
      FROM public.cash_shifts
     WHERE id = p_cash_shift_id
     FOR UPDATE;

    IF v_shift.id IS NULL OR v_shift.status <> 'opened' THEN
        RAISE EXCEPTION 'Caixa aberto nao encontrado.';
    END IF;

    IF v_operator IS NULL OR NOT public.has_unit_access(v_shift.unit_id) OR NOT (
        v_shift.operator_id = v_operator OR v_role IN ('admin_general', 'operations_director', 'unit_manager')
    ) THEN
        RAISE EXCEPTION 'Perfil sem permissao para fechar este caixa.';
    END IF;

    v_difference := p_counted_amount - v_shift.expected_cash_balance;

    IF v_difference <> 0 AND v_closing_notes IS NULL THEN
        RAISE EXCEPTION 'Informe o motivo da diferenca de caixa antes de confirmar o fechamento.';
    END IF;

    UPDATE public.cash_shifts
       SET status = 'closed',
           counted_closing_balance = p_counted_amount,
           difference_amount = v_difference,
           closing_notes = v_closing_notes,
           closed_at = now(),
           closed_by = v_operator,
           updated_at = now()
     WHERE id = p_cash_shift_id;

    SELECT to_jsonb(shift)
      INTO v_result
      FROM public.cash_shifts AS shift
     WHERE id = p_cash_shift_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Caixa encerrado com sucesso.',
        'difference_amount', v_difference,
        'difference_status', CASE
            WHEN v_difference = 0 THEN 'balanced'
            WHEN v_difference > 0 THEN 'surplus'
            ELSE 'shortage'
        END,
        'cash_shift', v_result
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_cash_shift(UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.close_cash_shift(UUID, NUMERIC, TEXT) IS
'Fecha um caixa autorizado e exige motivo auditavel quando o valor contado diverge do esperado.';
