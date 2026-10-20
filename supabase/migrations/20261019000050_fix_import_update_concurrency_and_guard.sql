-- Sprint 11: corrige falso conflito temporal e permite que somente a RPC
-- administrativa execute a atualizacao academica protegida pelo trigger.

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
    v_jwt_sub TEXT;
    v_jwt_claims TEXT;
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

                -- Compara instantes, nao representacoes textuais (ISO x PostgreSQL).
                IF (v_row.before_snapshot->>'updated_at') IS NOT NULL
                   AND v_current_student.updated_at IS DISTINCT FROM
                       (v_row.before_snapshot->>'updated_at')::TIMESTAMPTZ THEN
                    RAISE EXCEPTION 'Conflito de concorrencia: aluno alterado apos o preview.';
                END IF;

                v_category_id := COALESCE(
                    NULLIF(v_row.normalized_data->>'category_id', '')::UUID,
                    v_current_student.category_id
                );

                -- A funcao ja validou usuario, tenant e papel. O trigger de students
                -- usa auth.uid() para distinguir escrita direta do cliente. O contexto
                -- e suspenso somente durante este UPDATE e restaurado imediatamente.
                v_jwt_sub := current_setting('request.jwt.claim.sub', true);
                v_jwt_claims := current_setting('request.jwt.claims', true);
                PERFORM set_config('request.jwt.claim.sub', '', true);
                PERFORM set_config('request.jwt.claims', '{}', true);

                UPDATE public.students
                SET full_name = COALESCE(NULLIF(v_row.normalized_data->>'full_name', ''), v_current_student.full_name),
                    course = COALESCE(NULLIF(v_row.normalized_data->>'course', ''), v_current_student.course),
                    email = COALESCE(NULLIF(v_row.normalized_data->>'email', ''), v_current_student.email),
                    phone = COALESCE(NULLIF(v_row.normalized_data->>'phone', ''), v_current_student.phone),
                    category_id = v_category_id,
                    status = COALESCE(NULLIF(v_row.normalized_data->>'academic_status', ''), v_current_student.status)
                WHERE id = v_row.student_id AND tenant_id = v_tenant_id;

                PERFORM set_config('request.jwt.claim.sub', COALESCE(v_jwt_sub, ''), true);
                PERFORM set_config('request.jwt.claims', COALESCE(v_jwt_claims, '{}'), true);

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
                        'status', COALESCE(NULLIF(v_row.normalized_data->>'academic_status', ''), v_current_student.status)
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

REVOKE ALL ON FUNCTION public.confirm_and_process_import(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_and_process_import(UUID) TO authenticated;
