-- ==============================================================================
-- Migration: 20260927000016_create_imports_tables.sql
-- Descrição: Criação das tabelas public.imports e public.import_rows com enums,
--            constraints de integridade multi-tenant compostas, unicidade e auditoria.
-- ==============================================================================

-- 1. Enums de controle do processo de importação
CREATE TYPE public.import_status AS ENUM (
    'preview',
    'processing',
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled'
);

CREATE TYPE public.import_mode AS ENUM (
    'general',
    'integral_snapshot'
);

CREATE TYPE public.import_row_action AS ENUM (
    'insert',
    'update',
    'reclassify_partial',
    'ignore',
    'error'
);

CREATE TYPE public.import_row_status AS ENUM (
    'pending',
    'processed',
    'failed',
    'skipped'
);

-- 2. Tabela principal de Importações (public.imports)
CREATE TABLE public.imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    institution_id UUID NOT NULL,
    import_mode public.import_mode NOT NULL DEFAULT 'general',
    
    -- Vínculo composto multi-tenant com profiles(id, tenant_id)
    created_by UUID NOT NULL,
    
    -- Nome do arquivo original (metadado) e path canônico no Storage
    original_filename VARCHAR(255) NOT NULL,
    storage_path VARCHAR(512) NOT NULL,
    file_hash VARCHAR(64) NOT NULL, -- SHA-256 do arquivo original
    file_size_bytes BIGINT NOT NULL,
    status public.import_status NOT NULL DEFAULT 'preview',
    
    -- Métricas e Totais do Lote
    total_rows INT NOT NULL DEFAULT 0,
    valid_rows INT NOT NULL DEFAULT 0,
    insert_rows INT NOT NULL DEFAULT 0,
    update_rows INT NOT NULL DEFAULT 0,
    reclassify_rows INT NOT NULL DEFAULT 0,
    ignored_rows INT NOT NULL DEFAULT 0,
    error_rows INT NOT NULL DEFAULT 0,
    
    -- Confirmation Flag para o Modo Relação Oficial de Integrais
    is_official_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Erro global estrutural (caso falhe parsing/script)
    error_message TEXT,
    
    -- Constraint para permitir FK composta em import_rows
    CONSTRAINT uq_imports_id_tenant UNIQUE (id, tenant_id),
    
    -- Constraints Multi-Tenant Compostas Indissociáveis
    CONSTRAINT fk_imports_institution_tenant
        FOREIGN KEY (institution_id, tenant_id)
        REFERENCES public.institutions(id, tenant_id) ON DELETE RESTRICT,
        
    CONSTRAINT fk_imports_created_by_tenant
        FOREIGN KEY (created_by, tenant_id)
        REFERENCES public.profiles(id, tenant_id) ON DELETE RESTRICT,

    -- Validação de consistência entre import_mode e is_official_snapshot
    CONSTRAINT chk_imports_mode_snapshot CHECK (
        (import_mode = 'general' AND is_official_snapshot = FALSE)
        OR (import_mode = 'integral_snapshot')
    )
);

COMMENT ON TABLE public.imports IS 'Registro principal de cabeçalho de lotes de importação de alunos por planilha.';

CREATE INDEX idx_imports_tenant_inst ON public.imports(tenant_id, institution_id);
CREATE INDEX idx_imports_idempotency ON public.imports(tenant_id, institution_id, file_hash, import_mode, status);

-- 3. Tabela de detalhamento de linhas (public.import_rows)
CREATE TABLE public.import_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    row_number INT NOT NULL,
    
    -- Matrícula preservando zeros à esquerda (TEXT)
    registration_number TEXT,
    
    -- Dados brutos e normalizados em JSONB
    raw_data JSONB NOT NULL,
    normalized_data JSONB,
    
    -- Planejamento no Preview e Status de Execução
    action public.import_row_action NOT NULL,
    status public.import_row_status NOT NULL DEFAULT 'pending',
    
    -- Erros e avisos por linha
    errors JSONB DEFAULT '[]'::jsonb,
    warnings JSONB DEFAULT '[]'::jsonb,
    
    -- FK composta protegida com public.students(id, tenant_id)
    student_id UUID,
    
    -- Snapshots de auditoria para diff e concorrência
    before_snapshot JSONB,
    after_snapshot JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints Multi-Tenant Compostas Indissociáveis
    CONSTRAINT uq_import_rows_row_number UNIQUE (import_id, row_number),
    
    CONSTRAINT fk_import_rows_import_tenant
        FOREIGN KEY (import_id, tenant_id)
        REFERENCES public.imports(id, tenant_id) ON DELETE CASCADE,
        
    CONSTRAINT fk_import_rows_student_tenant
        FOREIGN KEY (student_id, tenant_id)
        REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.import_rows IS 'Manifesto auditável linha a linha gerado no preview e consumido na confirmação da importação.';

CREATE INDEX idx_import_rows_lookup ON public.import_rows(import_id, status);
CREATE INDEX idx_import_rows_registration ON public.import_rows(tenant_id, registration_number);
