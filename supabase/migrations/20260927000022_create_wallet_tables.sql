-- ==============================================================================
-- Migration: 20260927000022_create_wallet_tables.sql
-- Descrição: Criação das tabelas public.wallets e public.wallet_transactions (Ledger
--            financeiro imutável) com enums, constraints multi-tenant compostas,
--            garantia de saldo não-negativo e rastreabilidade estrita.
-- ==============================================================================

-- 1. Enum para tipos de movimentação na carteira (Criação Idempotente)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_transaction_type') THEN
        CREATE TYPE public.wallet_transaction_type AS ENUM (
            'recharge',
            'meal_debit',
            'refund',
            'reversal',
            'manual_adjustment'
        );
    END IF;
END $$;

-- 2. Tabela de Carteira Financeira do Aluno (public.wallets)
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL,
    balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_wallets_student UNIQUE (student_id),
    CONSTRAINT uq_wallets_student_tenant UNIQUE (student_id, tenant_id),
    CONSTRAINT uq_wallets_id_tenant UNIQUE (id, tenant_id),
    
    -- Garantia Inegociável de Saldo Não-Negativo no Banco
    CONSTRAINT chk_wallets_balance CHECK (balance >= 0.00),
    CONSTRAINT chk_wallets_status CHECK (status IN ('active', 'frozen', 'closed')),

    -- Vínculo Multi-Tenant Composto Protegido por ON DELETE RESTRICT
    CONSTRAINT fk_wallets_student_tenant
        FOREIGN KEY (student_id, tenant_id)
        REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.wallets IS 'Saldo e conta corrente de alunos pagantes/parciais por tenant.';

CREATE INDEX IF NOT EXISTS idx_wallets_tenant_student ON public.wallets(tenant_id, student_id);

DROP TRIGGER IF EXISTS trg_wallets_updated_at ON public.wallets;
CREATE TRIGGER trg_wallets_updated_at
BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Tabela de Livro Razão Financeiro Imutável (public.wallet_transactions)
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL,
    student_id UUID NOT NULL,
    type public.wallet_transaction_type NOT NULL,
    
    -- Valor da transação: positivo para crédito (recharge, refund), negativo para débito (meal_debit)
    amount NUMERIC(12, 2) NOT NULL,
    balance_before NUMERIC(12, 2) NOT NULL,
    balance_after NUMERIC(12, 2) NOT NULL,
    
    reference_type VARCHAR(50),
    reference_id UUID,
    description TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints de Integridade Contábil Imutável
    CONSTRAINT chk_wallet_tx_balance_before CHECK (balance_before >= 0.00),
    CONSTRAINT chk_wallet_tx_balance_after CHECK (balance_after >= 0.00),
    CONSTRAINT chk_wallet_tx_math CHECK (ROUND(balance_after, 2) = ROUND(balance_before + amount, 2)),

    -- Constraints Multi-Tenant Compostas Indissociáveis
    CONSTRAINT fk_wallet_tx_wallet_tenant
        FOREIGN KEY (wallet_id, tenant_id)
        REFERENCES public.wallets(id, tenant_id) ON DELETE RESTRICT,

    CONSTRAINT fk_wallet_tx_student_tenant
        FOREIGN KEY (student_id, tenant_id)
        REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.wallet_transactions IS 'Livro razão (ledger) imutável de todas as movimentações financeiras da carteira.';

CREATE INDEX IF NOT EXISTS idx_wallet_tx_lookup ON public.wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_student ON public.wallet_transactions(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON public.wallet_transactions(reference_type, reference_id);
