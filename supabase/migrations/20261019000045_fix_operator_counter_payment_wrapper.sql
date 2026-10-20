-- Estabilizacao Pos-Sprint 10: remove a ponte tecnica de carteira ainda
-- presente na wrapper usada pelo Terminal/PDV.
--
-- A confirmacao explicita de pagamento no balcao deve sempre delegar para
-- confirm_terminal_meal_payment, implementada pela migration 44, que registra
-- a receita diretamente em cash_movements sem criar recarga ou debito na
-- carteira financeira do aluno.

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
DECLARE
    v_operator UUID := auth.uid();
BEGIN
    IF v_operator IS NULL OR NOT public.has_unit_access(p_unit_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'ACCESS_DENIED_UNIT',
            'message', 'Operador sem acesso a unidade selecionada.'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.cash_shifts
         WHERE unit_id = p_unit_id
           AND terminal_id = p_terminal_id
           AND operator_id = v_operator
           AND status = 'opened'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'CASH_SHIFT_REQUIRED',
            'message', 'Caixa do operador nao esta aberto neste terminal.'
        );
    END IF;

    RETURN public.confirm_terminal_meal_payment(
        p_unit_id,
        p_identifier,
        p_meal_type_id,
        p_terminal_id,
        p_idempotency_key,
        p_payment_method,
        p_amount_received
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_operator_terminal_payment(
    UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.confirm_operator_terminal_payment(
    UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC
) TO authenticated;

COMMENT ON FUNCTION public.confirm_operator_terminal_payment(
    UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC
) IS 'Confirma pagamento avulso no caixa sem criar credito ou debito na carteira do aluno.';

NOTIFY pgrst, 'reload schema';
