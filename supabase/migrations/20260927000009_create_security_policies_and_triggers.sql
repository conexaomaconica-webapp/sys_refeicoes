-- ==============================================================================
-- Migration: 20260927000009_create_security_policies_and_triggers.sql
-- Descrição: 1. Trigger de proteção contra escalada de privilégios (bloqueio via Supabase Client).
--            2. Políticas RLS em profiles, user_unit_access e user_institution_access.
--            3. Políticas RLS atualizadas nas tabelas da Sprint 1 (tenants, tenant_branding, institutions, units).
-- ==============================================================================

-- 1. Trigger de Proteção Imutável para Campos Sensíveis em profiles
CREATE OR REPLACE FUNCTION public.trg_prevent_profile_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Se a atualização ocorre via contexto autenticado por cliente (auth.uid() preenchido)
    IF (auth.uid() IS NOT NULL) THEN
        IF (NEW.role IS DISTINCT FROM OLD.role OR 
            NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR 
            NEW.status IS DISTINCT FROM OLD.status) THEN
            RAISE EXCEPTION 'Ação Não Autorizada: Alterações em role, tenant_id ou status são exclusivas de operações administrativas de servidor.'
            USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_prevent_escalation ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_profile_escalation();


-- ==============================================================================
-- 2. POLÍTICAS RLS EM profiles
-- ==============================================================================

-- SELECT: Próprio perfil OU admin_general do mesmo tenant
CREATE POLICY sel_profiles_owner_or_admin ON public.profiles
FOR SELECT
TO authenticated
USING (
    id = auth.uid() 
    OR (
        tenant_id = public.get_auth_tenant_id() 
        AND public.get_auth_user_role() = 'admin_general'
    )
);

-- UPDATE: Próprio perfil (trigger bloqueia role/tenant/status) OU admin_general do mesmo tenant
CREATE POLICY upd_profiles_owner_or_admin ON public.profiles
FOR UPDATE
TO authenticated
USING (
    (id = auth.uid() AND status = 'active')
    OR (
        tenant_id = public.get_auth_tenant_id() 
        AND public.get_auth_user_role() = 'admin_general'
        AND public.get_auth_user_status() = 'active'
    )
)
WITH CHECK (
    (id = auth.uid() AND status = 'active')
    OR (
        tenant_id = public.get_auth_tenant_id() 
        AND public.get_auth_user_role() = 'admin_general'
        AND public.get_auth_user_status() = 'active'
    )
);


-- ==============================================================================
-- 3. POLÍTICAS RLS EM user_unit_access E user_institution_access
-- ==============================================================================

-- user_unit_access
CREATE POLICY sel_user_unit_access ON public.user_unit_access
FOR SELECT
TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        user_id = auth.uid()
        OR public.get_auth_user_role() = 'admin_general'
    )
);

-- user_institution_access
CREATE POLICY sel_user_institution_access ON public.user_institution_access
FOR SELECT
TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        user_id = auth.uid()
        OR public.get_auth_user_role() = 'admin_general'
    )
);


-- ==============================================================================
-- 4. POLÍTICAS RLS ATUALIZADAS NAS TABELAS DA SPRINT 1
-- ==============================================================================

-- tenants: Leitura permitida apenas do próprio tenant para usuários ativos
CREATE POLICY sel_tenants_authenticated ON public.tenants
FOR SELECT
TO authenticated
USING (
    id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
);

-- tenant_branding: Leitura do branding do próprio tenant para autenticados
CREATE POLICY sel_tenant_branding_authenticated ON public.tenant_branding
FOR SELECT
TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
);

-- institutions: Leitura baseada no escopo institucional (public.has_institution_access)
CREATE POLICY sel_institutions_scoped ON public.institutions
FOR SELECT
TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_institution_access(id)
);

-- units: Leitura baseada no escopo operacional de unidade (public.has_unit_access)
CREATE POLICY sel_units_scoped ON public.units
FOR SELECT
TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(id)
);
