-- ==============================================================================
-- Migration: 20260927000026_create_card_tables.sql
-- Descrição: Tabelas de carteirinhas digitais, cartões físicos e tokens dinâmicos
--            de QR Code com garantias de unicidade, concorrência e integridade.
-- ==============================================================================

-- 1. Tabela: cards (Carteirinhas Digitais e Cartões Físicos)
CREATE TABLE public.cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    student_id UUID NOT NULL,
    card_number TEXT NOT NULL,
    card_type TEXT NOT NULL DEFAULT 'digital',
    physical_code_hash TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NULL,
    blocked_at TIMESTAMPTZ NULL,
    blocked_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Restrições de Integridade e Tenant Composto
    CONSTRAINT fk_cards_tenant FOREIGN KEY (tenant_id) 
        REFERENCES public.tenants(id) ON DELETE RESTRICT,
    CONSTRAINT fk_cards_student_tenant FOREIGN KEY (student_id, tenant_id) 
        REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT chk_cards_type CHECK (card_type IN ('digital', 'physical')),
    CONSTRAINT chk_cards_status CHECK (status IN ('active', 'blocked', 'cancelled', 'replaced')),
    CONSTRAINT uq_cards_id_tenant UNIQUE (id, tenant_id)
);

COMMENT ON TABLE public.cards IS 'Carteirinhas digitais do PWA e cartões físicos permanentes (RFID/código de barras).';

-- Índices e Unicidade
-- Apenas 1 carteirinha digital ativa por estudante
CREATE UNIQUE INDEX idx_cards_student_digital_active 
    ON public.cards(student_id) 
    WHERE (card_type = 'digital' AND status = 'active');

-- Unicidade de cartão físico por tenant (evita clonagem ou reatribuição duplicada)
CREATE UNIQUE INDEX idx_cards_physical_code_unique 
    ON public.cards(tenant_id, physical_code_hash) 
    WHERE (card_type = 'physical' AND physical_code_hash IS NOT NULL AND status = 'active');

CREATE INDEX idx_cards_student_tenant ON public.cards(tenant_id, student_id);
CREATE INDEX idx_cards_number ON public.cards(tenant_id, card_number);

-- Trigger de atualização de timestamp
CREATE TRIGGER trg_cards_updated_at
BEFORE UPDATE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Tabela: qr_tokens (Tokens Dinâmicos para QR Code PWA com TTL de 90 segundos)
CREATE TABLE public.qr_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    card_id UUID NOT NULL,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_qr_tokens_tenant FOREIGN KEY (tenant_id) 
        REFERENCES public.tenants(id) ON DELETE RESTRICT,
    CONSTRAINT fk_qr_tokens_card_tenant FOREIGN KEY (card_id, tenant_id) 
        REFERENCES public.cards(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT chk_qr_tokens_status CHECK (status IN ('active', 'used', 'expired', 'revoked')),
    CONSTRAINT uq_qr_tokens_hash UNIQUE (token_hash)
);

COMMENT ON TABLE public.qr_tokens IS 'Tokens criptográficos rotativos (90s) para exibição segura de QR Code dinâmico.';

-- Invariante Anti-Concorrência: Máximo de 1 token ativo por carteirinha digital
CREATE UNIQUE INDEX idx_qr_tokens_active_unique 
    ON public.qr_tokens(card_id) 
    WHERE (status = 'active');

-- Busca rápida de hash O(1) com filtro de validade
CREATE INDEX idx_qr_tokens_lookup_hash 
    ON public.qr_tokens(token_hash, status, expires_at);

CREATE INDEX idx_qr_tokens_card_tenant 
    ON public.qr_tokens(tenant_id, card_id);
