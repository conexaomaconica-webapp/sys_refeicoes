-- =============================================================================
-- Terminal MA Refeicoes: identidade visual configuravel e pagamento presencial
-- Migration estritamente aditiva. Mantem RLS e valida autorizacao nas RPCs.
-- =============================================================================

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS terminal_theme TEXT NOT NULL DEFAULT 'light',
    ADD COLUMN IF NOT EXISTS terminal_primary_color TEXT NOT NULL DEFAULT '#C5161D',
    ADD COLUMN IF NOT EXISTS terminal_accent_color TEXT NOT NULL DEFAULT '#F4C430',
    ADD COLUMN IF NOT EXISTS terminal_surface_color TEXT NOT NULL DEFAULT '#F3F4F6',
    ADD COLUMN IF NOT EXISTS terminal_show_kpi_values BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_tenant_branding_terminal_theme'
          AND conrelid = 'public.tenant_branding'::regclass
    ) THEN
        ALTER TABLE public.tenant_branding
            ADD CONSTRAINT chk_tenant_branding_terminal_theme
            CHECK (terminal_theme IN ('light', 'dark'));
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_public_tenant_branding_v2(p_slug TEXT)
RETURNS TABLE (
    tenant_id UUID,
    slug TEXT,
    app_name TEXT,
    logo_url TEXT,
    splash_background TEXT,
    splash_animation_type TEXT,
    splash_duration_ms INTEGER,
    primary_color TEXT,
    secondary_color TEXT,
    terminal_theme TEXT,
    terminal_primary_color TEXT,
    terminal_accent_color TEXT,
    terminal_surface_color TEXT,
    terminal_show_kpi_values BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        t.id,
        t.slug,
        tb.app_name,
        tb.logo_url,
        tb.splash_background,
        tb.splash_animation_type,
        tb.splash_duration_ms,
        tb.primary_color,
        tb.secondary_color,
        tb.terminal_theme,
        tb.terminal_primary_color,
        tb.terminal_accent_color,
        tb.terminal_surface_color,
        tb.terminal_show_kpi_values
    FROM public.tenants t
    JOIN public.tenant_branding tb ON tb.tenant_id = t.id
    WHERE lower(t.slug) = lower(p_slug)
      AND t.status = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_branding_v2(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_branding_v2(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_branding_settings(
    p_app_name TEXT,
    p_logo_url TEXT,
    p_primary_color TEXT,
    p_secondary_color TEXT,
    p_terminal_theme TEXT,
    p_terminal_primary_color TEXT,
    p_terminal_accent_color TEXT,
    p_terminal_surface_color TEXT,
    p_terminal_show_kpi_values BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile RECORD;
    v_branding public.tenant_branding%ROWTYPE;
BEGIN
    SELECT id, tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = auth.uid();

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou inativo.';
    END IF;

    IF v_profile.role <> 'admin_general' THEN
        RAISE EXCEPTION 'Somente o administrador geral pode alterar a identidade visual.';
    END IF;

    IF p_terminal_theme NOT IN ('light', 'dark') THEN
        RAISE EXCEPTION 'Tema de terminal invalido.';
    END IF;

    IF p_app_name IS NULL OR length(trim(p_app_name)) < 2 THEN
        RAISE EXCEPTION 'Nome da aplicacao invalido.';
    END IF;

    IF p_primary_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_secondary_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_terminal_primary_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_terminal_accent_color !~ '^#[0-9A-Fa-f]{6}$'
       OR p_terminal_surface_color !~ '^#[0-9A-Fa-f]{6}$' THEN
        RAISE EXCEPTION 'As cores devem estar no formato hexadecimal #RRGGBB.';
    END IF;

    UPDATE public.tenant_branding
       SET app_name = trim(p_app_name),
           logo_url = NULLIF(trim(p_logo_url), ''),
           primary_color = upper(p_primary_color),
           secondary_color = upper(p_secondary_color),
           terminal_theme = p_terminal_theme,
           terminal_primary_color = upper(p_terminal_primary_color),
           terminal_accent_color = upper(p_terminal_accent_color),
           terminal_surface_color = upper(p_terminal_surface_color),
           terminal_show_kpi_values = p_terminal_show_kpi_values,
           updated_at = now()
     WHERE tenant_id = v_profile.tenant_id
     RETURNING * INTO v_branding;

    IF v_branding.id IS NULL THEN
        RAISE EXCEPTION 'Identidade visual do tenant nao encontrada.';
    END IF;

    RETURN to_jsonb(v_branding);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_branding_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_branding_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- Consulta sem efeito colateral usada antes de abrir a etapa de pagamento.
CREATE OR REPLACE FUNCTION public.preview_terminal_meal(
    p_unit_id UUID,
    p_identifier TEXT,
    p_meal_type_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller RECORD;
    v_unit RECORD;
    v_student RECORD;
    v_category RECORD;
    v_card RECORD;
    v_token RECORD;
    v_unit_meal RECORD;
    v_rule RECORD;
    v_clean_id TEXT;
    v_hash TEXT;
    v_full_price NUMERIC(10,2);
    v_student_price NUMERIC(10,2);
BEGIN
    SELECT id, tenant_id, role, status INTO v_caller
      FROM public.profiles WHERE id = auth.uid();

    IF v_caller.id IS NULL OR v_caller.status <> 'active'
       OR v_caller.role NOT IN ('admin_general', 'operations_director', 'unit_manager', 'supervisor', 'operator') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'Perfil sem permissao operacional.');
    END IF;

    SELECT * INTO v_unit FROM public.units
     WHERE id = p_unit_id AND tenant_id = v_caller.tenant_id AND status = 'active';
    IF v_unit.id IS NULL OR NOT public.has_unit_access(p_unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED_UNIT', 'message', 'Unidade indisponivel para este operador.');
    END IF;

    v_clean_id := trim(p_identifier);
    IF coalesce(v_clean_id, '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_IDENTIFIER', 'message', 'Identificacao nao informada.');
    END IF;

    IF v_clean_id LIKE 'MAR:T:%' THEN
        v_hash := encode(digest(v_clean_id, 'sha256'), 'hex');
        SELECT * INTO v_token FROM public.qr_tokens
         WHERE tenant_id = v_unit.tenant_id AND token_hash = v_hash;
        IF v_token.id IS NULL OR v_token.status <> 'active' OR v_token.expires_at < now() THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_NOT_FOUND', 'message', 'QR code invalido ou expirado.');
        END IF;
        SELECT * INTO v_student FROM public.students
         WHERE id = v_token.student_id AND tenant_id = v_unit.tenant_id AND institution_id = v_unit.institution_id;
    ELSIF v_clean_id ~ '^[0-9A-Fa-f]{8,32}$' AND length(v_clean_id) IN (8, 14, 16, 20, 24, 32) THEN
        SELECT * INTO v_card FROM public.cards
         WHERE tenant_id = v_unit.tenant_id AND card_serial = upper(v_clean_id) AND status = 'active';
        IF v_card.id IS NOT NULL THEN
            SELECT * INTO v_student FROM public.students
             WHERE id = v_card.student_id AND tenant_id = v_unit.tenant_id AND institution_id = v_unit.institution_id;
        ELSE
            SELECT * INTO v_student FROM public.students
             WHERE registration_number = v_clean_id AND tenant_id = v_unit.tenant_id AND institution_id = v_unit.institution_id;
        END IF;
    ELSE
        SELECT * INTO v_student FROM public.students
         WHERE registration_number = v_clean_id AND tenant_id = v_unit.tenant_id AND institution_id = v_unit.institution_id;
    END IF;

    IF v_student.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'STUDENT_NOT_FOUND', 'message', 'Identificacao nao encontrada nesta instituicao.');
    END IF;
    IF v_student.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'STUDENT_INACTIVE', 'message', 'Cadastro inativo ou bloqueado.');
    END IF;

    SELECT * INTO v_category FROM public.student_categories
     WHERE id = v_student.category_id AND tenant_id = v_unit.tenant_id;

    SELECT * INTO v_unit_meal FROM public.unit_meal_types
     WHERE unit_id = p_unit_id AND enabled = true
       AND (p_meal_type_id IS NULL OR meal_type_id = p_meal_type_id)
     ORDER BY CASE WHEN meal_type_id = p_meal_type_id THEN 0 ELSE 1 END
     LIMIT 1;
    IF v_unit_meal.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'MEAL_NOT_ENABLED_FOR_UNIT', 'message', 'Refeicao nao habilitada na unidade.');
    END IF;

    SELECT * INTO v_rule FROM public.meal_rules
     WHERE unit_id = p_unit_id
       AND meal_type_id = v_unit_meal.meal_type_id
       AND category_id = v_category.id
       AND enabled = true
       AND effective_from <= now()
       AND (effective_to IS NULL OR effective_to > now())
     ORDER BY effective_from DESC LIMIT 1;

    v_full_price := coalesce(v_rule.full_price, 15.00);
    IF v_category.pricing_type = 'percentage' THEN
        v_student_price := round(v_full_price * (coalesce(v_category.charge_percentage, 100) / 100.00), 2);
    ELSE
        v_student_price := least(coalesce(v_category.fixed_price, v_full_price), v_full_price);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'student', jsonb_build_object(
            'id', v_student.id,
            'full_name', v_student.full_name,
            'registration_number', v_student.registration_number,
            'category_code', v_category.code,
            'is_integral', (v_category.code = 'integral' OR v_student_price = 0),
            'photo_path', v_student.photo_path
        ),
        'financial', jsonb_build_object(
            'full_price', v_full_price,
            'student_price', v_student_price,
            'subsidy_amount', v_full_price - v_student_price
        ),
        'payment_mode', v_category.payment_mode
    );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_terminal_meal(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_terminal_meal(UUID, TEXT, UUID) TO authenticated;

-- Confirma consumo e recebimento na mesma transacao PostgreSQL.
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
    v_preview JSONB;
    v_result JSONB;
    v_shift_id UUID;
    v_consumption_id UUID;
    v_price NUMERIC(10,2);
    v_change NUMERIC(10,2) := 0;
    v_payment_mode TEXT;
    v_operator UUID := auth.uid();
BEGIN
    IF p_payment_method NOT IN ('cash', 'pix', 'card') THEN
        RAISE EXCEPTION 'Forma de pagamento invalida.';
    END IF;

    v_preview := public.preview_terminal_meal(p_unit_id, p_identifier, p_meal_type_id);
    IF coalesce((v_preview->>'success')::boolean, false) = false THEN
        RETURN v_preview;
    END IF;

    v_price := coalesce((v_preview->'financial'->>'student_price')::numeric, 0);
    v_payment_mode := coalesce(v_preview->>'payment_mode', 'wallet');

    IF v_price <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PAYMENT_NOT_REQUIRED', 'message', 'Esta refeicao nao exige pagamento.');
    END IF;

    IF v_payment_mode <> 'on_entry' AND p_payment_method <> 'card' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'PAYMENT_METHOD_NOT_ALLOWED', 'message', 'Esta categoria utiliza saldo do cartao.');
    END IF;

    IF v_payment_mode = 'on_entry' THEN
        SELECT id INTO v_shift_id FROM public.cash_shifts
         WHERE unit_id = p_unit_id AND terminal_id = p_terminal_id AND status = 'opened'
         ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;
        IF v_shift_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra o caixa antes de receber pagamentos.');
        END IF;
        IF p_payment_method = 'cash' THEN
            IF p_amount_received IS NULL OR p_amount_received < v_price THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'INSUFFICIENT_RECEIVED_AMOUNT', 'message', 'Valor recebido menor que o valor cobrado.');
            END IF;
            v_change := p_amount_received - v_price;
        END IF;
    END IF;

    v_result := public.consume_meal(p_unit_id, p_identifier, p_meal_type_id, p_idempotency_key, p_terminal_id);
    IF coalesce((v_result->>'success')::boolean, false) = false THEN
        RETURN v_result;
    END IF;

    IF v_payment_mode = 'on_entry' AND coalesce(v_result->>'idempotent_replay', 'false') <> 'true' THEN
        v_consumption_id := (v_result->>'consumption_id')::uuid;
        INSERT INTO public.cash_movements (
            cash_shift_id, type, amount, payment_method, description,
            meal_consumption_id, operator_id
        ) VALUES (
            v_shift_id, 'visitor_sale', v_price, p_payment_method,
            'Recebimento de refeicao no terminal', v_consumption_id, v_operator
        );

        UPDATE public.cash_shifts
           SET total_visitors_count = total_visitors_count + 1,
               total_visitors_amount = total_visitors_amount + v_price,
               updated_at = now()
         WHERE id = v_shift_id;
    END IF;

    RETURN v_result || jsonb_build_object(
        'payment', jsonb_build_object(
            'method', p_payment_method,
            'amount_charged', v_price,
            'amount_received', CASE WHEN p_payment_method = 'cash' THEN p_amount_received ELSE v_price END,
            'change_amount', v_change,
            'cash_shift_id', v_shift_id
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_terminal_meal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_terminal_meal_payment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;
