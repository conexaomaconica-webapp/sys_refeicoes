-- ==============================================================================
-- Migration: 20260927000017_create_import_security_policies.sql
-- Descrição: Políticas de segurança RLS (Read-only para browser) e funções SQL
--            server-side para staging, processamento e cancelamento de importações.
-- ==============================================================================

-- 1. Ativação e Forçamento de RLS
ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imports FORCE ROW LEVEL SECURITY;

ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows FORCE ROW LEVEL SECURITY;

-- 2. Policy de SELECT para public.imports (Read-only no browser para admin_general e operations_director)
CREATE POLICY sel_imports_admin ON public.imports
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director')
);

-- 3. Policy de SELECT para public.import_rows (Read-only no browser para admin_general e operations_director)
CREATE POLICY sel_import_rows_admin ON public.import_rows
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director')
);

-- NENHUMA policy FOR ALL, INSERT, UPDATE ou DELETE é criada para o papel 'authenticated'.
-- Toda gravação e alteração em imports e import_rows ocorre 100% via SECURITY DEFINER.

-- 4. Função Server-Side: stage_import_batch()
-- Função para salvar o lote de importação e o manifesto de linhas durante o preview.
CREATE OR REPLACE FUNCTION public.stage_import_batch(
    p_institution_id UUID,
    p_import_mode public.import_mode,
    p_original_filename TEXT,
    p_storage_path TEXT,
    p_file_hash TEXT,
    p_file_size_bytes BIGINT,
    p_is_official_snapshot BOOLEAN,
    p_force_reimport BOOLEAN,
    p_rows JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
    v_user_role TEXT;
    v_import_id UUID;
    v_row JSONB;
    v_existing_id UUID;
    v_total INT := 0;
    v_valid INT := 0;
    v_inserts INT := 0;
    v_updates INT := 0;
    v_reclassifies INT := 0;
    v_ignores INT := 0;
    v_errors INT := 0;
    v_action public.import_row_action;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();
    v_user_id := auth.uid();
    v_user_role := public.get_auth_user_role();

    IF v_tenant_id IS NULL OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado ou sem tenant.' USING ERRCODE = '42501';
    END IF;

    IF v_user_role NOT IN ('admin_general', 'operations_director') THEN
        RAISE EXCEPTION 'Acesso negado: apenas diretores e administradores podem importar planilhas.' USING ERRCODE = '42501';
    END IF;

    -- Validação da consistência de import_mode e is_official_snapshot
    IF p_import_mode = 'general' AND p_is_official_snapshot = TRUE THEN
        RAISE EXCEPTION 'Importação geral não pode ser marcada como oficial snapshot de integrais.' USING ERRCODE = '22023';
    END IF;

    -- Verificação de Idempotência por Hash SHA-256 (se não for forçado reimport)
    IF NOT p_force_reimport THEN
        SELECT id INTO v_existing_id
        FROM public.imports
        WHERE tenant_id = v_tenant_id
          AND institution_id = p_institution_id
          AND file_hash = p_file_hash
          AND import_mode = p_import_mode
          AND status IN ('preview', 'processing', 'completed', 'completed_with_errors')
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            RAISE EXCEPTION 'Arquivo duplicado: Este mesmo arquivo já foi importado (Lote #%).' , v_existing_id USING ERRCODE = '23505';
        END IF;
    END IF;

    -- Criar registro em public.imports
    INSERT INTO public.imports (
        tenant_id,
        institution_id,
        import_mode,
        created_by,
        original_filename,
        storage_path,
        file_hash,
        file_size_bytes,
        status,
        is_official_snapshot
    ) VALUES (
        v_tenant_id,
        p_institution_id,
        p_import_mode,
        v_user_id,
        p_original_filename,
        p_storage_path,
        p_file_hash,
        p_file_size_bytes,
        'preview',
        p_is_official_snapshot
    )
    RETURNING id INTO v_import_id;

    -- Iterar sobre as linhas do manifesto enviado pelo preview server-side
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        v_total := v_total + 1;
        v_action := (v_row->>'action')::public.import_row_action;

        IF v_action = 'insert' THEN
            v_inserts := v_inserts + 1;
            v_valid := v_valid + 1;
        ELSIF v_action = 'update' THEN
            v_updates := v_updates + 1;
            v_valid := v_valid + 1;
        ELSIF v_action = 'reclassify_partial' THEN
            v_reclassifies := v_reclassifies + 1;
            v_valid := v_valid + 1;
        ELSIF v_action = 'ignore' THEN
            v_ignores := v_ignores + 1;
        ELSIF v_action = 'error' THEN
            v_errors := v_errors + 1;
        END IF;

        INSERT INTO public.import_rows (
            import_id,
            tenant_id,
            row_number,
            registration_number,
            raw_data,
            normalized_data,
            action,
            status,
            errors,
            warnings,
            student_id,
            before_snapshot,
            after_snapshot
        ) VALUES (
            v_import_id,
            v_tenant_id,
            (v_row->>'row_number')::INT,
            v_row->>'registration_number',
            COALESCE(v_row->'raw_data', '{}'::jsonb),
            v_row->'normalized_data',
            v_action,
            'pending',
            COALESCE(v_row->'errors', '[]'::jsonb),
            COALESCE(v_row->'warnings', '[]'::jsonb),
            CASE WHEN (v_row->>'student_id') IS NOT NULL AND (v_row->>'student_id') != '' THEN (v_row->>'student_id')::UUID ELSE NULL END,
            v_row->'before_snapshot',
            v_row->'after_snapshot'
        );
    END LOOP;

    -- Atualizar totais no cabeçalho
    UPDATE public.imports
    SET total_rows = v_total,
        valid_rows = v_valid,
        insert_rows = v_inserts,
        update_rows = v_updates,
        reclassify_rows = v_reclassifies,
        ignored_rows = v_ignores,
        error_rows = v_errors
    WHERE id = v_import_id;

    RETURN v_import_id;
END;
$$;

-- 5. Função Server-Side: confirm_and_process_import()
-- Executa a gravação dos dados no banco de dados com base estrita no manifesto persistido em import_rows.
CREATE OR REPLACE FUNCTION public.confirm_and_process_import(
    p_import_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_role TEXT;
    v_import public.imports%ROWTYPE;
    v_row public.import_rows%ROWTYPE;
    v_student_id UUID;
    v_category_id UUID;
    v_current_student public.students%ROWTYPE;
    v_processed_count INT := 0;
    v_failed_count INT := 0;
    v_skipped_count INT := 0;
    v_result_status public.import_status;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();
    v_user_role := public.get_auth_user_role();

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado ou sem tenant.' USING ERRCODE = '42501';
    END IF;

    IF v_user_role NOT IN ('admin_general', 'operations_director') THEN
        RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
    END IF;

    -- Transição Atômica de Status (Lock de Concorrência)
    UPDATE public.imports
    SET status = 'processing', confirmed_at = NOW()
    WHERE id = p_import_id 
      AND tenant_id = v_tenant_id 
      AND status = 'preview'
    RETURNING * INTO v_import;

    IF v_import.id IS NULL THEN
        RAISE EXCEPTION 'Lote de importação não encontrado ou não está em estado de preview.' USING ERRCODE = '55000';
    END IF;

    -- Loop de processamento linha por linha
    FOR v_row IN 
        SELECT * FROM public.import_rows 
        WHERE import_id = p_import_id AND tenant_id = v_tenant_id 
        ORDER BY row_number ASC
    LOOP
        BEGIN
            IF v_row.action = 'ignore' OR v_row.action = 'error' THEN
                UPDATE public.import_rows 
                SET status = 'skipped' 
                WHERE id = v_row.id;
                v_skipped_count := v_skipped_count + 1;
                CONTINUE;
            END IF;

            -- 1. Ação INSERT
            IF v_row.action = 'insert' THEN
                v_category_id := (v_row.normalized_data->>'category_id')::UUID;
                
                INSERT INTO public.students (
                    tenant_id,
                    institution_id,
                    category_id,
                    registration_number,
                    full_name,
                    course,
                    email,
                    phone,
                    status
                ) VALUES (
                    v_tenant_id,
                    v_import.institution_id,
                    v_category_id,
                    v_row.registration_number,
                    v_row.normalized_data->>'full_name',
                    v_row.normalized_data->>'course',
                    v_row.normalized_data->>'email',
                    v_row.normalized_data->>'phone',
                    COALESCE(v_row.normalized_data->>'academic_status', 'active')
                )
                RETURNING id INTO v_student_id;

                UPDATE public.import_rows
                SET status = 'processed',
                    student_id = v_student_id,
                    after_snapshot = jsonb_build_object(
                        'id', v_student_id,
                        'registration_number', v_row.registration_number,
                        'full_name', v_row.normalized_data->>'full_name',
                        'category_id', v_category_id,
                        'status', COALESCE(v_row.normalized_data->>'academic_status', 'active')
                    )
                WHERE id = v_row.id;

                v_processed_count := v_processed_count + 1;

            -- 2. Ação UPDATE ou RECLASSIFY_PARTIAL
            ELSIF v_row.action IN ('update', 'reclassify_partial') THEN
                -- Verificação de Concorrência contra o before_snapshot
                SELECT * INTO v_current_student
                FROM public.students
                WHERE id = v_row.student_id AND tenant_id = v_tenant_id;

                IF v_current_student.id IS NULL THEN
                    RAISE EXCEPTION 'Aluno não encontrado para atualização (ID %).', v_row.student_id;
                END IF;

                -- Checar se houve alteração concorrente por outro usuário durante o preview
                IF (v_row.before_snapshot->>'updated_at') IS NOT NULL AND 
                   v_current_student.updated_at::text != (v_row.before_snapshot->>'updated_at') THEN
                    RAISE EXCEPTION 'Conflito de concorrência: O aluno foi alterado por outro usuário durante a janela de preview.';
                END IF;

                v_category_id := COALESCE((v_row.normalized_data->>'category_id')::UUID, v_current_student.category_id);

                UPDATE public.students
                SET full_name = COALESCE(v_row.normalized_data->>'full_name', v_current_student.full_name),
                    course = COALESCE(v_row.normalized_data->>'course', v_current_student.course),
                    email = COALESCE(v_row.normalized_data->>'email', v_current_student.email),
                    phone = COALESCE(v_row.normalized_data->>'phone', v_current_student.phone),
                    category_id = v_category_id,
                    status = COALESCE(v_row.normalized_data->>'academic_status', v_current_student.status)
                WHERE id = v_row.student_id AND tenant_id = v_tenant_id;

                UPDATE public.import_rows
                SET status = 'processed',
                    after_snapshot = jsonb_build_object(
                        'id', v_row.student_id,
                        'registration_number', v_row.registration_number,
                        'full_name', COALESCE(v_row.normalized_data->>'full_name', v_current_student.full_name),
                        'category_id', v_category_id,
                        'status', COALESCE(v_row.normalized_data->>'academic_status', v_current_student.status)
                    )
                WHERE id = v_row.id;

                v_processed_count := v_processed_count + 1;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            v_failed_count := v_failed_count + 1;
            UPDATE public.import_rows
            SET status = 'failed',
                errors = errors || jsonb_build_array(SQLERRM)
            WHERE id = v_row.id;
        END;
    END LOOP;

    -- Determinar o status final da importação
    IF v_failed_count > 0 THEN
        v_result_status := 'completed_with_errors';
    ELSE
        v_result_status := 'completed';
    END IF;

    UPDATE public.imports
    SET status = v_result_status,
        completed_at = NOW()
    WHERE id = p_import_id AND tenant_id = v_tenant_id;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'status', v_result_status,
        'processed', v_processed_count,
        'failed', v_failed_count,
        'skipped', v_skipped_count
    );
END;
$$;

-- 6. Função Server-Side: cancel_import()
CREATE OR REPLACE FUNCTION public.cancel_import(
    p_import_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_role TEXT;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();
    v_user_role := public.get_auth_user_role();

    IF v_tenant_id IS NULL OR v_user_role NOT IN ('admin_general', 'operations_director') THEN
        RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.imports
    SET status = 'cancelled'
    WHERE id = p_import_id AND tenant_id = v_tenant_id AND status = 'preview';

    RETURN FOUND;
END;
$$;
