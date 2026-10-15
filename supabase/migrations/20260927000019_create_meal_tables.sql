-- ==============================================================================
-- Migration: 20260927000019_create_meal_tables.sql
-- Descrição: Criação das tabelas public.meal_types, public.unit_meal_types e
--            public.meal_rules com enums, constraints multi-tenant compostas,
--            exclusão de sobreposição temporal (btree_gist) e histórico de vigência.
-- ==============================================================================

-- 0. Extensão necessária para Exclusion Constraints temporais
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Enum para códigos padrão de refeição (Criação Idempotente)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meal_type_code') THEN
        CREATE TYPE public.meal_type_code AS ENUM (
            'breakfast',
            'lunch',
            'dinner'
        );
    END IF;
END $$;

-- 2. Tabela de Tipos de Refeição (public.meal_types)
CREATE TABLE IF NOT EXISTS public.meal_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code public.meal_type_code NOT NULL,
    name VARCHAR(100) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_meal_types_tenant_code UNIQUE (tenant_id, code),
    CONSTRAINT uq_meal_types_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT chk_meal_types_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE public.meal_types IS 'Catálogo de tipos de refeição (ex: Café da Manhã, Almoço, Jantar) por tenant.';

CREATE INDEX IF NOT EXISTS idx_meal_types_tenant ON public.meal_types(tenant_id, status);

DROP TRIGGER IF EXISTS trg_meal_types_updated_at ON public.meal_types;
CREATE TRIGGER trg_meal_types_updated_at
BEFORE UPDATE ON public.meal_types
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Tabela de Refeições por Unidade (public.unit_meal_types)
CREATE TABLE IF NOT EXISTS public.unit_meal_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,
    meal_type_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    start_time TIME WITHOUT TIME ZONE,
    end_time TIME WITHOUT TIME ZONE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_unit_meal_types_unit_meal UNIQUE (unit_id, meal_type_id),
    CONSTRAINT uq_unit_meal_types_comp UNIQUE (unit_id, meal_type_id, tenant_id),
    CONSTRAINT uq_unit_meal_types_id_tenant UNIQUE (id, tenant_id),
    
    -- Constraints Multi-Tenant Compostas Indissociáveis
    CONSTRAINT fk_unit_meal_types_unit_tenant
        FOREIGN KEY (unit_id, tenant_id)
        REFERENCES public.units(id, tenant_id) ON DELETE CASCADE,
        
    CONSTRAINT fk_unit_meal_types_meal_type_tenant
        FOREIGN KEY (meal_type_id, tenant_id)
        REFERENCES public.meal_types(id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.unit_meal_types IS 'Configuração e horários de funcionamento de cada refeição habilitada por unidade.';

CREATE INDEX IF NOT EXISTS idx_unit_meal_types_lookup ON public.unit_meal_types(tenant_id, unit_id, enabled);

DROP TRIGGER IF EXISTS trg_unit_meal_types_updated_at ON public.unit_meal_types;
CREATE TRIGGER trg_unit_meal_types_updated_at
BEFORE UPDATE ON public.unit_meal_types
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 4. Tabela de Regras de Preço e Subsídio (public.meal_rules)
CREATE TABLE IF NOT EXISTS public.meal_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,
    meal_type_id UUID NOT NULL,
    category_id UUID NOT NULL,
    
    full_price NUMERIC(12, 2) NOT NULL,
    student_price NUMERIC(12, 2) NOT NULL,
    subsidy_amount NUMERIC(12, 2) NOT NULL,
    
    enabled BOOLEAN NOT NULL DEFAULT true,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Checks de Integridade Financeira
    CONSTRAINT chk_meal_rules_full_price CHECK (full_price >= 0),
    CONSTRAINT chk_meal_rules_student_price CHECK (student_price >= 0),
    CONSTRAINT chk_meal_rules_student_price_max CHECK (student_price <= full_price),
    CONSTRAINT chk_meal_rules_subsidy_amount CHECK (subsidy_amount >= 0),
    CONSTRAINT chk_meal_rules_math CHECK (ROUND(subsidy_amount, 2) = ROUND(full_price - student_price, 2)),
    CONSTRAINT chk_meal_rules_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from),

    -- Constraints Multi-Tenant Compostas Indissociáveis
    CONSTRAINT fk_meal_rules_unit_meal_tenant
        FOREIGN KEY (unit_id, meal_type_id, tenant_id)
        REFERENCES public.unit_meal_types(unit_id, meal_type_id, tenant_id) ON DELETE RESTRICT,

    CONSTRAINT fk_meal_rules_category_tenant
        FOREIGN KEY (category_id, tenant_id)
        REFERENCES public.student_categories(id, tenant_id) ON DELETE RESTRICT,

    -- Impedir a nível de banco duas vigências sobrepostas ativas para a mesma refeição/unidade/categoria
    CONSTRAINT ex_meal_rules_no_overlap EXCLUDE USING gist (
        tenant_id WITH =,
        unit_id WITH =,
        meal_type_id WITH =,
        category_id WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
    ) WHERE (enabled = true)
);

COMMENT ON TABLE public.meal_rules IS 'Regras financeiras de preços e subsídios por Unidade, Tipo de Refeição e Categoria de Aluno com histórico de vigência sem sobreposição.';

CREATE INDEX IF NOT EXISTS idx_meal_rules_active_lookup ON public.meal_rules(unit_id, meal_type_id, category_id, enabled, effective_from, effective_to);

DROP TRIGGER IF EXISTS trg_meal_rules_updated_at ON public.meal_rules;
CREATE TRIGGER trg_meal_rules_updated_at
BEFORE UPDATE ON public.meal_rules
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. Função Idempotente de Provisionamento de Tipos de Refeição Padrão por Tenant
CREATE OR REPLACE FUNCTION public.provision_default_meal_types(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.meal_types (tenant_id, code, name, status)
    VALUES 
        (p_tenant_id, 'breakfast', 'Café da Manhã', 'active'),
        (p_tenant_id, 'lunch', 'Almoço', 'active'),
        (p_tenant_id, 'dinner', 'Jantar', 'active')
    ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$;

-- Hardening de Permissões
REVOKE ALL ON FUNCTION public.provision_default_meal_types(UUID) FROM PUBLIC;

-- Executa o provisionamento para todos os tenants já existentes no banco
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.tenants LOOP
        PERFORM public.provision_default_meal_types(r.id);
    END LOOP;
END $$;
