-- ==============================================================================
-- Migration: 20260927000006_create_profiles.sql
-- Descrição: Criação da tabela public.profiles vinculada a auth.users e tenants.
--            Contém a chave composta única (id, tenant_id) para integridade multi-tenant.
--            Importante: Sem coluna institution_id (escopo gerido via user_institution_access).
-- ==============================================================================

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role public.user_role NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_profiles_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT chk_profiles_status CHECK (status IN ('active', 'inactive', 'suspended'))
);

-- Comentários descritivos
COMMENT ON TABLE public.profiles IS 'Identidade, perfil e status dos usuários do sistema por tenant.';

-- Índices relacionais
CREATE INDEX idx_profiles_tenant_role ON public.profiles(tenant_id, role);
CREATE INDEX idx_profiles_status ON public.profiles(status);

-- Trigger de updated_at
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: Ativar isolamento estrito
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
