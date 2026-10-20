-- Corrige o ledger de carteira e completa o fluxo de pagamento no caixa.
-- Migration aditiva: preserva dados e substitui somente funcoes RPC.

DO $$
DECLARE
    v_signature REGPROCEDURE := 'public.consume_meal(uuid,text,uuid,text,text)'::REGPROCEDURE;
    v_definition TEXT;
    v_corrected TEXT;
BEGIN
    SELECT pg_get_functiondef(v_signature) INTO v_definition;
    v_corrected := replace(v_definition, '''debit''', '''meal_debit''');
    v_corrected := regexp_replace(
        v_corrected,
        'v_student_price,([[:space:]]+)v_wallet\.balance,([[:space:]]+)v_balance_remaining,',
        E'-v_student_price,\\1v_wallet.balance,\\2v_balance_remaining,'
    );

    IF v_corrected = v_definition THEN
        IF position('''meal_debit''' IN v_definition) = 0
           OR position('-v_student_price' IN v_definition) = 0 THEN
            RAISE EXCEPTION 'Trecho do debito de carteira nao encontrado em consume_meal.';
        END IF;
    ELSE
        EXECUTE v_corrected;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_operator_terminal_meal(
    p_unit_id UUID,
    p_identifier TEXT,
    p_meal_type_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_preview JSONB;
    v_student_id UUID;
    v_balance NUMERIC(12,2) := 0;
    v_wallet_status TEXT;
    v_price NUMERIC(10,2) := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_unit_access(p_unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED_UNIT', 'message', 'Operador sem acesso a unidade selecionada.');
    END IF;

    v_preview := public.preview_terminal_meal(p_unit_id, p_identifier, p_meal_type_id);
    IF coalesce((v_preview->>'success')::boolean, false) = false
       OR coalesce(v_preview->>'payment_mode', 'wallet') <> 'wallet' THEN
        RETURN v_preview;
    END IF;

    v_student_id := (v_preview->'student'->>'id')::UUID;
    v_price := coalesce((v_preview->'financial'->>'student_price')::NUMERIC, 0);

    SELECT balance, status INTO v_balance, v_wallet_status
      FROM public.wallets
     WHERE student_id = v_student_id;

    v_balance := coalesce(v_balance, 0);
    v_preview := jsonb_set(v_preview, '{financial,current_balance}', to_jsonb(v_balance), true);
    v_preview := jsonb_set(v_preview, '{financial,balance_remaining}', to_jsonb(greatest(v_balance - v_price, 0)), true);
    v_preview := v_preview || jsonb_build_object(
        'wallet_status', coalesce(v_wallet_status, 'missing'),
        'requires_counter_payment', v_price > 0 AND (v_wallet_status IS NULL OR v_balance < v_price)
    );
    RETURN v_preview;
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
DECLARE
    v_operator UUID := auth.uid();
    v_shift_id UUID;
    v_preview JSONB;
    v_result JSONB;
    v_payment_mode TEXT;
    v_student_id UUID;
    v_tenant_id UUID;
    v_wallet RECORD;
    v_price NUMERIC(10,2);
    v_received NUMERIC(10,2);
    v_change NUMERIC(10,2) := 0;
    v_credit_transaction_id UUID;
BEGIN
    IF p_payment_method NOT IN ('cash', 'pix', 'card') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PAYMENT_METHOD_NOT_ALLOWED', 'message', 'Forma de pagamento invalida.');
    END IF;

    SELECT id INTO v_shift_id
      FROM public.cash_shifts
     WHERE unit_id = p_unit_id
       AND terminal_id = p_terminal_id
       AND operator_id = v_operator
       AND status = 'opened'
     ORDER BY opened_at DESC
     LIMIT 1
     FOR UPDATE;

    IF v_shift_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Caixa do operador nao esta aberto neste terminal.');
    END IF;

    v_preview := public.preview_operator_terminal_meal(p_unit_id, p_identifier, p_meal_type_id);
    IF coalesce((v_preview->>'success')::boolean, false) = false THEN
        RETURN v_preview;
    END IF;

    v_price := coalesce((v_preview->'financial'->>'student_price')::NUMERIC, 0);
    v_payment_mode := coalesce(v_preview->>'payment_mode', 'wallet');
    IF v_price <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PAYMENT_NOT_REQUIRED', 'message', 'Esta refeicao nao exige pagamento.');
    END IF;

    IF p_payment_method = 'cash' THEN
        v_received := p_amount_received;
        IF v_received IS NULL OR v_received < v_price THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'INSUFFICIENT_RECEIVED_AMOUNT', 'message', 'Valor recebido menor que o valor cobrado.');
        END IF;
        v_change := v_received - v_price;
    ELSE
        v_received := v_price;
    END IF;

    IF v_payment_mode = 'on_entry' THEN
        RETURN public.confirm_terminal_meal_payment(
            p_unit_id, p_identifier, p_meal_type_id, p_terminal_id,
            p_idempotency_key, p_payment_method, v_received
        );
    END IF;

    v_student_id := (v_preview->'student'->>'id')::UUID;
    SELECT tenant_id INTO v_tenant_id FROM public.units WHERE id = p_unit_id;

    INSERT INTO public.wallets (tenant_id, student_id, balance, status)
    VALUES (v_tenant_id, v_student_id, 0, 'active')
    ON CONFLICT (student_id) DO NOTHING;

    SELECT * INTO v_wallet
      FROM public.wallets
     WHERE student_id = v_student_id
     FOR UPDATE;

    IF v_wallet.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'WALLET_INACTIVE', 'message', 'Carteira inativa. Regularize o cadastro antes de receber o pagamento.');
    END IF;

    -- Se houve recarga concorrente, consome o saldo sem registrar uma segunda cobranca.
    IF v_wallet.balance >= v_price THEN
        RETURN public.consume_meal(p_unit_id, p_identifier, p_meal_type_id, p_idempotency_key, p_terminal_id);
    END IF;

    -- A recarga tecnica e o debito da refeicao acontecem na mesma transacao.
    -- Assim, o saldo anterior do aluno e preservado e o recebimento fica auditavel.
    BEGIN
        UPDATE public.wallets
           SET balance = balance + v_price,
               updated_at = now()
         WHERE id = v_wallet.id;

        INSERT INTO public.wallet_transactions (
            tenant_id, wallet_id, student_id, type, amount,
            balance_before, balance_after, reference_type, reference_id,
            description, created_by
        ) VALUES (
            v_tenant_id, v_wallet.id, v_student_id, 'recharge', v_price,
            v_wallet.balance, v_wallet.balance + v_price,
            'terminal_counter_payment', v_shift_id,
            'Pagamento avulso de refeicao recebido no terminal', v_operator
        ) RETURNING id INTO v_credit_transaction_id;

        v_result := public.consume_meal(p_unit_id, p_identifier, p_meal_type_id, p_idempotency_key, p_terminal_id);
        IF coalesce((v_result->>'success')::boolean, false) = false THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_result::TEXT;
        END IF;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        RETURN v_result;
    END;

    INSERT INTO public.cash_movements (
        cash_shift_id, type, amount, payment_method, description,
        meal_consumption_id, operator_id
    ) VALUES (
        v_shift_id, 'visitor_sale', v_price, p_payment_method,
        'Recebimento de refeicao no balcao', (v_result->>'consumption_id')::UUID, v_operator
    );

    UPDATE public.cash_shifts
       SET total_visitors_amount = total_visitors_amount + v_price,
           updated_at = now()
     WHERE id = v_shift_id;

    RETURN v_result || jsonb_build_object(
        'payment', jsonb_build_object(
            'method', p_payment_method,
            'amount_charged', v_price,
            'amount_received', v_received,
            'change_amount', v_change,
            'cash_shift_id', v_shift_id,
            'wallet_credit_transaction_id', v_credit_transaction_id
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_operator_terminal_meal(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_operator_terminal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_operator_terminal_meal(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_operator_terminal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
