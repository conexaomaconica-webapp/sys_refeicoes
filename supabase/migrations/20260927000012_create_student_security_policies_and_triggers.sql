-- ==============================================================================
-- Migration: 20260927000012_create_student_security_policies_and_triggers.sql
-- Descrição: 1. Trigger de imutabilidade acadêmica para alunos (whitelist restrita a phone e email).
--            2. Políticas RLS de student_categories e minimização estrita de dados em students.
-- ==============================================================================

-- 1. Trigger de Imutabilidade e Whitelist Restrita do Aluno (Apenas phone e email via client)
CREATE OR REPLACE FUNCTION public.trg_prevent_student_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Se a requisição vem de um usuário autenticado via cliente (auth.uid() IS NOT NULL)
    IF (auth.uid() IS NOT NULL) THEN
        -- Bloqueia alteração de qualquer campo fora da whitelist de contato (phone, email)
        IF (NEW.id IS DISTINCT FROM OLD.id OR
            NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
            NEW.institution_id IS DISTINCT FROM OLD.institution_id OR
            NEW.user_id IS DISTINCT FROM OLD.user_id OR
            NEW.category_id IS DISTINCT FROM OLD.category_id OR
            NEW.registration_number IS DISTINCT FROM OLD.registration_number OR
            NEW.full_name IS DISTINCT FROM OLD.full_name OR
            NEW.course IS DISTINCT FROM OLD.course OR
            NEW.photo_path IS DISTINCT FROM OLD.photo_path OR
            NEW.status IS DISTINCT FROM OLD.status OR
            NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
            
            RAISE EXCEPTION 'Ação Não Autorizada: Alunos só podem atualizar diretamente e-mail e telefone de contato.'
            USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_prevent_tampering ON public.students;
CREATE TRIGGER trg_students_prevent_tampering
BEFORE UPDATE ON public.students
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_student_tampering();


-- ==============================================================================
-- 2. POLÍTICAS RLS EM student_categories E students
-- ==============================================================================

ALTER TABLE public.student_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- 1. POLÍTICAS EM student_categories
-- Leitura permitida para qualquer usuário autenticado ativo do seu próprio tenant
CREATE POLICY sel_student_categories ON public.student_categories
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
);

-- 2. POLÍTICAS EM students
-- SELECT Minimizado: Apenas o próprio aluno, admin_general ou operations_director do mesmo tenant.
-- Demais perfis (finance, institution_user, supervisor, unit_manager, operator) recebem superfícies projetadas específicas.
CREATE POLICY sel_students ON public.students
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        user_id = auth.uid()
        OR public.get_auth_user_role() IN ('admin_general', 'operations_director')
    )
);

-- UPDATE: Apenas o próprio aluno na sua própria linha (trigger restringe à whitelist phone/email).
-- Alterações administrativas ocorrem exclusivamente server-side via service_role.
CREATE POLICY upd_students_owner ON public.students
FOR UPDATE TO authenticated
USING (
    user_id = auth.uid()
    AND tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
)
WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
);
