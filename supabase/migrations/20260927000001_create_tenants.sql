-- ==============================================================================
-- Migration: 20260927000001_create_tenants.sql
-- Descrição: Criação da tabela de tenants, extensões, trigger de updated_at,
--            índice único case-insensitive e RLS deny-by-default.
-- ==============================================================================

-- Extensão para geração de UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Função trigger genérica para atualizar updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tabela: tenants (Empresas de alimentação clientes do SaaS)
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    legal_name TEXT,
    document TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_tenants_status CHECK (status IN ('active', 'inactive', 'suspended')),
    CONSTRAINT chk_tenants_slug_lowercase CHECK (slug = lower(slug)),
    CONSTRAINT chk_tenants_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Comentários descritivos
COMMENT ON TABLE public.tenants IS 'Empresas clientes de alimentação contratantes da plataforma SaaS.';
COMMENT ON COLUMN public.tenants.slug IS 'Identificador textual exclusivo em minúsculas (ex: nutri-refeicoes).';

-- Índice único case-insensitive sobre lower(slug)
CREATE UNIQUE INDEX uq_tenants_slug_lower ON public.tenants (lower(slug));

-- Trigger de updated_at
CREATE TRIGGER trg_tenants_updated_at
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: Ativar isolamento estrito (Deny by default para anon e authenticated na Sprint 1)
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
