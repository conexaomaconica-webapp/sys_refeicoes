-- ==============================================================================
-- Migration: 20261029000077_create_contingency_regularization.sql
-- Descrição: Regularização Retroativa Auditável (Sprint 13)
--            Registro formal e apuração contábil de refeições servidas em contingência
--            (pane física, apagão ou catraca travada) com proibição de comensais fictícios.
-- ==============================================================================

-- 1. TABELA PRINCIPAL DE LOTES DE CONTINGÊNCIA
CREATE TABLE IF NOT EXISTS public.contingency_meal_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
    meal_type_id UUID NOT NULL REFERENCES public.meal_types(id) ON DELETE RESTRICT,
    service_date DATE NOT NULL,
    batch_type TEXT NOT NULL,
    total_meals_served INT NOT NULL,
    category_id UUID REFERENCES public.student_categories(id) ON DELETE RESTRICT,
    unit_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    subsidy_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    total_subsidy_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    justification TEXT NOT NULL,
    evidence_document_url TEXT,
    operator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending_approval',
    rejection_reason TEXT,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_contingency_batch_type CHECK (
        batch_type IN ('type_a_identified', 'type_b_unidentified_count', 'type_c_administrative_adjustment')
    ),
    CONSTRAINT chk_contingency_batch_meals CHECK (total_meals_served > 0),
    CONSTRAINT chk_contingency_batch_status CHECK (
        status IN ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled')
    ),
    CONSTRAINT chk_contingency_batch_amounts CHECK (
        unit_price >= 0 AND subsidy_price >= 0 AND total_amount >= 0 AND total_subsidy_amount >= 0
    )
);

COMMENT ON TABLE public.contingency_meal_batches IS 'Lotes de refeições servidas em regime de contingência ou ajustes retroativos auditáveis.';
COMMENT ON COLUMN public.contingency_meal_batches.batch_type IS 'Tipo A (identificado via folha), Tipo B (contagem física contábil sem aluno fictício), Tipo C (ajuste contábil).';

CREATE INDEX IF NOT EXISTS idx_contingency_batches_tenant_unit ON public.contingency_meal_batches(tenant_id, unit_id, service_date);
CREATE INDEX IF NOT EXISTS idx_contingency_batches_status ON public.contingency_meal_batches(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contingency_batches_date ON public.contingency_meal_batches(tenant_id, service_date);

-- 2. TABELA DE ITENS INDIVIDUALIZADOS (PARA TIPO A - FOLHA FÍSICA ASSINADA)
CREATE TABLE IF NOT EXISTS public.contingency_batch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES public.contingency_meal_batches(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
    registration_number TEXT NOT NULL,
    student_name TEXT NOT NULL,
    category_id UUID NOT NULL REFERENCES public.student_categories(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_contingency_batch_student UNIQUE (batch_id, student_id)
);

COMMENT ON TABLE public.contingency_batch_items IS 'Comensais reais identificados na lista física durante contingência (Tipo A). Proibido cadastrar alunos fictícios.';

CREATE INDEX IF NOT EXISTS idx_contingency_items_batch ON public.contingency_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_contingency_items_student ON public.contingency_batch_items(tenant_id, student_id);

-- 3. BUCKET DE EVIDÊNCIAS DE CONTINGÊNCIA (ATAS, FOTOS E LAUDOS)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'contingency-evidence',
    'contingency-evidence',
    false,
    15728640, -- 15MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- Políticas de Storage para contingency-evidence
DROP POLICY IF EXISTS sel_contingency_evidence_staff ON storage.objects;
CREATE POLICY sel_contingency_evidence_staff ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'contingency-evidence'
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
);

DROP POLICY IF EXISTS ins_contingency_evidence_staff ON storage.objects;
CREATE POLICY ins_contingency_evidence_staff ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'contingency-evidence'
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
);

-- 4. HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.contingency_meal_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contingency_batch_items ENABLE ROW LEVEL SECURITY;

-- Políticas para contingency_meal_batches
DROP POLICY IF EXISTS sel_contingency_batches_staff ON public.contingency_meal_batches;
CREATE POLICY sel_contingency_batches_staff ON public.contingency_meal_batches
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
);

DROP POLICY IF EXISTS ins_contingency_batches_staff ON public.contingency_meal_batches;
CREATE POLICY ins_contingency_batches_staff ON public.contingency_meal_batches
FOR INSERT TO authenticated
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND operator_id = auth.uid()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
);

DROP POLICY IF EXISTS upd_contingency_batches_staff ON public.contingency_meal_batches;
CREATE POLICY upd_contingency_batches_staff ON public.contingency_meal_batches
FOR UPDATE TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND (
        -- Gestor pode alterar rascunho ou pendente
        (operator_id = auth.uid() AND status IN ('draft', 'pending_approval'))
        -- Diretor ou Financeiro pode alterar para aprovar/rejeitar
        OR public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    )
);

-- Políticas para contingency_batch_items
DROP POLICY IF EXISTS sel_contingency_items_staff ON public.contingency_batch_items;
CREATE POLICY sel_contingency_items_staff ON public.contingency_batch_items
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND EXISTS (
        SELECT 1 FROM public.contingency_meal_batches b
        WHERE b.id = batch_id
          AND public.has_unit_access(b.unit_id)
    )
);

DROP POLICY IF EXISTS ins_contingency_items_staff ON public.contingency_batch_items;
CREATE POLICY ins_contingency_items_staff ON public.contingency_batch_items
FOR INSERT TO authenticated
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND EXISTS (
        SELECT 1 FROM public.contingency_meal_batches b
        WHERE b.id = batch_id
          AND b.operator_id = auth.uid()
          AND b.status IN ('draft', 'pending_approval')
          AND public.has_unit_access(b.unit_id)
    )
);

-- 5. RPC SEGURA: SUBMISSÃO DE LOTE DE CONTINGÊNCIA
CREATE OR REPLACE FUNCTION public.submit_contingency_batch(
    p_unit_id UUID,
    p_meal_type_id UUID,
    p_service_date DATE,
    p_batch_type TEXT,
    p_total_meals_served INT,
    p_category_id UUID DEFAULT NULL,
    p_justification TEXT DEFAULT '',
    p_evidence_document_url TEXT DEFAULT NULL,
    p_identified_students JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_operator_id UUID;
    v_operator_role TEXT;
    v_unit RECORD;
    v_meal_type RECORD;
    v_unit_price NUMERIC(10,2) := 0.00;
    v_subsidy_price NUMERIC(10,2) := 0.00;
    v_total_amount NUMERIC(10,2) := 0.00;
    v_total_subsidy NUMERIC(10,2) := 0.00;
    v_batch_id UUID;
    v_item JSONB;
    v_student RECORD;
    v_student_count INT := 0;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();
    v_operator_id := auth.uid();
    v_operator_role := public.get_auth_user_role();

    IF v_tenant_id IS NULL OR v_operator_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Usuário não autenticado.');
    END IF;

    IF v_operator_role NOT IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager') THEN
        RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Papel sem permissão para registrar contingência.');
    END IF;

    IF NOT public.has_unit_access(p_unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN_UNIT', 'message', 'Usuário sem acesso à unidade informada.');
    END IF;

    -- Validar existência da unidade e turno
    SELECT * INTO v_unit FROM public.units WHERE id = p_unit_id AND tenant_id = v_tenant_id AND status = 'active';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNIT_NOT_FOUND', 'message', 'Unidade não encontrada ou inativa.');
    END IF;

    SELECT * INTO v_meal_type FROM public.meal_types WHERE id = p_meal_type_id AND tenant_id = v_tenant_id AND is_active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'MEAL_TYPE_NOT_FOUND', 'message', 'Tipo de refeição não encontrado ou inativo.');
    END IF;

    IF p_service_date > CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false, 'error', 'FUTURE_DATE', 'message', 'Data de serviço não pode ser futura.');
    END IF;

    IF p_total_meals_served <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_COUNT', 'message', 'Total de refeições deve ser maior que zero.');
    END IF;

    IF p_justification IS NULL OR length(trim(p_justification)) < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_JUSTIFICATION', 'message', 'Justificativa detalhada obrigatória (mínimo 10 caracteres).');
    END IF;

    -- Obter regras de preço vigentes
    IF p_category_id IS NOT NULL THEN
        SELECT student_price, subsidy_value INTO v_unit_price, v_subsidy_price
        FROM public.meal_rules
        WHERE tenant_id = v_tenant_id
          AND meal_type_id = p_meal_type_id
          AND category_id = p_category_id
          AND is_active = true
          AND (valid_until IS NULL OR valid_until >= p_service_date)
        ORDER BY created_at DESC
        LIMIT 1;

        v_unit_price := COALESCE(v_unit_price, 0.00);
        v_subsidy_price := COALESCE(v_subsidy_price, 0.00);
    END IF;

    v_total_amount := round(v_unit_price * p_total_meals_served, 2);
    v_total_subsidy := round(v_subsidy_price * p_total_meals_served, 2);

    -- Inserir lote
    INSERT INTO public.contingency_meal_batches (
        tenant_id, unit_id, meal_type_id, service_date, batch_type,
        total_meals_served, category_id, unit_price, subsidy_price,
        total_amount, total_subsidy_amount, justification, evidence_document_url,
        operator_id, status
    ) VALUES (
        v_tenant_id, p_unit_id, p_meal_type_id, p_service_date, p_batch_type,
        p_total_meals_served, p_category_id, v_unit_price, v_subsidy_price,
        v_total_amount, v_total_subsidy, trim(p_justification), p_evidence_document_url,
        v_operator_id, 'pending_approval'
    ) RETURNING id INTO v_batch_id;

    -- Se Tipo A (Identificado via lista física), inserir cada aluno checando duplicidade de turno
    IF p_batch_type = 'type_a_identified' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_identified_students)
        LOOP
            SELECT id, full_name, registration_number, category_id INTO v_student
            FROM public.students
            WHERE tenant_id = v_tenant_id
              AND (id::text = (v_item->>'student_id') OR registration_number = (v_item->>'registration_number'))
              AND status = 'active';

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Aluno informado não encontrado ou inativo: %', COALESCE(v_item->>'registration_number', v_item->>'student_id');
            END IF;

            -- Verificar se o aluno já possui consumo registrado no mesmo dia e refeição
            IF EXISTS (
                SELECT 1 FROM public.meal_consumptions
                WHERE tenant_id = v_tenant_id
                  AND student_id = v_student.id
                  AND consumption_date = p_service_date
                  AND meal_type_id = p_meal_type_id
                  AND status = 'approved'
            ) THEN
                RAISE EXCEPTION 'Aluno % já possui refeição regular aprovada para esta data e turno.', v_student.registration_number;
            END IF;

            INSERT INTO public.contingency_batch_items (
                tenant_id, batch_id, student_id, registration_number,
                student_name, category_id, notes
            ) VALUES (
                v_tenant_id, v_batch_id, v_student.id, v_student.registration_number,
                v_student.full_name, v_student.category_id, v_item->>'notes'
            );

            v_student_count := v_student_count + 1;
        END LOOP;

        -- Atualizar total_meals_served com a contagem real de alunos da lista
        IF v_student_count > 0 THEN
            UPDATE public.contingency_meal_batches
            SET total_meals_served = v_student_count,
                total_amount = round(unit_price * v_student_count, 2),
                total_subsidy_amount = round(subsidy_price * v_student_count, 2)
            WHERE id = v_batch_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'batch_id', v_batch_id,
        'status', 'pending_approval',
        'message', 'Lote de contingência submetido com sucesso para aprovação gerencial.'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'INTERNAL_ERROR', 'message', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_contingency_batch FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_contingency_batch TO authenticated;

-- 6. RPC SEGURA: REVISÃO E DUPLA APROVAÇÃO (GERENTE LANÇA -> DIRETOR / FINANCEIRO APROVA)
CREATE OR REPLACE FUNCTION public.review_contingency_batch(
    p_batch_id UUID,
    p_action TEXT, -- 'approve' ou 'reject'
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_reviewer_id UUID;
    v_reviewer_role TEXT;
    v_batch RECORD;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();
    v_reviewer_id := auth.uid();
    v_reviewer_role := public.get_auth_user_role();

    IF v_tenant_id IS NULL OR v_reviewer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Usuário não autenticado.');
    END IF;

    -- Apenas Administrador Geral, Diretor de Operações e Financeiro podem aprovar/rejeitar lotes de contingência
    IF v_reviewer_role NOT IN ('admin_general', 'operations_director', 'finance') THEN
        RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Apenas Diretores, Financeiro ou Master podem deliberar sobre lotes de contingência.');
    END IF;

    SELECT * INTO v_batch FROM public.contingency_meal_batches
    WHERE id = p_batch_id AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Lote de contingência não localizado.');
    END IF;

    IF v_batch.status != 'pending_approval' THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Apenas lotes pendentes de aprovação podem ser revisados.');
    END IF;

    -- REGRA DE DUPLA APROVAÇÃO: O aprovador não pode ser o mesmo operador que submeteu o lote (exceto Master)
    IF v_batch.operator_id = v_reviewer_id AND v_reviewer_role != 'admin_general' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'SELF_APPROVAL_PROHIBITED',
            'message', 'Violação de segregação de funções: o operador que lançou o lote não pode aprová-lo.'
        );
    END IF;

    IF p_action = 'approve' THEN
        UPDATE public.contingency_meal_batches
        SET status = 'approved',
            approved_by = v_reviewer_id,
            approved_at = now(),
            updated_at = now()
        WHERE id = p_batch_id;

        RETURN jsonb_build_object('success', true, 'status', 'approved', 'message', 'Lote de contingência aprovado com sucesso.');

    ELSIF p_action = 'reject' THEN
        IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
            RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED', 'message', 'Justificativa da rejeição é obrigatória.');
        END IF;

        UPDATE public.contingency_meal_batches
        SET status = 'rejected',
            rejection_reason = trim(p_reason),
            approved_by = v_reviewer_id,
            approved_at = now(),
            updated_at = now()
        WHERE id = p_batch_id;

        RETURN jsonb_build_object('success', true, 'status', 'rejected', 'message', 'Lote de contingência rejeitado.');
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ACTION', 'message', 'Ação inválida. Use approve ou reject.');
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_contingency_batch FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_contingency_batch TO authenticated;
