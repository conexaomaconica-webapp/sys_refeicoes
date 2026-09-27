-- ==============================================================================
-- Migration: 20260927000008_create_auth_helper_functions.sql
-- Descrição: Criação das funções auxiliares SECURITY DEFINER para RLS e resolução de contexto.
--            Garante ausência de recursão em profiles e isolamento de permissões.
-- ==============================================================================

-- 1. Obter Tenant ID do Usuário Logado
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT tenant_id FROM public.profiles 
    WHERE id = auth.uid() AND status = 'active'
    LIMIT 1;
$$;

-- 2. Obter Role do Usuário Logado
CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.profiles 
    WHERE id = auth.uid() AND status = 'active'
    LIMIT 1;
$$;

-- 3. Obter Status do Usuário Logado
CREATE OR REPLACE FUNCTION public.get_auth_user_status()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT status FROM public.profiles 
    WHERE id = auth.uid()
    LIMIT 1;
$$;

-- 4. Verificar Escopo de Unidade Operacional
CREATE OR REPLACE FUNCTION public.has_unit_access(p_unit_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.user_role;
    v_tenant_id UUID;
BEGIN
    SELECT role, tenant_id INTO v_role, v_tenant_id
    FROM public.profiles
    WHERE id = auth.uid() AND status = 'active';

    IF v_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Roles com escopo organizacional global no tenant
    IF v_role IN ('admin_general', 'operations_director', 'finance') THEN
        RETURN EXISTS (
            SELECT 1 FROM public.units u 
            WHERE u.id = p_unit_id AND u.tenant_id = v_tenant_id AND u.status = 'active'
        );
    END IF;

    -- Supervisor, Gerente e Operador requerem vínculo explícito em user_unit_access
    RETURN EXISTS (
        SELECT 1 FROM public.user_unit_access uua
        JOIN public.units u ON u.id = uua.unit_id
        WHERE uua.user_id = auth.uid() 
          AND uua.unit_id = p_unit_id 
          AND uua.tenant_id = v_tenant_id
          AND u.status = 'active'
    );
END;
$$;

-- 5. Verificar Escopo de Instituição de Ensino
CREATE OR REPLACE FUNCTION public.has_institution_access(p_institution_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.user_role;
    v_tenant_id UUID;
BEGIN
    SELECT role, tenant_id INTO v_role, v_tenant_id
    FROM public.profiles
    WHERE id = auth.uid() AND status = 'active';

    IF v_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Roles com escopo organizacional global no tenant
    IF v_role IN ('admin_general', 'operations_director', 'finance') THEN
        RETURN EXISTS (
            SELECT 1 FROM public.institutions i 
            WHERE i.id = p_institution_id AND i.tenant_id = v_tenant_id AND i.status = 'active'
        );
    END IF;

    -- institution_user requer vínculo explícito em user_institution_access
    RETURN EXISTS (
        SELECT 1 FROM public.user_institution_access uia
        JOIN public.institutions i ON i.id = uia.institution_id
        WHERE uia.user_id = auth.uid() 
          AND uia.institution_id = p_institution_id 
          AND uia.tenant_id = v_tenant_id
          AND i.status = 'active'
    );
END;
$$;

-- 6. Gestão Estrita de Permissões de Execução (Hardening)
REVOKE ALL ON FUNCTION public.get_auth_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_auth_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_auth_user_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_unit_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_institution_access(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_auth_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_unit_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_institution_access(UUID) TO authenticated;
