-- ==============================================================================
-- Migration: 20260927000028_create_meal_consumption_tables.sql
-- Descrição: Criação das tabelas meal_consumptions e blocked_attempts com suporte
--            a idempotência canônica, cota diária inteligente e auditoria completa.
-- ==============================================================================

-- 1. Tabela: meal_consumptions (Consumos de Refeições Confirmados)
CREATE TABLE public.meal_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    unit_id UUID NOT NULL,
    institution_id UUID NOT NULL,
    student_id UUID NOT NULL,
    category_id UUID NOT NULL,
    meal_type_id UUID NOT NULL,
    
    -- Controle Temporal e Fuso da Unidade
    consumption_date DATE NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Valores Contábeis no Momento do Consumo (Snapshot Imutável)
    full_price NUMERIC(12, 2) NOT NULL,
    student_price NUMERIC(12, 2) NOT NULL,
    subsidy_amount NUMERIC(12, 2) NOT NULL,
    
    -- Rastreabilidade Operacional e Financeira
    wallet_transaction_id UUID NULL,
    operator_id UUID NOT NULL REFERENCES public.profiles(id),
    terminal_id TEXT NULL,
    verification_method TEXT NOT NULL,
    idempotency_key TEXT NULL,
    request_hash TEXT NULL,
    qr_token_id UUID NULL,
    
    -- Status e Ciclo de Vida Auditável
    -- 'approved': Fornecida normalmente (ocupa cota)
    -- 'financially_refunded': Estorno financeiro com refeição consumida (continua ocupando cota)
    -- 'cancelled_unserved': Registro indevido cancelado sem fornecimento (libera cota diária)
    status TEXT NOT NULL DEFAULT 'approved',
    reversal_reason TEXT NULL,
    reversed_at TIMESTAMPTZ NULL,
    reversed_by UUID NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints de Integridade Financeira e Matemática
    CONSTRAINT chk_meal_consumptions_full_price CHECK (full_price >= 0.00),
    CONSTRAINT chk_meal_consumptions_student_price CHECK (student_price >= 0.00),
    CONSTRAINT chk_meal_consumptions_subsidy CHECK (subsidy_amount >= 0.00),
    CONSTRAINT chk_meal_consumptions_math CHECK (ROUND(subsidy_amount, 2) = ROUND(full_price - student_price, 2)),
    CONSTRAINT chk_meal_consumptions_method CHECK (verification_method IN ('qr_dynamic', 'physical_card', 'registration_number', 'offline_contingency')),
    CONSTRAINT chk_meal_consumptions_status CHECK (status IN ('approved', 'financially_refunded', 'cancelled_unserved')),

    -- Constraints Multi-Tenant Compostas Indissociáveis (ON DELETE RESTRICT)
    CONSTRAINT fk_meal_consumptions_tenant 
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT,
    CONSTRAINT fk_meal_consumptions_unit_tenant 
        FOREIGN KEY (unit_id, tenant_id) REFERENCES public.units(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_meal_consumptions_inst_tenant 
        FOREIGN KEY (institution_id, tenant_id) REFERENCES public.institutions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_meal_consumptions_student_tenant 
        FOREIGN KEY (student_id, tenant_id) REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_meal_consumptions_category_tenant 
        FOREIGN KEY (category_id, tenant_id) REFERENCES public.student_categories(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_meal_consumptions_meal_type_tenant 
        FOREIGN KEY (meal_type_id, tenant_id) REFERENCES public.meal_types(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_meal_consumptions_wallet_tx 
        FOREIGN KEY (wallet_transaction_id) REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_meal_consumptions_qr_token 
        FOREIGN KEY (qr_token_id) REFERENCES public.qr_tokens(id) ON DELETE RESTRICT,
    CONSTRAINT uq_meal_consumptions_id_tenant UNIQUE (id, tenant_id)
);

COMMENT ON TABLE public.meal_consumptions IS 'Registro oficial, auditável e imutável de refeições liberadas por unidade e turno.';

-- Unicidade Condicional de Cota Diária:
-- Apenas status que representam refeição fisicamente fornecida ocupam a cota
CREATE UNIQUE INDEX idx_meal_consumptions_active_daily 
    ON public.meal_consumptions(student_id, consumption_date, meal_type_id) 
    WHERE (status IN ('approved', 'financially_refunded'));

-- Unicidade da Chave de Idempotência por Tenant
CREATE UNIQUE INDEX uq_meal_consumptions_idempotency 
    ON public.meal_consumptions(tenant_id, idempotency_key) 
    WHERE idempotency_key IS NOT NULL;

-- Índices de Performance Operacional
CREATE INDEX idx_meal_consumptions_unit_date ON public.meal_consumptions(unit_id, consumption_date);
CREATE INDEX idx_meal_consumptions_student_date ON public.meal_consumptions(student_id, consumption_date);
CREATE INDEX idx_meal_consumptions_tenant_created ON public.meal_consumptions(tenant_id, created_at DESC);

-- Trigger de updated_at
CREATE TRIGGER trg_meal_consumptions_updated_at
BEFORE UPDATE ON public.meal_consumptions
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Tabela: blocked_attempts (Auditoria de Bloqueios e Tentativas Indevidas)
CREATE TABLE public.blocked_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL,
    student_id UUID NULL,
    category_id UUID NULL,
    meal_type_id UUID NULL,
    
    registration_attempted TEXT NULL,
    verification_method TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason_message TEXT NOT NULL,
    
    terminal_id TEXT NULL,
    operator_id UUID NULL REFERENCES public.profiles(id),
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Catálogo Padronizado de Códigos de Bloqueio (Sincronizado com TypeScript e RPC)
    CONSTRAINT chk_blocked_attempts_reason CHECK (reason_code IN (
        'AUTH_REQUIRED',
        'UNAUTHORIZED_CALLER',
        'PERMISSION_DENIED',
        'ACCESS_DENIED_UNIT',
        'UNIT_UNAVAILABLE',
        'INVALID_IDENTIFIER',
        'INVALID_IDENTIFIER_FORMAT',
        'IDEMPOTENCY_KEY_REUSE_MISMATCH',
        'STUDENT_NOT_FOUND',
        'STUDENT_INACTIVE',
        'CARD_INACTIVE',
        'TOKEN_NOT_FOUND',
        'TOKEN_REVOKED',
        'TOKEN_ALREADY_USED',
        'TOKEN_EXPIRED',
        'PHYSICAL_CARD_NOT_FOUND',
        'MEAL_NOT_ENABLED_FOR_UNIT',
        'OUT_OF_SCHEDULE',
        'ALREADY_CONSUMED_TODAY',
        'NO_PRICE_RULE_CONFIGURED',
        'WALLET_NOT_FOUND',
        'WALLET_INACTIVE',
        'INSUFFICIENT_FUNDS',
        'CONCURRENT_CONSUMPTION_CONFLICT'
    ))
);

COMMENT ON TABLE public.blocked_attempts IS 'Auditoria em tempo real de tentativas de consumo bloqueadas para fins antifraude e controle operacional.';

CREATE INDEX idx_blocked_attempts_unit_date ON public.blocked_attempts(unit_id, attempted_at DESC);
CREATE INDEX idx_blocked_attempts_student ON public.blocked_attempts(student_id, attempted_at DESC);
CREATE INDEX idx_blocked_attempts_reason ON public.blocked_attempts(tenant_id, reason_code);
