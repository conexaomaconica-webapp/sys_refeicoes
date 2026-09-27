-- ==============================================================================
-- Migration: 20260927000004_create_units.sql
-- Descrição: Criação da tabela units com FK composta (institution_id, tenant_id)
--            garantindo integridade de tenant no banco e RLS deny-by-default.
-- ==============================================================================

-- Tabela: units (Restaurantes ou refeitórios operacionais)
CREATE TABLE public.units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    institution_id UUID NOT NULL,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    state VARCHAR(2) NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/Bahia',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_units_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT,
    -- FK composta: Impede estritamente no banco que uma unit aponte para institution de outro tenant
    CONSTRAINT fk_units_institution_tenant FOREIGN KEY (institution_id, tenant_id)
        REFERENCES public.institutions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT chk_units_status CHECK (status IN ('active', 'inactive'))
);

-- Comentários descritivos
COMMENT ON TABLE public.units IS 'Unidades operacionais/restaurantes vinculados obrigatoriamente à instituição e ao mesmo tenant.';

-- Índices recomendados
CREATE INDEX idx_units_tenant_institution ON public.units(tenant_id, institution_id);
CREATE INDEX idx_units_tenant_status ON public.units(tenant_id, status);

-- Trigger de updated_at
CREATE TRIGGER trg_units_updated_at
BEFORE UPDATE ON public.units
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: Ativar isolamento estrito (Deny by default para anon e authenticated na Sprint 1)
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
