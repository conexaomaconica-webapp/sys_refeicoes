-- ==============================================================================
-- Migration: 20260927000027_create_card_security_and_rpc.sql
-- Descrição: RLS blindado, ausência de mutações diretas no client-side e
--            RPCs seguras com controle de concorrência e autorização estrita.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Habilitação e Imposição de RLS (Deny-by-Default com FORCE RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards FORCE ROW LEVEL SECURITY;

ALTER TABLE public.qr_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_tokens FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. Políticas de Leitura Estritas (Nenhum INSERT/UPDATE/DELETE direto para clientes)
-- ------------------------------------------------------------------------------

-- CARDS: Aluno lê exclusivamente a sua carteirinha ativa vinculada ao seu auth.uid()
CREATE POLICY sel_cards_student ON public.cards
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.id = cards.student_id
              AND s.tenant_id = cards.tenant_id
              AND s.user_id = auth.uid()
              AND s.status = 'active'
        )
    );

-- CARDS: Gestores leem carteirinhas apenas do seu próprio tenant
CREATE POLICY sel_cards_staff ON public.cards
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.tenant_id = cards.tenant_id
              AND p.status = 'active'
              AND p.role IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
        )
    );

-- QR_TOKENS: Aluno autenticado pode visualizar metadados dos seus próprios tokens
CREATE POLICY sel_qr_tokens_student ON public.qr_tokens
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.cards c
            JOIN public.students s ON s.id = c.student_id AND s.tenant_id = c.tenant_id
            WHERE c.id = qr_tokens.card_id
              AND c.tenant_id = qr_tokens.tenant_id
              AND s.user_id = auth.uid()
        )
    );

-- QR_TOKENS: Gestores leem metadados dos tokens do seu próprio tenant
CREATE POLICY sel_qr_tokens_staff ON public.qr_tokens
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.tenant_id = qr_tokens.tenant_id
              AND p.status = 'active'
              AND p.role IN ('admin_general', 'operations_director', 'supervisor')
        )
    );

-- NOTA ARQUITETURAL: Não existem políticas de INSERT, UPDATE ou DELETE para cards ou qr_tokens.
-- Todas as mutações cadastrais e de ciclo de vida são restritas a RPCs auditáveis.

-- ------------------------------------------------------------------------------
-- 3. RPC: admin_issue_card (Emissão Controlada de Carteirinhas)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_issue_card(
    p_student_id UUID,
    p_card_type TEXT DEFAULT 'digital',
    p_physical_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_student RECORD;
    v_card_number TEXT;
    v_code_hash TEXT := NULL;
    v_new_card_id UUID;
BEGIN
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Usuário não autenticado.';
    END IF;

    -- Verificar perfil do operador administrativo
    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED_CALLER: Perfil inativo ou inexistente.';
    END IF;

    IF v_caller.role NOT IN ('admin_general', 'operations_director', 'supervisor') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem autorização para emitir carteirinhas.';
    END IF;

    -- Buscar estudante garantindo isolamento de tenant
    SELECT id, tenant_id, institution_id, registration_number, status INTO v_student
    FROM public.students
    WHERE id = p_student_id AND tenant_id = v_caller.tenant_id;

    IF v_student.id IS NULL THEN
        RAISE EXCEPTION 'STUDENT_NOT_FOUND: Estudante não localizado no tenant do operador.';
    END IF;

    IF v_student.status <> 'active' THEN
        RAISE EXCEPTION 'STUDENT_INACTIVE: Não é permitido emitir carteirinha para aluno inativo.';
    END IF;

    -- Validação do tipo de cartão
    IF p_card_type NOT IN ('digital', 'physical') THEN
        RAISE EXCEPTION 'INVALID_CARD_TYPE: Tipo deve ser digital ou physical.';
    END IF;

    IF p_card_type = 'digital' THEN
        -- Cancelar carteirinha digital ativa anterior do estudante
        UPDATE public.cards
        SET status = 'cancelled', updated_at = now()
        WHERE student_id = v_student.id 
          AND tenant_id = v_caller.tenant_id 
          AND card_type = 'digital' 
          AND status = 'active';

        v_card_number := 'DIG-' || to_char(now(), 'YYMMDD') || '-' || upper(substring(gen_random_uuid()::text, 1, 8));
    ELSE
        -- Cartão físico exige código
        IF p_physical_code IS NULL OR trim(p_physical_code) = '' THEN
            RAISE EXCEPTION 'PHYSICAL_CODE_REQUIRED: Código do cartão físico é obrigatório.';
        END IF;

        v_code_hash := encode(digest(trim(p_physical_code), 'sha256'), 'hex');

        -- Verificar colisão de código físico no tenant
        IF EXISTS (
            SELECT 1 FROM public.cards
            WHERE tenant_id = v_caller.tenant_id
              AND card_type = 'physical'
              AND physical_code_hash = v_code_hash
              AND status = 'active'
        ) THEN
            RAISE EXCEPTION 'PHYSICAL_CODE_ALREADY_IN_USE: Este cartão físico já está atribuído a outro aluno.';
        END IF;

        v_card_number := 'PHY-' || to_char(now(), 'YYMMDD') || '-' || upper(substring(gen_random_uuid()::text, 1, 8));
    END IF;

    -- Inserir carteirinha de forma transacional e auditável
    INSERT INTO public.cards (
        tenant_id,
        student_id,
        card_number,
        card_type,
        physical_code_hash,
        status,
        issued_at
    ) VALUES (
        v_caller.tenant_id,
        v_student.id,
        v_card_number,
        p_card_type,
        v_code_hash,
        'active',
        now()
    ) RETURNING id INTO v_new_card_id;

    RETURN jsonb_build_object(
        'success', true,
        'card_id', v_new_card_id,
        'card_number', v_card_number,
        'card_type', p_card_type,
        'status', 'active'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_issue_card(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_issue_card(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. RPC: admin_update_card_status (Bloqueio, Revogação e Substituição)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_card_status(
    p_card_id UUID,
    p_new_status TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_card RECORD;
BEGIN
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Usuário não autenticado.';
    END IF;

    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED_CALLER: Perfil inativo ou inexistente.';
    END IF;

    IF v_caller.role NOT IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem autorização para alterar status de carteirinhas.';
    END IF;

    IF p_new_status NOT IN ('active', 'blocked', 'cancelled', 'replaced') THEN
        RAISE EXCEPTION 'INVALID_STATUS: Status deve ser active, blocked, cancelled ou replaced.';
    END IF;

    SELECT * INTO v_card
    FROM public.cards
    WHERE id = p_card_id AND tenant_id = v_caller.tenant_id;

    IF v_card.id IS NULL THEN
        RAISE EXCEPTION 'CARD_NOT_FOUND: Carteirinha não localizada no tenant.';
    END IF;

    UPDATE public.cards
    SET status = p_new_status,
        blocked_at = CASE WHEN p_new_status IN ('blocked', 'cancelled', 'replaced') THEN now() ELSE NULL END,
        blocked_reason = p_reason,
        updated_at = now()
    WHERE id = v_card.id;

    -- Se a carteirinha for bloqueada ou cancelada, revogar todos os tokens QR ativos vinculados
    IF p_new_status IN ('blocked', 'cancelled', 'replaced') THEN
        UPDATE public.qr_tokens
        SET status = 'revoked', revoked_at = now()
        WHERE card_id = v_card.id AND status = 'active';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'card_id', v_card.id,
        'new_status', p_new_status,
        'reason', p_reason
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_card_status(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_card_status(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. RPC: generate_student_qr_token (Geração com Lock Concorrente e TTL de Servidor)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_student_qr_token(
    p_card_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_card RECORD;
    v_raw_token TEXT;
    v_token_hash TEXT;
    v_expires_at TIMESTAMPTZ;
    v_token_id UUID;
    v_ttl_seconds CONSTANT INT := 90; -- Limite fixo e imutável pelo servidor
BEGIN
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Usuário não autenticado.';
    END IF;

    -- Localizar a carteirinha digital ativa do estudante com LOCK pessimista FOR UPDATE
    -- Isso elimina qualquer condição de corrida em requisições paralelas simultâneas
    IF p_card_id IS NULL THEN
        SELECT c.* INTO v_card
        FROM public.cards c
        JOIN public.students s ON s.id = c.student_id AND s.tenant_id = c.tenant_id
        WHERE s.user_id = v_caller_uid
          AND c.card_type = 'digital'
          AND c.status = 'active'
          AND s.status = 'active'
        FOR UPDATE OF c;
    ELSE
        SELECT c.* INTO v_card
        FROM public.cards c
        JOIN public.students s ON s.id = c.student_id AND s.tenant_id = c.tenant_id
        WHERE c.id = p_card_id
          AND s.user_id = v_caller_uid
          AND c.card_type = 'digital'
          AND c.status = 'active'
          AND s.status = 'active'
        FOR UPDATE OF c;
    END IF;

    IF v_card.id IS NULL THEN
        RAISE EXCEPTION 'CARD_NOT_FOUND_OR_INACTIVE: Nenhuma carteirinha digital ativa localizada para o usuário.';
    END IF;

    -- 1. Invalidação atômica e imediata de quaisquer tokens ativos prévios da mesma carteirinha
    UPDATE public.qr_tokens
    SET status = 'revoked', revoked_at = now()
    WHERE card_id = v_card.id AND status = 'active';

    -- 2. Geração criptográfica segura de alta entropia (32 bytes = 256 bits pseudo-aleatórios)
    v_raw_token := encode(gen_random_bytes(32), 'hex');
    v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
    v_expires_at := clock_timestamp() + (v_ttl_seconds || ' seconds')::INTERVAL;

    -- 3. Persistência estrita armazenando exclusivamente o HASH
    INSERT INTO public.qr_tokens (
        tenant_id,
        card_id,
        token_hash,
        status,
        issued_at,
        expires_at
    ) VALUES (
        v_card.tenant_id,
        v_card.id,
        v_token_hash,
        'active',
        clock_timestamp(),
        v_expires_at
    ) RETURNING id INTO v_token_id;

    -- 4. Retorno seguro do payload canônico MAR:Q1: para exibição no frontend PWA
    RETURN jsonb_build_object(
        'success', true,
        'token_id', v_token_id,
        'qr_payload', 'MAR:Q1:' || v_raw_token,
        'expires_at', v_expires_at,
        'ttl_seconds', v_ttl_seconds
    );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_student_qr_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_student_qr_token(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. RPC: resolve_student_identity (Identificação Rápida Multimodal no Terminal)
--    NOTA: VOLATILE por default (sem STABLE), compatível com clock_timestamp().
--          Zero débito, zero alteração financeira, sem exposição de saldo.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_student_identity(
    p_unit_id UUID,
    p_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_uid UUID := auth.uid();
    v_caller RECORD;
    v_unit RECORD;
    v_clean_id TEXT;
    v_token_hash TEXT;
    v_student RECORD;
    v_category RECORD;
    v_card RECORD;
    v_token RECORD;
    v_method TEXT;
BEGIN
    -- -------------------------------------------------------------------------
    -- 1. Verificação Estrita de Autenticação e Autorização Operacional
    -- -------------------------------------------------------------------------
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Operador não autenticado.';
    END IF;

    -- Buscar perfil do operador
    SELECT id, tenant_id, role, status INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF v_caller.id IS NULL OR v_caller.status <> 'active' THEN
        RAISE EXCEPTION 'UNAUTHORIZED_CALLER: Perfil inativo ou inexistente.';
    END IF;

    -- Apenas perfis operacionais de restaurante ou gestão podem identificar alunos
    IF v_caller.role NOT IN ('operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem autorização para identificação de alunos.';
    END IF;

    -- Validar escopo de unidade do operador
    IF NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Operador sem permissão de acesso à unidade.';
    END IF;

    -- Buscar unidade garantindo tenant e status
    SELECT id, tenant_id, institution_id, status INTO v_unit
    FROM public.units
    WHERE id = p_unit_id AND tenant_id = v_caller.tenant_id;

    IF v_unit.id IS NULL OR v_unit.status <> 'active' THEN
        RAISE EXCEPTION 'UNIT_UNAVAILABLE: Unidade inativa ou de outro tenant.';
    END IF;

    -- -------------------------------------------------------------------------
    -- 2. Tratamento e Validação do Identificador
    -- -------------------------------------------------------------------------
    v_clean_id := trim(p_identifier);

    IF v_clean_id IS NULL OR v_clean_id = '' THEN
        RAISE EXCEPTION 'INVALID_IDENTIFIER: Identificador não informado.';
    END IF;

    IF v_clean_id LIKE 'MAR:Q1:%' THEN
        -- Modalidade A: QR Code Dinâmico PWA
        v_method := 'qr_dynamic';
        v_token_hash := encode(digest(substring(v_clean_id FROM 8), 'sha256'), 'hex');

        -- Buscar token
        SELECT qt.* INTO v_token
        FROM public.qr_tokens qt
        WHERE qt.token_hash = v_token_hash
          AND qt.tenant_id = v_unit.tenant_id;

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

        -- Buscar carteirinha ativa associada
        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.id = v_token.card_id
          AND c.tenant_id = v_unit.tenant_id
          AND c.status = 'active';

        IF v_card.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'CARD_INACTIVE', 'message', 'Carteirinha digital inativa ou bloqueada.');
        END IF;

        -- Buscar aluno garantindo tenant e instituição da unidade
        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_card.student_id
          AND s.tenant_id = v_unit.tenant_id
          AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:C1:%' THEN
        -- Modalidade B: Cartão Físico Permanente
        v_method := 'physical_card';
        v_token_hash := encode(digest(substring(v_clean_id FROM 8), 'sha256'), 'hex');

        SELECT c.* INTO v_card
        FROM public.cards c
        WHERE c.tenant_id = v_unit.tenant_id
          AND c.card_type = 'physical'
          AND c.physical_code_hash = v_token_hash
          AND c.status = 'active';

        IF v_card.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'PHYSICAL_CARD_NOT_FOUND', 'message', 'Cartão físico não cadastrado ou inativo.');
        END IF;

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.id = v_card.student_id
          AND s.tenant_id = v_unit.tenant_id
          AND s.institution_id = v_unit.institution_id;

    ELSIF v_clean_id LIKE 'MAR:%' THEN
        -- Rejeitar explicitamente envelopes MAR desconhecidos ou malformados
        RETURN jsonb_build_object(
            'success', false, 
            'error_code', 'INVALID_IDENTIFIER_FORMAT', 
            'message', 'Envelope MAR desconhecido ou malformado.'
        );

    ELSE
        -- Modalidade C: Matrícula Acadêmica Tradicional
        v_method := 'registration_number';

        SELECT s.* INTO v_student
        FROM public.students s
        WHERE s.tenant_id = v_unit.tenant_id
          AND s.institution_id = v_unit.institution_id
          AND s.registration_number = v_clean_id;
    END IF;

    -- -------------------------------------------------------------------------
    -- 3. Validação dos Dados do Aluno Localizado
    -- -------------------------------------------------------------------------
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

    -- Buscar categoria do estudante
    SELECT id, name, code, meal_subsidy_type INTO v_category
    FROM public.student_categories
    WHERE id = v_student.category_id AND tenant_id = v_unit.tenant_id;

    -- -------------------------------------------------------------------------
    -- 4. Projeção Minimizada de Dados (Sem exposição de dados financeiros)
    -- -------------------------------------------------------------------------
    RETURN jsonb_build_object(
        'success', true,
        'identification_method', v_method,
        'token_id', CASE WHEN v_method = 'qr_dynamic' THEN v_token.id ELSE NULL END,
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
