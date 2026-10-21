-- Pre-visualizacao do valor de visitante e registro correto de dinheiro/troco.
-- Migration estritamente aditiva: preserva as RPCs anteriores para compatibilidade.

CREATE OR REPLACE FUNCTION public.get_operator_visitor_price(
    p_unit_id UUID,
    p_meal_type_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller RECORD;
    v_price NUMERIC(12,2);
BEGIN
    SELECT p.id, p.tenant_id, p.role, p.status
      INTO v_caller
      FROM public.profiles AS p
     WHERE p.id = auth.uid();

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'price', 0, 'message', 'Operador nao autenticado ou inativo.');
    END IF;

    IF v_caller.role NOT IN ('admin_general', 'operations_director', 'unit_manager', 'supervisor', 'operator') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'price', 0, 'message', 'Perfil sem permissao operacional.');
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.units AS u
         WHERE u.id = p_unit_id
           AND u.tenant_id = v_caller.tenant_id
           AND u.status = 'active'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'price', 0, 'message', 'Unidade ativa nao encontrada.');
    END IF;

    SELECT mr.student_price
      INTO v_price
      FROM public.meal_rules AS mr
      JOIN public.student_categories AS sc
        ON sc.id = mr.category_id
       AND sc.tenant_id = mr.tenant_id
     WHERE mr.tenant_id = v_caller.tenant_id
       AND mr.unit_id = p_unit_id
       AND mr.meal_type_id = p_meal_type_id
       AND sc.code = 'visitante'
       AND mr.enabled = true
       AND mr.effective_from <= pg_catalog.now()
       AND (mr.effective_to IS NULL OR mr.effective_to > pg_catalog.now())
     ORDER BY mr.effective_from DESC
     LIMIT 1;

    IF v_price IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'price', 0, 'message', 'Preco de visitante nao configurado para esta refeicao.');
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true, 'price', v_price);
END;
$$;

REVOKE ALL ON FUNCTION public.get_operator_visitor_price(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_visitor_price(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_operator_visitor_entry_v2(
    p_unit_id UUID,
    p_meal_type_id UUID,
    p_terminal_id TEXT DEFAULT 'TERM-01',
    p_payment_method TEXT DEFAULT 'cash',
    p_amount_received NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_preview JSONB;
    v_result JSONB;
    v_price NUMERIC(12,2);
    v_received NUMERIC(12,2);
    v_change NUMERIC(12,2);
    v_consumption_id UUID;
BEGIN
    IF p_payment_method NOT IN ('cash', 'pix', 'card') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'INVALID_PAYMENT_METHOD', 'message', 'Forma de pagamento invalida.');
    END IF;

    v_preview := public.get_operator_visitor_price(p_unit_id, p_meal_type_id);
    IF NOT coalesce((v_preview->>'success')::BOOLEAN, false) THEN
        RETURN v_preview;
    END IF;

    v_price := (v_preview->>'price')::NUMERIC;
    v_received := CASE
        WHEN p_payment_method = 'cash' THEN coalesce(p_amount_received, v_price)
        ELSE v_price
    END;

    IF v_received < v_price THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INSUFFICIENT_AMOUNT_RECEIVED',
            'message', 'O valor recebido deve ser igual ou maior que o valor da refeicao.'
        );
    END IF;

    v_change := CASE WHEN p_payment_method = 'cash' THEN v_received - v_price ELSE 0 END;

    v_result := public.register_operator_visitor_entry(
        p_unit_id,
        p_meal_type_id,
        p_terminal_id,
        p_payment_method
    );

    IF coalesce((v_result->>'success')::BOOLEAN, false) THEN
        v_consumption_id := (v_result->>'consumption_id')::UUID;

        UPDATE public.cash_movements
           SET amount_received = v_received,
               change_amount = v_change
         WHERE meal_consumption_id = v_consumption_id
           AND type = 'visitor_sale'
           AND status = 'confirmed';

        v_result := pg_catalog.jsonb_set(v_result, '{financial,amount_received}', pg_catalog.to_jsonb(v_received), true);
        v_result := pg_catalog.jsonb_set(v_result, '{financial,change_amount}', pg_catalog.to_jsonb(v_change), true);
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.register_operator_visitor_entry_v2(UUID, UUID, TEXT, TEXT, NUMERIC)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_operator_visitor_entry_v2(UUID, UUID, TEXT, TEXT, NUMERIC)
    TO authenticated;

COMMENT ON FUNCTION public.register_operator_visitor_entry_v2(UUID, UUID, TEXT, TEXT, NUMERIC) IS
    'Registra visitante com valor recebido e troco auditaveis, preservando o fluxo transacional canonico.';

NOTIFY pgrst, 'reload schema';
