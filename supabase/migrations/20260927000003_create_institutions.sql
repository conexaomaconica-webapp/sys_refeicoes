-- ==============================================================================
-- Migration: 20260927000003_create_institutions.sql
-- Descrição: Criação da tabela institutions com chave única composta (id, tenant_id),
--            índices relacionais e RLS deny-by-default.
-- ==============================================================================

-- Tabela: institutions (Universidades, faculdades ou órgãos atendidos)
CREATE TABLE public.institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT,
    document TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_institutions_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT,
    CONSTRAINT uq_institutions_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT chk_institutions_status CHECK (status IN ('active', 'inactive'))
);

-- Comentários descritivos
COMMENT ON TABLE public.institutions IS 'Instituições de ensino ou órgãos clientes vinculados à empresa de alimentação (tenant).';

-- Índices recomendados
CREATE INDEX idx_institutions_tenant_name ON public.institutions(tenant_id, name);
CREATE INDEX idx_institutions_tenant_status ON public.institutions(tenant_id, status);

-- Trigger de updated_at
CREATE TRIGGER trg_institutions_updated_at
BEFORE UPDATE ON public.institutions
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: Ativar isolamento estrito (Deny by default para anon e authenticated na Sprint 1)
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
