-- ==============================================================================
-- Migration: 20260927000010_create_student_categories.sql
-- Descrição: Tabela student_categories com códigos em TEXT extensível por tenant,
--            função de provisionamento de categorias padrão e hardening de acesso.
-- ==============================================================================

CREATE TABLE public.student_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    requires_wallet BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_student_categories_tenant_code UNIQUE (tenant_id, code),
    CONSTRAINT uq_student_categories_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT chk_student_categories_code_format CHECK (code = lower(trim(code))),
    CONSTRAINT chk_student_categories_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE public.student_categories IS 'Categorias funcionais de alunos (ex: Bolsista Integral, Bolsista Parcial) por tenant.';

CREATE INDEX idx_student_categories_lookup ON public.student_categories(tenant_id, code);

CREATE TRIGGER trg_student_categories_updated_at
BEFORE UPDATE ON public.student_categories
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Função Idempotente de Provisionamento de Categorias Padrão
CREATE OR REPLACE FUNCTION public.provision_default_student_categories(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.student_categories (tenant_id, code, name, description, requires_wallet, status)
    VALUES 
        (p_tenant_id, 'integral', 'Bolsista Integral', 'Isento de pagamento de refeições', false, 'active'),
        (p_tenant_id, 'partial', 'Bolsista Parcial / Pagante', 'Exige recarga na carteira para consumo', true, 'active')
    ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$;

-- Hardening de Permissões (Revogação total para PUBLIC / anon / authenticated)
REVOKE ALL ON FUNCTION public.provision_default_student_categories(UUID) FROM PUBLIC;

-- Executa o provisionamento para todos os tenants já existentes no banco
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.tenants LOOP
        PERFORM public.provision_default_student_categories(r.id);
    END LOOP;
END $$;
