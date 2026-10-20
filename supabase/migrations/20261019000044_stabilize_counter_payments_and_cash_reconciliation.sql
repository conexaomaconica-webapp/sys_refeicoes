-- Estabilizacao Pos-Sprint 10: separa pagamento avulso do ledger da carteira,
-- corrige a conciliacao por forma de pagamento e endurece estornos/caixa.
-- Migration aditiva: nenhum lancamento financeiro historico e removido.

ALTER TABLE public.cash_movements
    ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.students(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS consumer_type TEXT CHECK (consumer_type IN ('student', 'visitor')),
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS amount_received NUMERIC(10,2) CHECK (amount_received IS NULL OR amount_received >= 0),
    ADD COLUMN IF NOT EXISTS change_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'refunded', 'voided')),
    ADD COLUMN IF NOT EXISTS origin TEXT,
    ADD COLUMN IF NOT EXISTS reversed_movement_id UUID REFERENCES public.cash_movements(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
    ADD COLUMN IF NOT EXISTS result_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS legacy_wallet_bridge BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cash_movements_type_check;
ALTER TABLE public.cash_movements
    ADD CONSTRAINT cash_movements_type_check
    CHECK (type IN ('initial_float', 'visitor_sale', 'meal_sale', 'refund', 'supply', 'bleed', 'adjustment'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_shift_idempotency
    ON public.cash_movements(cash_shift_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_refund
    ON public.cash_movements(reversed_movement_id)
    WHERE type = 'refund' AND reversed_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_movements_student_created
    ON public.cash_movements(student_id, created_at DESC);

UPDATE public.cash_movements AS movement
SET student_id = consumption.student_id,
    consumer_type = CASE WHEN category.code = 'visitante' THEN 'visitor' ELSE 'student' END,
    origin = CASE WHEN category.code = 'visitante' THEN 'visitor_entry' ELSE 'student_counter_payment' END,
    legacy_wallet_bridge = CASE
        WHEN category.code <> 'visitante' AND consumption.wallet_transaction_id IS NOT NULL THEN true
        ELSE movement.legacy_wallet_bridge
    END
FROM public.meal_consumptions AS consumption
JOIN public.student_categories AS category ON category.id = consumption.category_id
WHERE movement.meal_consumption_id = consumption.id
  AND (movement.student_id IS NULL OR movement.consumer_type IS NULL OR movement.origin IS NULL);

ALTER TABLE public.cash_shifts
    ADD COLUMN IF NOT EXISTS counter_payments_count INTEGER NOT NULL DEFAULT 0 CHECK (counter_payments_count >= 0),
    ADD COLUMN IF NOT EXISTS counter_payments_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (counter_payments_amount >= 0),
    ADD COLUMN IF NOT EXISTS counter_cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (counter_cash_amount >= 0),
    ADD COLUMN IF NOT EXISTS counter_pix_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (counter_pix_amount >= 0),
    ADD COLUMN IF NOT EXISTS counter_card_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (counter_card_amount >= 0),
    ADD COLUMN IF NOT EXISTS counter_other_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (counter_other_amount >= 0),
    ADD COLUMN IF NOT EXISTS counter_refunds_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (counter_refunds_amount >= 0);

WITH totals AS (
    SELECT cash_shift_id,
           count(*) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed')::INTEGER AS payment_count,
           coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed'), 0) AS payment_amount,
           coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed' AND payment_method = 'cash'), 0) AS cash_amount,
           coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed' AND payment_method = 'pix'), 0) AS pix_amount,
           coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed' AND payment_method = 'card'), 0) AS card_amount,
           coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed' AND payment_method = 'other'), 0) AS other_amount,
           coalesce(sum(amount) FILTER (WHERE type = 'refund'), 0) AS refund_amount
    FROM public.cash_movements
    GROUP BY cash_shift_id
)
UPDATE public.cash_shifts AS shift
SET counter_payments_count = totals.payment_count,
    counter_payments_amount = totals.payment_amount,
    counter_cash_amount = totals.cash_amount,
    counter_pix_amount = totals.pix_amount,
    counter_card_amount = totals.card_amount,
    counter_other_amount = totals.other_amount,
    counter_refunds_amount = totals.refund_amount
FROM totals
WHERE totals.cash_shift_id = shift.id;

ALTER TABLE public.cash_shifts
    ADD COLUMN IF NOT EXISTS expected_cash_balance NUMERIC(12,2)
    GENERATED ALWAYS AS (
        initial_float_amount + counter_cash_amount + total_supplies_amount - total_bleed_amount
    ) STORED;

CREATE OR REPLACE FUNCTION public.enrich_cash_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_category_code TEXT;
BEGIN
    IF NEW.meal_consumption_id IS NOT NULL AND (NEW.student_id IS NULL OR NEW.consumer_type IS NULL) THEN
        SELECT consumption.student_id, category.code
          INTO NEW.student_id, v_category_code
          FROM public.meal_consumptions AS consumption
          JOIN public.student_categories AS category ON category.id = consumption.category_id
         WHERE consumption.id = NEW.meal_consumption_id;

        NEW.consumer_type := coalesce(NEW.consumer_type,
            CASE WHEN v_category_code = 'visitante' THEN 'visitor' ELSE 'student' END);
        NEW.origin := coalesce(NEW.origin,
            CASE WHEN v_category_code = 'visitante' THEN 'visitor_entry' ELSE 'student_counter_payment' END);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrich_cash_movement ON public.cash_movements;
CREATE TRIGGER trg_enrich_cash_movement
BEFORE INSERT OR UPDATE ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.enrich_cash_movement();

CREATE OR REPLACE FUNCTION public.refresh_cash_shift_payment_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_shift_id UUID := coalesce(NEW.cash_shift_id, OLD.cash_shift_id);
BEGIN
    UPDATE public.cash_shifts AS shift
       SET counter_payments_count = aggregate.payment_count,
           counter_payments_amount = aggregate.payment_amount,
           counter_cash_amount = aggregate.cash_amount,
           counter_pix_amount = aggregate.pix_amount,
           counter_card_amount = aggregate.card_amount,
           counter_other_amount = aggregate.other_amount,
           counter_refunds_amount = aggregate.refund_amount,
           updated_at = now()
      FROM (
          SELECT count(*) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed')::INTEGER AS payment_count,
                 coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed'), 0) AS payment_amount,
                 coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed' AND payment_method = 'cash'), 0) AS cash_amount,
                 coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed' AND payment_method = 'pix'), 0) AS pix_amount,
                 coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed' AND payment_method = 'card'), 0) AS card_amount,
                 coalesce(sum(amount) FILTER (WHERE type IN ('visitor_sale', 'meal_sale') AND status = 'confirmed' AND payment_method = 'other'), 0) AS other_amount,
                 coalesce(sum(amount) FILTER (WHERE type = 'refund'), 0) AS refund_amount
            FROM public.cash_movements
           WHERE cash_shift_id = v_shift_id
      ) AS aggregate
     WHERE shift.id = v_shift_id;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_cash_shift_payment_totals ON public.cash_movements;
CREATE TRIGGER trg_refresh_cash_shift_payment_totals
AFTER INSERT OR UPDATE OR DELETE ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.refresh_cash_shift_payment_totals();

-- Deriva uma variante interna do motor canonico. Todas as validacoes de
-- identidade, unidade, horario, cota e idempotencia sao preservadas; somente o
-- ramo financeiro ignora a carteira porque o recebimento ocorre no caixa.
DO $$
DECLARE
    v_source TEXT;
    v_counter_source TEXT;
BEGIN
    SELECT pg_get_functiondef('public.consume_meal(uuid,text,uuid,text,text)'::REGPROCEDURE)
      INTO v_source;

    v_counter_source := replace(
        v_source,
        'FUNCTION public.consume_meal(',
        'FUNCTION public.consume_meal_counter_payment('
    );
    v_counter_source := replace(
        v_counter_source,
        'IF v_category.payment_mode = ''on_entry'' OR v_category.code = ''visitante'' THEN',
        'IF true THEN'
    );

    IF v_counter_source = v_source
       OR position('IF true THEN' IN v_counter_source) = 0 THEN
        RAISE EXCEPTION 'Nao foi possivel derivar consume_meal_counter_payment da funcao canonica.';
    END IF;
    EXECUTE v_counter_source;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_meal_counter_payment(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_terminal_meal_payment(
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
    v_profile RECORD;
    v_shift RECORD;
    v_existing RECORD;
    v_preview JSONB;
    v_result JSONB;
    v_price NUMERIC(10,2);
    v_received NUMERIC(10,2);
    v_change NUMERIC(10,2) := 0;
    v_consumption_id UUID;
    v_student_id UUID;
    v_consumer_type TEXT;
    v_movement_id UUID;
BEGIN
    IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'Chave de idempotencia obrigatoria.');
    END IF;
    IF p_payment_method NOT IN ('cash', 'pix', 'card') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PAYMENT_METHOD_NOT_ALLOWED', 'message', 'Forma de pagamento invalida.');
    END IF;

    SELECT id, tenant_id, role, status INTO v_profile
      FROM public.profiles WHERE id = v_operator;
    IF v_profile.id IS NULL OR v_profile.status <> 'active' OR NOT public.has_unit_access(p_unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED_UNIT', 'message', 'Operador sem acesso a unidade selecionada.');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_profile.tenant_id::TEXT || ':' || p_idempotency_key, 0));

    SELECT movement.* INTO v_existing
      FROM public.cash_movements AS movement
      JOIN public.cash_shifts AS shift ON shift.id = movement.cash_shift_id
     WHERE shift.tenant_id = v_profile.tenant_id
       AND movement.idempotency_key = p_idempotency_key
     LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
        RETURN coalesce(v_existing.result_snapshot, '{}'::JSONB) || jsonb_build_object(
            'success', true,
            'idempotent_replay', true,
            'payment', jsonb_build_object(
                'method', v_existing.payment_method,
                'amount_charged', v_existing.amount,
                'amount_received', v_existing.amount_received,
                'change_amount', v_existing.change_amount,
                'cash_shift_id', v_existing.cash_shift_id,
                'cash_movement_id', v_existing.id,
                'source', 'counter'
            )
        );
    END IF;

    SELECT * INTO v_shift
      FROM public.cash_shifts
     WHERE unit_id = p_unit_id
       AND terminal_id = p_terminal_id
       AND operator_id = v_operator
       AND status = 'opened'
     ORDER BY opened_at DESC
     LIMIT 1
     FOR UPDATE;
    IF v_shift.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Caixa do operador nao esta aberto neste terminal.');
    END IF;

    v_preview := public.preview_operator_terminal_meal(p_unit_id, p_identifier, p_meal_type_id);
    IF coalesce((v_preview->>'success')::BOOLEAN, false) = false THEN
        RETURN v_preview;
    END IF;

    v_price := coalesce((v_preview->'financial'->>'student_price')::NUMERIC, 0);
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

    v_result := public.consume_meal_counter_payment(
        p_unit_id, p_identifier, p_meal_type_id, p_idempotency_key, p_terminal_id
    );
    IF coalesce((v_result->>'success')::BOOLEAN, false) = false THEN
        RETURN v_result;
    END IF;

    v_consumption_id := (v_result->>'consumption_id')::UUID;
    v_student_id := (v_result->'student'->>'id')::UUID;
    v_consumer_type := CASE WHEN v_result->'student'->>'category_code' = 'visitante' THEN 'visitor' ELSE 'student' END;

    INSERT INTO public.cash_movements (
        cash_shift_id, type, amount, payment_method, description,
        meal_consumption_id, operator_id, student_id, consumer_type,
        idempotency_key, amount_received, change_amount, status, origin,
        result_snapshot
    ) VALUES (
        v_shift.id, 'meal_sale', v_price, p_payment_method,
        CASE WHEN v_consumer_type = 'visitor' THEN 'Pagamento avulso de visitante' ELSE 'Pagamento avulso de aluno sem uso da carteira' END,
        v_consumption_id, v_operator, v_student_id, v_consumer_type,
        p_idempotency_key, v_received, v_change, 'confirmed',
        CASE WHEN v_consumer_type = 'visitor' THEN 'visitor_entry' ELSE 'student_counter_payment' END,
        v_result
    ) RETURNING id INTO v_movement_id;

    -- Colunas legadas sao mantidas para compatibilidade de relatorios antigos.
    UPDATE public.cash_shifts
       SET total_visitors_count = total_visitors_count + 1,
           total_visitors_amount = total_visitors_amount + v_price,
           updated_at = now()
     WHERE id = v_shift.id;

    v_result := jsonb_set(v_result, '{financial,payment_source}', '"counter"'::JSONB, true);
    RETURN v_result || jsonb_build_object(
        'payment', jsonb_build_object(
            'method', p_payment_method,
            'amount_charged', v_price,
            'amount_received', v_received,
            'change_amount', v_change,
            'cash_shift_id', v_shift.id,
            'cash_movement_id', v_movement_id,
            'source', 'counter'
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_terminal_meal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

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
    v_result JSONB;
BEGIN
    IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN
        RAISE EXCEPTION 'O valor contado deve ser maior ou igual a zero.';
    END IF;
    SELECT role INTO v_role FROM public.profiles WHERE id = v_operator AND status = 'active';
    SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_cash_shift_id FOR UPDATE;
    IF v_shift.id IS NULL OR v_shift.status <> 'opened' THEN
        RAISE EXCEPTION 'Caixa aberto nao encontrado.';
    END IF;
    IF v_operator IS NULL OR NOT public.has_unit_access(v_shift.unit_id) OR NOT (
        v_shift.operator_id = v_operator OR v_role IN ('admin_general', 'operations_director', 'unit_manager')
    ) THEN
        RAISE EXCEPTION 'Perfil sem permissao para fechar este caixa.';
    END IF;

    v_difference := p_counted_amount - v_shift.expected_cash_balance;
    UPDATE public.cash_shifts
       SET status = 'closed', counted_closing_balance = p_counted_amount,
           difference_amount = v_difference, closing_notes = p_closing_notes,
           closed_at = now(), closed_by = v_operator, updated_at = now()
     WHERE id = p_cash_shift_id;
    SELECT to_jsonb(shift) INTO v_result FROM public.cash_shifts AS shift WHERE id = p_cash_shift_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Caixa encerrado com sucesso.',
        'difference_amount', v_difference,
        'difference_status', CASE WHEN v_difference = 0 THEN 'balanced' WHEN v_difference > 0 THEN 'surplus' ELSE 'shortage' END,
        'cash_shift', v_result
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_cash_shift(UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_meal_consumption(
    p_consumption_id UUID,
    p_cancel_type TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller RECORD;
    v_consumption RECORD;
    v_payment RECORD;
    v_wallet RECORD;
    v_refund_tx_id UUID;
    v_refund_movement_id UUID;
BEGIN
    SELECT id, tenant_id, role, status INTO v_caller FROM public.profiles WHERE id = auth.uid();
    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Perfil inativo ou inexistente.');
    END IF;
    IF p_cancel_type NOT IN ('financially_refunded', 'cancelled_unserved') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_CANCEL_TYPE', 'message', 'Tipo de cancelamento invalido.');
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'REASON_REQUIRED', 'message', 'Justificativa auditavel obrigatoria.');
    END IF;

    SELECT * INTO v_consumption
      FROM public.meal_consumptions
     WHERE id = p_consumption_id AND tenant_id = v_caller.tenant_id
     FOR UPDATE;
    IF v_consumption.id IS NULL OR NOT public.has_unit_access(v_consumption.unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CONSUMPTION_NOT_FOUND', 'message', 'Consumo nao localizado no escopo autorizado.');
    END IF;
    IF v_consumption.status <> 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_CANCELLED', 'message', 'Consumo ja cancelado ou estornado.');
    END IF;

    SELECT * INTO v_payment
      FROM public.cash_movements
     WHERE meal_consumption_id = v_consumption.id
       AND type IN ('visitor_sale', 'meal_sale')
       AND status = 'confirmed'
     ORDER BY created_at DESC LIMIT 1
     FOR UPDATE;

    IF v_payment.id IS NOT NULL THEN
        IF v_caller.role NOT IN ('admin_general', 'operations_director', 'finance') THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Estorno de recebimento exige perfil financeiro autorizado.');
        END IF;
        UPDATE public.cash_movements
           SET status = 'refunded', reversed_at = now(), reversed_by = v_caller.id,
               reversal_reason = trim(p_reason)
         WHERE id = v_payment.id;
        INSERT INTO public.cash_movements (
            cash_shift_id, type, amount, payment_method, description,
            meal_consumption_id, operator_id, student_id, consumer_type,
            status, origin, reversed_movement_id
        ) VALUES (
            v_payment.cash_shift_id, 'refund', v_payment.amount, v_payment.payment_method,
            'Estorno de pagamento avulso: ' || trim(p_reason),
            v_consumption.id, v_caller.id, v_consumption.student_id,
            coalesce(v_payment.consumer_type, 'student'), 'confirmed',
            'counter_payment_refund', v_payment.id
        ) RETURNING id INTO v_refund_movement_id;
    ELSIF v_consumption.wallet_transaction_id IS NOT NULL AND v_consumption.student_price > 0 THEN
        IF v_caller.role NOT IN ('admin_general', 'operations_director', 'finance') THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Estorno financeiro exige perfil autorizado.');
        END IF;
        SELECT * INTO v_wallet FROM public.wallets
         WHERE student_id = v_consumption.student_id AND tenant_id = v_caller.tenant_id
         FOR UPDATE;
        IF v_wallet.id IS NULL THEN
            RAISE EXCEPTION 'Carteira do consumo nao localizada para estorno.';
        END IF;
        UPDATE public.wallets SET balance = balance + v_consumption.student_price, updated_at = now() WHERE id = v_wallet.id;
        INSERT INTO public.wallet_transactions (
            tenant_id, wallet_id, student_id, type, amount, balance_before,
            balance_after, reference_type, reference_id, description, created_by
        ) VALUES (
            v_caller.tenant_id, v_wallet.id, v_consumption.student_id, 'refund',
            v_consumption.student_price, v_wallet.balance, v_wallet.balance + v_consumption.student_price,
            'meal_consumption_reversal', v_consumption.id,
            'Estorno de consumo: ' || trim(p_reason), v_caller.id
        ) RETURNING id INTO v_refund_tx_id;
    ELSE
        IF v_caller.role NOT IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager') THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Perfil sem permissao operacional para cancelar o consumo.');
        END IF;
    END IF;

    UPDATE public.meal_consumptions
       SET status = p_cancel_type, reversal_reason = trim(p_reason),
           reversed_at = now(), reversed_by = v_caller.id, updated_at = now()
     WHERE id = v_consumption.id;

    RETURN jsonb_build_object(
        'success', true, 'consumption_id', v_consumption.id,
        'new_status', p_cancel_type,
        'quota_released', p_cancel_type = 'cancelled_unserved',
        'refund_transaction_id', v_refund_tx_id,
        'refund_cash_movement_id', v_refund_movement_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_meal_consumption(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_meal_consumption(UUID, TEXT, TEXT) TO authenticated;

-- Superficies internas/legadas nao podem contornar o vinculo operador-terminal.
REVOKE ALL ON FUNCTION public.open_cash_shift(UUID, VARCHAR, UUID, NUMERIC) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_active_cash_shift(UUID, VARCHAR) FROM authenticated;
REVOKE ALL ON FUNCTION public.record_cash_movement(UUID, VARCHAR, NUMERIC, VARCHAR, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.register_terminal_visitor_entry(UUID, UUID, TEXT, TEXT) FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cash_shifts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cash_movements FROM authenticated;

-- A contingencia offline implementada experimentalmente conflita com a
-- estrategia oficial online-first do MVP. Dados existentes sao preservados,
-- mas novas conciliacoes automaticas e snapshots deixam de ser superficie do cliente.
REVOKE ALL ON FUNCTION public.reconcile_offline_consumptions(JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_terminal_shift_snapshot(UUID) FROM authenticated;

NOTIFY pgrst, 'reload schema';
