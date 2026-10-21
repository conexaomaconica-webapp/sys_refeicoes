-- Baixa parcial auditavel para caixas diarios.
-- Mantem o caixa aberto, registra a conferencia do periodo e permite uma
-- retirada controlada para o cofre. Caixas simultaneos continuam isolados por
-- unit_id + terminal_id.

CREATE TABLE IF NOT EXISTS public.cash_shift_partial_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
    cash_shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
    meal_type_id UUID NOT NULL REFERENCES public.meal_types(id) ON DELETE RESTRICT,
    operator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    period_started_at TIMESTAMPTZ NOT NULL,
    period_ended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumptions_count INTEGER NOT NULL DEFAULT 0 CHECK (consumptions_count >= 0),
    cash_sales_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cash_sales_amount >= 0),
    pix_sales_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (pix_sales_amount >= 0),
    card_sales_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (card_sales_amount >= 0),
    expected_cash_before NUMERIC(12,2) NOT NULL,
    counted_cash_amount NUMERIC(12,2) NOT NULL CHECK (counted_cash_amount >= 0),
    difference_amount NUMERIC(12,2) NOT NULL,
    withdrawal_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (withdrawal_amount >= 0),
    withdrawal_movement_id UUID REFERENCES public.cash_movements(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cash_shift_partial_settlements_period_check
        CHECK (period_ended_at >= period_started_at)
);

CREATE INDEX IF NOT EXISTS idx_cash_partial_settlements_shift_period
    ON public.cash_shift_partial_settlements(cash_shift_id, period_ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_partial_settlements_unit_period
    ON public.cash_shift_partial_settlements(tenant_id, unit_id, period_ended_at DESC);

ALTER TABLE public.cash_shift_partial_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_partial_settlements_select_policy
    ON public.cash_shift_partial_settlements;
CREATE POLICY cash_partial_settlements_select_policy
    ON public.cash_shift_partial_settlements
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.cash_shifts AS cs
             WHERE cs.id = cash_shift_partial_settlements.cash_shift_id
               AND cs.tenant_id = public.get_auth_tenant_id()
               AND public.has_unit_access(cs.unit_id)
        )
    );

REVOKE INSERT, UPDATE, DELETE ON public.cash_shift_partial_settlements FROM authenticated;
GRANT SELECT ON public.cash_shift_partial_settlements TO authenticated;

CREATE OR REPLACE FUNCTION public.record_operator_cash_partial_settlement(
    p_cash_shift_id UUID,
    p_meal_type_id UUID,
    p_counted_cash_amount NUMERIC,
    p_withdrawal_amount NUMERIC DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator UUID := auth.uid();
    v_shift RECORD;
    v_period_started_at TIMESTAMPTZ;
    v_period_ended_at TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_expected_cash NUMERIC(12,2);
    v_difference NUMERIC(12,2);
    v_consumptions_count INTEGER := 0;
    v_cash_sales NUMERIC(12,2) := 0;
    v_pix_sales NUMERIC(12,2) := 0;
    v_card_sales NUMERIC(12,2) := 0;
    v_settlement RECORD;
    v_movement_result JSONB;
    v_withdrawal_movement_id UUID;
    v_updated_shift JSONB;
BEGIN
    IF p_counted_cash_amount IS NULL OR p_counted_cash_amount < 0 THEN
        RAISE EXCEPTION 'O valor contado deve ser maior ou igual a zero.';
    END IF;
    IF p_withdrawal_amount IS NULL OR p_withdrawal_amount < 0 THEN
        RAISE EXCEPTION 'O valor recolhido deve ser maior ou igual a zero.';
    END IF;
    IF p_withdrawal_amount > p_counted_cash_amount THEN
        RAISE EXCEPTION 'O valor recolhido nao pode superar o dinheiro contado na gaveta.';
    END IF;

    SELECT cs.*
      INTO v_shift
      FROM public.cash_shifts AS cs
     WHERE cs.id = p_cash_shift_id
     FOR UPDATE;

    IF v_shift.id IS NULL OR v_shift.status <> 'opened' THEN
        RAISE EXCEPTION 'Caixa aberto nao encontrado.';
    END IF;
    IF v_operator IS NULL OR v_shift.operator_id <> v_operator
       OR NOT public.has_unit_access(v_shift.unit_id) THEN
        RAISE EXCEPTION 'Somente o operador responsavel pode realizar a baixa parcial deste caixa.';
    END IF;
    IF v_shift.cash_shift_mode <> 'daily' THEN
        RAISE EXCEPTION 'A baixa parcial esta disponivel somente para caixas diarios.';
    END IF;
    IF (v_shift.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
       <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE THEN
        RAISE EXCEPTION 'Caixa de data anterior. Realize o fechamento definitivo.';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM public.unit_meal_types AS umt
         WHERE umt.unit_id = v_shift.unit_id
           AND umt.meal_type_id = p_meal_type_id
           AND umt.enabled = true
    ) THEN
        RAISE EXCEPTION 'Tipo de refeicao nao habilitado nesta unidade.';
    END IF;

    v_expected_cash := v_shift.expected_cash_balance;
    IF p_withdrawal_amount > v_expected_cash THEN
        RAISE EXCEPTION 'O recolhimento nao pode superar o saldo esperado na gaveta.';
    END IF;

    SELECT coalesce(pg_catalog.max(cps.period_ended_at), v_shift.opened_at)
      INTO v_period_started_at
      FROM public.cash_shift_partial_settlements AS cps
     WHERE cps.cash_shift_id = v_shift.id;

    SELECT coalesce(pg_catalog.sum(cm.amount) FILTER (WHERE cm.payment_method = 'cash'), 0),
           coalesce(pg_catalog.sum(cm.amount) FILTER (WHERE cm.payment_method = 'pix'), 0),
           coalesce(pg_catalog.sum(cm.amount) FILTER (WHERE cm.payment_method = 'card'), 0)
      INTO v_cash_sales, v_pix_sales, v_card_sales
      FROM public.cash_movements AS cm
      JOIN public.meal_consumptions AS mc ON mc.id = cm.meal_consumption_id
     WHERE cm.cash_shift_id = v_shift.id
       AND mc.meal_type_id = p_meal_type_id
       AND cm.type IN ('visitor_sale', 'meal_sale')
       AND cm.status = 'confirmed'
       AND cm.created_at > v_period_started_at
       AND cm.created_at <= v_period_ended_at;

    SELECT count(*)::INTEGER
      INTO v_consumptions_count
      FROM public.meal_consumptions AS mc
     WHERE mc.unit_id = v_shift.unit_id
       AND mc.meal_type_id = p_meal_type_id
       AND mc.terminal_id = v_shift.terminal_id
       AND mc.operator_id = v_operator
       AND mc.status = 'approved'
       AND mc.consumed_at > v_period_started_at
       AND mc.consumed_at <= v_period_ended_at;

    v_difference := p_counted_cash_amount - v_expected_cash;

    INSERT INTO public.cash_shift_partial_settlements (
        tenant_id, unit_id, cash_shift_id, meal_type_id, operator_id,
        period_started_at, period_ended_at, consumptions_count,
        cash_sales_amount, pix_sales_amount, card_sales_amount,
        expected_cash_before, counted_cash_amount, difference_amount,
        withdrawal_amount, notes
    ) VALUES (
        v_shift.tenant_id, v_shift.unit_id, v_shift.id, p_meal_type_id, v_operator,
        v_period_started_at, v_period_ended_at, v_consumptions_count,
        v_cash_sales, v_pix_sales, v_card_sales,
        v_expected_cash, p_counted_cash_amount, v_difference,
        p_withdrawal_amount, NULLIF(pg_catalog.btrim(p_notes), '')
    ) RETURNING * INTO v_settlement;

    IF p_withdrawal_amount > 0 THEN
        v_movement_result := public.record_cash_movement(
            v_shift.id,
            'bleed'::VARCHAR,
            p_withdrawal_amount,
            'cash'::VARCHAR,
            ('Baixa parcial de caixa - ' || v_settlement.id::TEXT)
        );
        v_withdrawal_movement_id := (v_movement_result->>'movement_id')::UUID;

        UPDATE public.cash_shift_partial_settlements
           SET withdrawal_movement_id = v_withdrawal_movement_id
         WHERE id = v_settlement.id
         RETURNING * INTO v_settlement;
    END IF;

    SELECT pg_catalog.to_jsonb(cs)
      INTO v_updated_shift
      FROM public.cash_shifts AS cs
     WHERE cs.id = v_shift.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'settlement', pg_catalog.to_jsonb(v_settlement),
        'cash_shift', v_updated_shift
    );
END;
$$;

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
    v_settlements JSONB;
    v_stale BOOLEAN;
BEGIN
    IF v_operator IS NULL OR NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Operador sem acesso a unidade selecionada.';
    END IF;

    SELECT cs.* INTO v_shift
      FROM public.cash_shifts AS cs
     WHERE cs.unit_id = p_unit_id
       AND cs.terminal_id = p_terminal_id
       AND cs.status = 'opened'
     ORDER BY cs.opened_at DESC
     LIMIT 1;

    IF v_shift.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'has_active_shift', false,
            'cash_shift', NULL,
            'movements', '[]'::JSONB,
            'partial_settlements', '[]'::JSONB
        );
    END IF;

    IF v_shift.operator_id <> v_operator THEN
        RETURN pg_catalog.jsonb_build_object(
            'has_active_shift', false,
            'terminal_locked', true,
            'message', 'Este terminal possui um caixa aberto por outro operador. Use outro terminal ou encerre o caixa anterior.'
        );
    END IF;

    v_stale := (v_shift.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
        <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE;

    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cm) ORDER BY cm.created_at DESC), '[]'::JSONB)
      INTO v_movements
      FROM public.cash_movements AS cm
     WHERE cm.cash_shift_id = v_shift.id;

    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cps) ORDER BY cps.period_ended_at DESC), '[]'::JSONB)
      INTO v_settlements
      FROM public.cash_shift_partial_settlements AS cps
     WHERE cps.cash_shift_id = v_shift.id;

    RETURN pg_catalog.jsonb_build_object(
        'has_active_shift', true,
        'cash_shift', pg_catalog.to_jsonb(v_shift),
        'movements', v_movements,
        'partial_settlements', v_settlements,
        'stale_shift', v_stale
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_operator_cash_partial_settlement(UUID, UUID, NUMERIC, NUMERIC, TEXT)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_operator_terminal_shift(UUID, TEXT)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_operator_cash_partial_settlement(UUID, UUID, NUMERIC, NUMERIC, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_operator_terminal_shift(UUID, TEXT)
    TO authenticated;

NOTIFY pgrst, 'reload schema';
