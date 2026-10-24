-- Gestão de comensais por capacidade e escopo institucional.
-- Master e Diretor Operacional possuem alcance no tenant; Supervisor e Gerente
-- de Unidade dependem de vínculo explícito com instituição ou unidade.

CREATE OR REPLACE FUNCTION public.can_manage_students_at_institution(
    p_institution_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles profile
          JOIN public.institutions institution
            ON institution.id = p_institution_id
           AND institution.tenant_id = profile.tenant_id
         WHERE profile.id = auth.uid()
           AND profile.status = 'active'
           AND (
                profile.role IN ('admin_general', 'operations_director')
                OR (
                    profile.role IN ('supervisor', 'unit_manager')
                    AND (
                        EXISTS (
                            SELECT 1
                              FROM public.user_institution_access institution_access
                             WHERE institution_access.user_id = profile.id
                               AND institution_access.tenant_id = profile.tenant_id
                               AND institution_access.institution_id = p_institution_id
                        )
                        OR EXISTS (
                            SELECT 1
                              FROM public.user_unit_access unit_access
                              JOIN public.units unit
                                ON unit.id = unit_access.unit_id
                               AND unit.tenant_id = unit_access.tenant_id
                             WHERE unit_access.user_id = profile.id
                               AND unit_access.tenant_id = profile.tenant_id
                               AND unit.institution_id = p_institution_id
                        )
                    )
                )
           )
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_students_at_institution(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_students_at_institution(UUID) TO authenticated;

DROP POLICY IF EXISTS sel_students ON public.students;
CREATE POLICY sel_students ON public.students
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        user_id = auth.uid()
        OR public.can_manage_students_at_institution(institution_id)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_user_id
    ON public.students(user_id)
    WHERE user_id IS NOT NULL;

COMMENT ON FUNCTION public.can_manage_students_at_institution(UUID) IS
    'Autoriza gestão de comensais combinando papel, tenant e escopo institucional/unidade.';

COMMENT ON INDEX public.uq_students_user_id IS
    'Garante vínculo individual entre uma conta do Portal do Consumidor e um único comensal.';
