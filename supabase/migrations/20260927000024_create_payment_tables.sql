-- ==============================================================================
-- Migration: 20260927000024_create_payment_tables.sql
-- Descrição: Criação das tabelas public.payment_providers, public.payments,
--            public.recharges e public.payment_webhook_events para suporte a
--            recargas financeiras automáticas multi-gateway (Asaas e Mercado Pago).
-- ==============================================================================

-- 1. Enums de Pagamento e Recarga (Criação Idempotente)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE public.payment_status AS ENUM (
            'pending',
            'confirmed',
            'failed',
            'cancelled',
            'refunded'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recharge_status') THEN
        CREATE TYPE public.recharge_status AS ENUM (
            'pending',
            'confirmed',
            'failed',
            'reversed'
        );
    END IF;
END $$;

-- 2. Tabela de Provedores de Pagamento por Tenant (public.payment_providers)
CREATE TABLE IF NOT EXISTS public.payment_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code TEXT NOT NULL, -- 'asaas', 'mercadopago', 'mock'
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    credentials JSONB NOT NULL DEFAULT '{}'::jsonb, -- encrypted or masked config (api_key, webhook_secret)
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payment_providers_tenant_code UNIQUE (tenant_id, code),
    CONSTRAINT uq_payment_providers_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT chk_payment_providers_code CHECK (code IN ('asaas', 'mercadopago', 'mock', 'sitef'))
);

COMMENT ON TABLE public.payment_providers IS 'Configuração e credenciais de gateways de pagamento por tenant.';

CREATE INDEX IF NOT EXISTS idx_payment_providers_tenant ON public.payment_providers(tenant_id, is_active);

DROP TRIGGER IF EXISTS trg_payment_providers_updated_at ON public.payment_providers;
CREATE TRIGGER trg_payment_providers_updated_at
BEFORE UPDATE ON public.payment_providers
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Tabela de Pagamentos / Cobranças Gateway (public.payments)
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL,
    provider_id UUID NOT NULL,
    external_payment_id TEXT, -- ID retornado pelo Asaas ou Mercado Pago
    method TEXT NOT NULL, -- 'pix', 'credit_card'
    amount NUMERIC(12, 2) NOT NULL,
    status public.payment_status NOT NULL DEFAULT 'pending',
    pix_qr_code TEXT, -- Imagem Base64 ou URL do QR Code Pix
    pix_copy_paste TEXT, -- Código Pix Copia e Cola
    raw_response JSONB,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payments_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT uq_payments_provider_external UNIQUE (provider_id, external_payment_id),
    CONSTRAINT chk_payments_amount CHECK (amount > 0.00),
    CONSTRAINT chk_payments_method CHECK (method IN ('pix', 'credit_card')),

    -- Constraints Multi-Tenant Compostas Indissociáveis
    CONSTRAINT fk_payments_student_tenant
        FOREIGN KEY (student_id, tenant_id)
        REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT,

    CONSTRAINT fk_payments_provider_tenant
        FOREIGN KEY (provider_id, tenant_id)
        REFERENCES public.payment_providers(id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.payments IS 'Registro de cobranças emitidas nos gateways de pagamento externos.';

CREATE INDEX IF NOT EXISTS idx_payments_student ON public.payments(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_external ON public.payments(provider_id, external_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(tenant_id, status);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 4. Tabela de Recargas Financeiras (public.recharges)
CREATE TABLE IF NOT EXISTS public.recharges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL,
    wallet_id UUID NOT NULL,
    payment_id UUID,
    amount NUMERIC(12, 2) NOT NULL,
    status public.recharge_status NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL, -- 'pix', 'credit_card', 'cash', 'manual'
    unit_id UUID,
    operator_id UUID REFERENCES public.profiles(id),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_recharges_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT chk_recharges_amount CHECK (amount > 0.00),
    CONSTRAINT chk_recharges_source CHECK (source IN ('pix', 'credit_card', 'cash', 'manual')),

    -- Constraints Multi-Tenant Compostas Indissociáveis
    CONSTRAINT fk_recharges_student_tenant
        FOREIGN KEY (student_id, tenant_id)
        REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT,

    CONSTRAINT fk_recharges_wallet_tenant
        FOREIGN KEY (wallet_id, tenant_id)
        REFERENCES public.wallets(id, tenant_id) ON DELETE RESTRICT,

    CONSTRAINT fk_recharges_payment_tenant
        FOREIGN KEY (payment_id, tenant_id)
        REFERENCES public.payments(id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.recharges IS 'Vínculo operacional de recargas creditadas na carteira do aluno.';

CREATE INDEX IF NOT EXISTS idx_recharges_wallet ON public.recharges(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recharges_student ON public.recharges(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recharges_payment ON public.recharges(payment_id);

DROP TRIGGER IF EXISTS trg_recharges_updated_at ON public.recharges;
CREATE TRIGGER trg_recharges_updated_at
BEFORE UPDATE ON public.recharges
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. Tabela de Log e Idempotência de Eventos Webhook (public.payment_webhook_events)
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider_code TEXT NOT NULL, -- 'asaas', 'mercadopago'
    event_id TEXT NOT NULL, -- ID do evento retornado pelo webhook do gateway
    event_type TEXT NOT NULL, -- ex: 'PAYMENT_RECEIVED', 'payment.updated'
    external_payment_id TEXT,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Garantia Inegociável de Idempotência: o mesmo evento de webhook nunca pode ser duplicado
    CONSTRAINT uq_payment_webhook_provider_event UNIQUE (provider_code, event_id)
);

COMMENT ON TABLE public.payment_webhook_events IS 'Registro auditável e barreira de idempotência contra reprocessamento duplicado de webhooks.';

CREATE INDEX IF NOT EXISTS idx_webhook_events_lookup ON public.payment_webhook_events(provider_code, event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed ON public.payment_webhook_events(processed) WHERE processed = false;
