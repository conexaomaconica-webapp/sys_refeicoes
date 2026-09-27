-- ==============================================================================
-- Migration: 20260927000007_create_access_scopes.sql
-- Descrição: 1. Adiciona a constraint uq_units_id_tenant em units para suportar FK composta.
--            2. Criação das tabelas de escopo user_unit_access e user_institution_access
--               com validação de tenant cruzado via Foreign Keys Compostas.
-- ==============================================================================

-- 1. Adicionar constraint única em units (necessária para FK composta de user_unit_access)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_units_id_tenant' AND conrelid = 'public.units'::regclass
    ) THEN
        ALTER TABLE public.units ADD CONSTRAINT uq_units_id_tenant UNIQUE (id, tenant_id);
    END IF;
END $$;

-- 2. Tabela: user_unit_access (Escopo de Unidade Operacional)
CREATE TABLE public.user_unit_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    unit_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_unit_access UNIQUE (user_id, unit_id),
    -- Proteção Matemática Multi-Tenant por FK Composta
    CONSTRAINT fk_user_unit_access_user_tenant 
        FOREIGN KEY (user_id, tenant_id) REFERENCES public.profiles(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_user_unit_access_unit_tenant 
        FOREIGN KEY (unit_id, tenant_id) REFERENCES public.units(id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.user_unit_access IS 'Atribuição explícita de escopo de unidade operacional por usuário e tenant.';
CREATE INDEX idx_user_unit_access_lookup ON public.user_unit_access(tenant_id, user_id, unit_id);

-- 3. Tabela: user_institution_access (Escopo de Instituição de Ensino)
CREATE TABLE public.user_institution_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    institution_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_institution_access UNIQUE (user_id, institution_id),
    -- Proteção Matemática Multi-Tenant por FK Composta
    CONSTRAINT fk_user_inst_access_user_tenant 
        FOREIGN KEY (user_id, tenant_id) REFERENCES public.profiles(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_user_inst_access_inst_tenant 
        FOREIGN KEY (institution_id, tenant_id) REFERENCES public.institutions(id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.user_institution_access IS 'Atribuição explícita de escopo institucional por usuário e tenant.';
CREATE INDEX idx_user_inst_access_lookup ON public.user_institution_access(tenant_id, user_id, institution_id);

-- Activar RLS
ALTER TABLE public.user_unit_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_institution_access ENABLE ROW LEVEL SECURITY;
