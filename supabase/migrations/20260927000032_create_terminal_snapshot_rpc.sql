-- Migration: 20260927000032_create_terminal_snapshot_rpc.sql
-- Descrição: Criação da RPC segura get_terminal_shift_snapshot para carregamento do snapshot
-- do turno no terminal do operador e correção de record unassigned em resolve_student_identity.

-- 1. RPC: get_terminal_shift_snapshot (Superfície projetada segura com minimização LGPD)
CREATE OR REPLACE FUNCTION public.get_terminal_shift_snapshot(p_unit_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_unit RECORD;
    v_result JSONB;
BEGIN
    -- 1. Validar autenticação e perfil
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Operador não autenticado.';
    END IF;

    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED_CALLER: Perfil inativo ou inexistente.';
    END IF;

    IF v_caller.role NOT IN ('operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem autorização para acessar snapshot operacional.';
    END IF;

    -- 2. Validar acesso à unidade
    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Operador sem permissão operacional nesta unidade.';
    END IF;

    SELECT id, tenant_id, institution_id, status INTO v_unit
    FROM public.units
    WHERE id = p_unit_id AND tenant_id = v_caller.tenant_id;

    IF v_unit.id IS NULL OR v_unit.status <> 'active' THEN
        RAISE EXCEPTION 'UNIT_UNAVAILABLE: Unidade inativa ou de outro tenant.';
    END IF;

    -- 3. Obter snapshot minimizado dos estudantes ativos da instituição vinculada a esta unidade
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', s.id,
            'registration_number', s.registration_number,
            'full_name', s.full_name,
            'photo_path', s.photo_path,
            'status', s.status,
            'category_code', sc.code,
            'is_integral', (sc.code = 'integral' OR sc.code = 'bolsista_integral'),
            'estimated_balance', COALESCE(w.balance, 0.00)
        )
    ), '[]'::jsonb) INTO v_result
    FROM public.students s
    JOIN public.student_categories sc ON sc.id = s.category_id AND sc.tenant_id = s.tenant_id
    LEFT JOIN public.wallets w ON w.student_id = s.id AND w.tenant_id = s.tenant_id
    WHERE s.tenant_id = v_unit.tenant_id
      AND s.institution_id = v_unit.institution_id
      AND s.status = 'active';

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_terminal_shift_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_terminal_shift_snapshot(UUID) TO authenticated;

-- 2. Correção de segurança e robustez em resolve_student_identity
CREATE OR REPLACE FUNCTION public.resolve_student_identity(
    p_unit_id UUID,
    p_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_unit RECORD;
    v_clean_id TEXT;
    v_method TEXT;
    v_token_hash TEXT;
    v_token RECORD;
    v_token_id UUID := NULL;
    v_card RECORD;
    v_student RECORD;
    v_category RECORD;
BEGIN
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Operador não autenticado.';
    END IF;

    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED_CALLER: Perfil inativo ou inexistente.';
    END IF;

    IF v_caller.role NOT IN ('operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem autorização para resolver identidade.';
    END IF;

    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Operador sem permissão de acesso à unidade.';
    END IF;

    SELECT id, tenant_id, institution_id, status INTO v_unit
    FROM public.units
    WHERE id = p_unit_id AND tenant_id = v_caller.tenant_id;

    IF v_unit.id IS NULL OR v_unit.status <> 'active' THEN
        RAISE EXCEPTION 'UNIT_UNAVAILABLE: Unidade inativa ou de outro tenant.';
    END IF;

    v_clean_id := trim(p_identifier);
    IF v_clean_id IS NULL OR v_clean_id = '' THEN
        RAISE EXCEPTION 'INVALID_IDENTIFIER: Identificador não informado.';
    END IF;

    IF v_clean_id LIKE 'MAR:Q1:%' THEN
        v_method := 'qr_dynamic';
        v_token_hash := encode(digest(substring(v_clean_id FROM 8), 'sha256'), 'hex');

        SELECT qt.* INTO v_token
        FROM public.qr_tokens qt
        WHERE qt.token_hash = v_token_hash AND qt.tenant_id = v_unit.tenant_id;

        IF v_token.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_NOT_FOUND', 'message', 'QR Code não localizado.');
        END IF;

        IF v_token.status = 'revoked' THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_REVOKED', 'message', 'QR Code foi revogado por uma nova emissão.');
        END IF;

        IF v_token.status = 'used' THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_ALREADY_USED', 'message', 'QR Code de uso único já utilizado.');
        END IF;

        IF v_token.status <> 'active' THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_INACTIVE', 'message', 'Status do QR Code inválido.');
        END IF;

        IF v_token.expires_at <= clock_timestamp() THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'TOKEN_EXPIRED', 'message', 'QR Code expirado.');
        END IF;

        v_token_id := v_token.id;

        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.id = v_token.card_id AND c.tenant_id = v_unit.tenant_id AND c.status = 'active';

        IF v_card.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'CARD_INACTIVE', 'message', 'Carteirinha digital inativa ou bloqueada.');
        END IF;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_card.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:C1:%' THEN
        v_method := 'physical_card';
        v_token_hash := encode(digest(substring(v_clean_id FROM 8), 'sha256'), 'hex');

        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.tenant_id = v_unit.tenant_id AND c.card_type = 'physical' AND c.physical_code_hash = v_token_hash AND c.status = 'active';

        IF v_card.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'PHYSICAL_CARD_NOT_FOUND', 'message', 'Cartão físico não cadastrado ou inativo.');
        END IF;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_card.student_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:%' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNSUPPORTED_PREFIX', 'message', 'Prefixo de cartão não suportado.');

    ELSE
        v_method := 'registration_number';

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.registration_number = v_clean_id AND s.tenant_id = v_unit.tenant_id AND s.institution_id = v_unit.institution_id;
    END IF;

    IF v_student.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'STUDENT_NOT_FOUND', 
            'message', 'Aluno não encontrado para a instituição vinculada a este restaurante.'
        );
    END IF;

    IF v_student.status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'STUDENT_INACTIVE', 
            'message', 'Cadastro do aluno está ' || v_student.status || '.'
        );
    END IF;

    SELECT id, name, code INTO v_category
    FROM public.student_categories
    WHERE id = v_student.category_id AND tenant_id = v_unit.tenant_id;

    RETURN jsonb_build_object(
        'success', true,
        'identification_method', v_method,
        'token_id', v_token_id,
        'student', jsonb_build_object(
            'id', v_student.id,
            'registration_number', v_student.registration_number,
            'full_name', v_student.full_name,
            'course', v_student.course,
            'photo_path', v_student.photo_path,
            'status', v_student.status,
            'category', jsonb_build_object(
                'id', v_category.id,
                'name', v_category.name,
                'code', v_category.code,
                'is_integral', (v_category.code = 'integral')
            )
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_student_identity(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_student_identity(UUID, TEXT) TO authenticated;
