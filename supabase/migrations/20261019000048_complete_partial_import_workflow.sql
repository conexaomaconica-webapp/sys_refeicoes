-- Sprint 11: importacao parcial tolerante, historico de categoria e totais finais.
-- Migration aditiva: nao remove dados, tabelas, policies ou funcoes existentes.

ALTER TABLE public.imports
    ADD COLUMN effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN processed_rows INT NOT NULL DEFAULT 0,
    ADD COLUMN failed_rows INT NOT NULL DEFAULT 0,
    ADD COLUMN skipped_rows INT NOT NULL DEFAULT 0;

ALTER TABLE public.imports
    ADD CONSTRAINT chk_imports_execution_totals_nonnegative CHECK (
        processed_rows >= 0 AND failed_rows >= 0 AND skipped_rows >= 0
    );

ALTER TABLE public.import_rows
    ADD CONSTRAINT uq_import_rows_id_tenant UNIQUE (id, tenant_id);

CREATE TABLE public.student_category_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL,
    previous_category_id UUID,
    new_category_id UUID NOT NULL,
    import_id UUID,
    import_row_id UUID,
    effective_from DATE NOT NULL,
    reason TEXT NOT NULL DEFAULT 'import',
    changed_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_student_category_history_student
        FOREIGN KEY (student_id, tenant_id)
        REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_student_category_history_previous_category
        FOREIGN KEY (previous_category_id, tenant_id)
        REFERENCES public.student_categories(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_student_category_history_new_category
        FOREIGN KEY (new_category_id, tenant_id)
        REFERENCES public.student_categories(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_student_category_history_import
        FOREIGN KEY (import_id, tenant_id)
        REFERENCES public.imports(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_student_category_history_import_row
        FOREIGN KEY (import_row_id, tenant_id)
        REFERENCES public.import_rows(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_student_category_history_changed_by
        FOREIGN KEY (changed_by, tenant_id)
        REFERENCES public.profiles(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT chk_student_category_history_change CHECK (
        previous_category_id IS NULL OR previous_category_id <> new_category_id
    )
);

CREATE INDEX idx_student_category_history_student
    ON public.student_category_history(tenant_id, student_id, effective_from DESC, created_at DESC);
CREATE INDEX idx_student_category_history_import
    ON public.student_category_history(tenant_id, import_id);

ALTER TABLE public.student_category_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_category_history FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_student_category_history_import_admin
ON public.student_category_history
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director')
);

REVOKE ALL ON TABLE public.student_category_history FROM anon, authenticated;
GRANT SELECT ON TABLE public.student_category_history TO authenticated;

-- Mantem o contrato antigo e acrescenta a data de vigencia em uma RPC versionada.
CREATE OR REPLACE FUNCTION public.stage_import_batch_v2(
    p_institution_id UUID,
    p_import_mode public.import_mode,
    p_original_filename TEXT,
    p_storage_path TEXT,
    p_file_hash TEXT,
    p_file_size_bytes BIGINT,
    p_is_official_snapshot BOOLEAN,
    p_force_reimport BOOLEAN,
    p_rows JSONB,
    p_effective_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import_id UUID;
BEGIN
    IF p_effective_date IS NULL THEN
        RAISE EXCEPTION 'A data de vigencia e obrigatoria.' USING ERRCODE = '22004';
    END IF;

    v_import_id := public.stage_import_batch(
        p_institution_id,
        p_import_mode,
        p_original_filename,
        p_storage_path,
        p_file_hash,
        p_file_size_bytes,
        p_is_official_snapshot,
        p_force_reimport,
        p_rows
    );

    UPDATE public.imports
    SET effective_date = p_effective_date
    WHERE id = v_import_id
      AND tenant_id = public.get_auth_tenant_id();

    RETURN v_import_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stage_import_batch_v2(UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_import_batch_v2(UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.stage_import_batch(UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_import_batch(UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_import(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_import(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_and_process_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_user_id UUID := auth.uid();
    v_user_role TEXT := public.get_auth_user_role();
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
    IF v_tenant_id IS NULL OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou sem tenant.' USING ERRCODE = '42501';
    END IF;
    IF v_user_role NOT IN ('admin_general', 'operations_director') THEN
        RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.imports
    SET status = 'processing', confirmed_at = NOW()
    WHERE id = p_import_id AND tenant_id = v_tenant_id AND status = 'preview'
    RETURNING * INTO v_import;

    IF v_import.id IS NULL THEN
        RAISE EXCEPTION 'Lote nao encontrado ou fora do estado preview.' USING ERRCODE = '55000';
    END IF;

    FOR v_row IN
        SELECT * FROM public.import_rows
        WHERE import_id = p_import_id AND tenant_id = v_tenant_id
        ORDER BY row_number
    LOOP
        BEGIN
            IF v_row.action IN ('ignore', 'error') THEN
                UPDATE public.import_rows SET status = 'skipped' WHERE id = v_row.id;
                v_skipped_count := v_skipped_count + 1;
                CONTINUE;
            END IF;

            IF v_row.action = 'insert' THEN
                v_category_id := (v_row.normalized_data->>'category_id')::UUID;
                INSERT INTO public.students (
                    tenant_id, institution_id, category_id, registration_number,
                    full_name, course, email, phone, status
                ) VALUES (
                    v_tenant_id, v_import.institution_id, v_category_id,
                    v_row.registration_number, v_row.normalized_data->>'full_name',
                    NULLIF(v_row.normalized_data->>'course', ''),
                    NULLIF(v_row.normalized_data->>'email', ''),
                    NULLIF(v_row.normalized_data->>'phone', ''),
                    COALESCE(NULLIF(v_row.normalized_data->>'academic_status', ''), 'active')
                ) RETURNING id INTO v_student_id;

                INSERT INTO public.student_category_history (
                    tenant_id, student_id, previous_category_id, new_category_id,
                    import_id, import_row_id, effective_from, reason, changed_by
                ) VALUES (
                    v_tenant_id, v_student_id, NULL, v_category_id,
                    v_import.id, v_row.id, v_import.effective_date, 'import_insert', v_user_id
                );

                UPDATE public.import_rows
                SET status = 'processed', student_id = v_student_id,
                    after_snapshot = jsonb_build_object(
                        'id', v_student_id, 'registration_number', v_row.registration_number,
                        'full_name', v_row.normalized_data->>'full_name',
                        'category_id', v_category_id,
                        'status', COALESCE(NULLIF(v_row.normalized_data->>'academic_status', ''), 'active')
                    )
                WHERE id = v_row.id;
                v_processed_count := v_processed_count + 1;

            ELSIF v_row.action IN ('update', 'reclassify_partial') THEN
                SELECT * INTO v_current_student
                FROM public.students
                WHERE id = v_row.student_id AND tenant_id = v_tenant_id
                FOR UPDATE;

                IF v_current_student.id IS NULL THEN
                    RAISE EXCEPTION 'Aluno nao encontrado para atualizacao (ID %).', v_row.student_id;
                END IF;
                IF (v_row.before_snapshot->>'updated_at') IS NOT NULL
                   AND v_current_student.updated_at::TEXT <> v_row.before_snapshot->>'updated_at' THEN
                    RAISE EXCEPTION 'Conflito de concorrencia: aluno alterado apos o preview.';
                END IF;

                v_category_id := COALESCE(
                    NULLIF(v_row.normalized_data->>'category_id', '')::UUID,
                    v_current_student.category_id
                );

                UPDATE public.students
                SET full_name = COALESCE(NULLIF(v_row.normalized_data->>'full_name', ''), v_current_student.full_name),
                    course = COALESCE(NULLIF(v_row.normalized_data->>'course', ''), v_current_student.course),
                    email = COALESCE(NULLIF(v_row.normalized_data->>'email', ''), v_current_student.email),
                    phone = COALESCE(NULLIF(v_row.normalized_data->>'phone', ''), v_current_student.phone),
                    category_id = v_category_id,
                    status = COALESCE(NULLIF(v_row.normalized_data->>'academic_status', ''), v_current_student.status)
                WHERE id = v_row.student_id AND tenant_id = v_tenant_id;

                IF v_current_student.category_id <> v_category_id THEN
                    INSERT INTO public.student_category_history (
                        tenant_id, student_id, previous_category_id, new_category_id,
                        import_id, import_row_id, effective_from, reason, changed_by
                    ) VALUES (
                        v_tenant_id, v_row.student_id, v_current_student.category_id, v_category_id,
                        v_import.id, v_row.id, v_import.effective_date,
                        CASE WHEN v_row.action = 'reclassify_partial' THEN 'integral_snapshot' ELSE 'import_update' END,
                        v_user_id
                    );
                END IF;

                UPDATE public.import_rows
                SET status = 'processed',
                    after_snapshot = jsonb_build_object(
                        'id', v_row.student_id, 'registration_number', v_row.registration_number,
                        'full_name', COALESCE(NULLIF(v_row.normalized_data->>'full_name', ''), v_current_student.full_name),
                        'category_id', v_category_id,
                        'status', COALESCE(NULLIF(v_row.normalized_data->>'academic_status', ''), v_current_student.status::TEXT)
                    )
                WHERE id = v_row.id;
                v_processed_count := v_processed_count + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_failed_count := v_failed_count + 1;
            UPDATE public.import_rows
            SET status = 'failed', errors = COALESCE(errors, '[]'::jsonb) || jsonb_build_array(SQLERRM)
            WHERE id = v_row.id;
        END;
    END LOOP;

    v_result_status := CASE
        WHEN v_failed_count > 0 OR v_import.error_rows > 0 THEN 'completed_with_errors'::public.import_status
        ELSE 'completed'::public.import_status
    END;

    UPDATE public.imports
    SET status = v_result_status,
        processed_rows = v_processed_count,
        failed_rows = v_failed_count,
        skipped_rows = v_skipped_count,
        completed_at = NOW()
    WHERE id = p_import_id AND tenant_id = v_tenant_id;

    RETURN jsonb_build_object(
        'import_id', p_import_id, 'status', v_result_status,
        'processed', v_processed_count, 'failed', v_failed_count,
        'skipped', v_skipped_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_and_process_import(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_and_process_import(UUID) TO authenticated;

COMMENT ON TABLE public.student_category_history IS
    'Historico auditavel de categoria do aluno; importacoes nunca alteram saldos ou lancamentos da carteira.';
