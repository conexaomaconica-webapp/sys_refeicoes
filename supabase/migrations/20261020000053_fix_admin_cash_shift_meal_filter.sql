-- Corrige o contrato da listagem administrativa de caixas para aceitar o filtro
-- de tipo de refeicao enviado pela interface. Migration aditiva e nao destrutiva.

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
    SELECT profile.tenant_id, profile.role, profile.status
      INTO v_caller
      FROM public.profiles AS profile
     WHERE profile.id = auth.uid();

    IF v_caller.tenant_id IS NULL
       OR v_caller.status <> 'active'
       OR v_caller.role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager') THEN
        RAISE EXCEPTION 'Acesso negado aos relatorios de caixa.';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', shift.id,
                'tenant_id', shift.tenant_id,
                'unit_id', shift.unit_id,
                'unit_name', unit.name,
                'terminal_id', shift.terminal_id,
                'meal_type_id', shift.meal_type_id,
                'meal_type_name', meal_type.name,
                'operator_id', shift.operator_id,
                'operator_name', operator.full_name,
                'status', shift.status,
                'opened_at', shift.opened_at,
                'closed_at', shift.closed_at,
                'closed_by', shift.closed_by,
                'initial_float_amount', shift.initial_float_amount,
                'total_visitors_count', shift.total_visitors_count,
                'total_visitors_amount', shift.total_visitors_amount,
                'total_supplies_amount', shift.total_supplies_amount,
                'total_bleed_amount', shift.total_bleed_amount,
                'system_expected_balance', shift.system_expected_balance,
                'expected_cash_balance', shift.expected_cash_balance,
                'counter_payments_count', shift.counter_payments_count,
                'counter_payments_amount', shift.counter_payments_amount,
                'counter_cash_amount', shift.counter_cash_amount,
                'counter_pix_amount', shift.counter_pix_amount,
                'counter_card_amount', shift.counter_card_amount,
                'counter_other_amount', shift.counter_other_amount,
                'counter_refunds_amount', shift.counter_refunds_amount,
                'counted_closing_balance', shift.counted_closing_balance,
                'difference_amount', shift.difference_amount,
                'closing_notes', shift.closing_notes
            )
            ORDER BY shift.opened_at DESC
        ),
        '[]'::jsonb
    )
      INTO v_result
      FROM public.cash_shifts AS shift
      JOIN public.units AS unit ON unit.id = shift.unit_id
      LEFT JOIN public.meal_types AS meal_type ON meal_type.id = shift.meal_type_id
      JOIN public.profiles AS operator ON operator.id = shift.operator_id
     WHERE shift.tenant_id = v_caller.tenant_id
       AND public.has_unit_access(shift.unit_id)
       AND (p_unit_id IS NULL OR shift.unit_id = p_unit_id)
       AND (p_meal_type_id IS NULL OR shift.meal_type_id = p_meal_type_id)
       AND (p_status IS NULL OR shift.status = p_status)
       AND (p_start_date IS NULL OR shift.opened_at::DATE >= p_start_date)
       AND (p_end_date IS NULL OR shift.opened_at::DATE <= p_end_date);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_cash_shifts(UUID, UUID, VARCHAR, DATE, DATE)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_cash_shifts(UUID, UUID, VARCHAR, DATE, DATE)
TO authenticated;

NOTIFY pgrst, 'reload schema';
