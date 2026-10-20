-- Restaura o contrato versionado do fluxo de visitante.
-- A definicao remota divergente referenciava colunas que nao existem em
-- meal_consumptions. O registro volta a passar pelo motor canonico consume_meal.

CREATE OR REPLACE FUNCTION public.register_visitor_entry(
    p_unit_id UUID,
    p_meal_type_id UUID DEFAULT NULL,
    p_terminal_id VARCHAR(50) DEFAULT 'TERM-01',
    p_payment_method VARCHAR(20) DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller RECORD;
    v_unit RECORD;
    v_visitor_category RECORD;
    v_visitor_student RECORD;
    v_registration TEXT;
    v_idempotency TEXT;
    v_result JSONB;
    v_active_shift_id UUID;
    v_price NUMERIC(10,2);
    v_consumption_id UUID;
BEGIN
    SELECT p.id, p.tenant_id, p.role
      INTO v_caller
      FROM public.profiles AS p
     WHERE p.id = auth.uid();

    IF v_caller.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'AUTH_REQUIRED',
            'message', 'Autenticacao necessaria.'
        );
    END IF;

    IF v_caller.role NOT IN (
        'admin_general', 'operations_director', 'unit_manager', 'supervisor', 'operator'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'PERMISSION_DENIED',
            'message', 'Perfil sem permissao operacional.'
        );
    END IF;

    SELECT u.*
      INTO v_unit
      FROM public.units AS u
     WHERE u.id = p_unit_id
       AND u.tenant_id = v_caller.tenant_id;

    IF v_unit.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'UNIT_NOT_FOUND',
            'message', 'Unidade nao encontrada.'
        );
    END IF;

    SELECT *
      INTO v_visitor_category
      FROM public.student_categories
     WHERE tenant_id = v_caller.tenant_id
       AND code = 'visitante';

    IF v_visitor_category.id IS NULL THEN
        PERFORM public.provision_default_student_categories(v_caller.tenant_id);
        SELECT *
          INTO v_visitor_category
          FROM public.student_categories
         WHERE tenant_id = v_caller.tenant_id
           AND code = 'visitante';
    END IF;

    v_registration := 'VISITANTE_' || upper(substr(p_unit_id::TEXT, 1, 8));

    SELECT *
      INTO v_visitor_student
      FROM public.students
     WHERE institution_id = v_unit.institution_id
       AND registration_number = v_registration;

    IF v_visitor_student.id IS NULL THEN
        INSERT INTO public.students (
            tenant_id,
            institution_id,
            category_id,
            registration_number,
            full_name,
            status
        ) VALUES (
            v_caller.tenant_id,
            v_unit.institution_id,
            v_visitor_category.id,
            v_registration,
            'Visitante Avulso (Entrada)',
            'active'
        )
        RETURNING * INTO v_visitor_student;
    END IF;

    v_idempotency :=
        'VISIT_' || p_unit_id::TEXT || '_' || extract(epoch FROM clock_timestamp())::TEXT;

    v_result := public.consume_meal(
        p_unit_id,
        v_registration,
        p_meal_type_id,
        v_idempotency,
        p_terminal_id
    );

    IF coalesce((v_result->>'success')::BOOLEAN, false) THEN
        SELECT id
          INTO v_active_shift_id
          FROM public.cash_shifts
         WHERE unit_id = p_unit_id
           AND terminal_id = p_terminal_id
           AND operator_id = v_caller.id
           AND status = 'opened'
         LIMIT 1;

        IF v_active_shift_id IS NOT NULL THEN
            v_price := coalesce((v_result->'financial'->>'student_price')::NUMERIC, 0.00);
            v_consumption_id := (v_result->>'consumption_id')::UUID;

            INSERT INTO public.cash_movements (
                cash_shift_id,
                type,
                amount,
                payment_method,
                description,
                meal_consumption_id,
                operator_id,
                student_id,
                consumer_type,
                idempotency_key,
                amount_received,
                change_amount,
                status,
                origin,
                result_snapshot
            ) VALUES (
                v_active_shift_id,
                'visitor_sale',
                v_price,
                p_payment_method,
                'Venda avulsa de refeicao para visitante (Entrada)',
                v_consumption_id,
                v_caller.id,
                v_visitor_student.id,
                'visitor',
                v_idempotency,
                v_price,
                0,
                'confirmed',
                'visitor_entry',
                v_result
            );

            UPDATE public.cash_shifts
               SET total_visitors_count = total_visitors_count + 1,
                   total_visitors_amount = total_visitors_amount + v_price,
                   updated_at = now()
             WHERE id = v_active_shift_id;
        END IF;

        v_result := jsonb_set(
            v_result,
            '{cash_shift_id}',
            to_jsonb(v_active_shift_id),
            true
        );
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.register_visitor_entry(UUID, UUID, VARCHAR, VARCHAR)
    FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.register_visitor_entry(UUID, UUID, VARCHAR, VARCHAR) IS
    'Fluxo interno de visitante; usa consume_meal e registra a receita no caixa do operador.';

NOTIFY pgrst, 'reload schema';
