-- ==============================================================================
-- Migration: 20261109000080_create_financial_reconciliation.sql
-- Descrição: Sprint 16 (Hardened Sprint 17) - Conciliação Financeira Automática
--            e Fechamento Diário. Estrutura imutável de auditoria, lotes,
--            divergências, fechamento segregado (recebimentos vs custódia real
--            vs receita realizada), RLS forçada e search_path = ''.
-- ==============================================================================

-- 1. Enums de Conciliação e Divergência
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reconciliation_batch_status') THEN
        CREATE TYPE public.reconciliation_batch_status AS ENUM (
            'in_progress',
            'completed',
            'completed_with_divergences',
            'failed'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reconciliation_divergence_type') THEN
        CREATE TYPE public.reconciliation_divergence_type AS ENUM (
            'missing_ledger_credit',       -- Pagamento confirmado no gateway sem crédito correspondente no ledger
            'orphan_ledger_credit',        -- Crédito no ledger sem cobrança confirmada correspondente
            'amount_mismatch',             -- Divergência de valor entre cobrança e crédito no ledger
            'delayed_webhook',             -- Webhook processado com latência anormal (> 1h)
            'cancelled_with_credit',       -- Pagamento cancelado/falho no gateway mas com saldo remanescente
            'refund_mismatch',             -- Estorno no gateway sem compensação correspondente no ledger
            'duplicate_webhook_attempt'    -- Tentativa de reprocessamento bloqueada pela barreira de idempotência
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'divergence_severity') THEN
        CREATE TYPE public.divergence_severity AS ENUM (
            'critical',
            'high',
            'medium',
            'low'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'divergence_status') THEN
        CREATE TYPE public.divergence_status AS ENUM (
            'open',
            'under_review',
            'resolved',
            'acknowledged_manual'
        );
    END IF;
END $$;

-- 2. Tabela de Lotes de Conciliação Financeira (Auditoria Periódica)
CREATE TABLE IF NOT EXISTS public.financial_reconciliation_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    reference_date DATE NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    total_payments_analyzed INT NOT NULL DEFAULT 0,
    total_credits_analyzed INT NOT NULL DEFAULT 0,
    matched_count INT NOT NULL DEFAULT 0,
    matched_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    divergences_count INT NOT NULL DEFAULT 0,
    divergences_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    status public.reconciliation_batch_status NOT NULL DEFAULT 'completed',
    executed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 3. Tabela de Divergências Identificadas (Histórico Auditável e Não-Destrutivo)
CREATE TABLE IF NOT EXISTS public.financial_reconciliation_divergences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES public.financial_reconciliation_batches(id) ON DELETE CASCADE,
    divergence_type public.reconciliation_divergence_type NOT NULL,
    severity public.divergence_severity NOT NULL DEFAULT 'high',
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    recharge_id UUID REFERENCES public.recharges(id) ON DELETE SET NULL,
    ledger_tx_id UUID REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    expected_amount NUMERIC(14,2),
    actual_amount NUMERIC(14,2),
    difference_amount NUMERIC(14,2),
    description TEXT NOT NULL,
    status public.divergence_status NOT NULL DEFAULT 'open',
    resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Tabela de Fechamento Financeiro Diário por Unidade e Meio de Pagamento
CREATE TABLE IF NOT EXISTS public.financial_daily_closings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    unit_id UUID REFERENCES public.units(id) ON DELETE RESTRICT,
    closing_date DATE NOT NULL,
    pix_receipts_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    card_receipts_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    cash_receipts_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_receipts_by_method NUMERIC(14,2) NOT NULL DEFAULT 0.00,     -- Entradas financeiras brutas (Pix + Cartão + Dinheiro)
    wallet_credits_added NUMERIC(14,2) NOT NULL DEFAULT 0.00,         -- Créditos efetivos gravados no ledger (recargas/ajustes+)
    wallet_debits_consumed NUMERIC(14,2) NOT NULL DEFAULT 0.00,       -- Baixas de custódia por consumo na catraca
    closing_custody_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00,      -- Saldo efetivo devido aos comensais (SUM wallets.balance)
    custody_ledger_drift NUMERIC(14,2) NOT NULL DEFAULT 0.00,         -- Diferença entre saldo das carteiras e soma do ledger (alvo 0.00)
    realized_student_revenue NUMERIC(14,2) NOT NULL DEFAULT 0.00,     -- Receita realizada direta (consumo comensal)
    contractual_subsidies NUMERIC(14,2) NOT NULL DEFAULT 0.00,        -- Subsídios institucionais devidos
    contingency_subsidies NUMERIC(14,2) NOT NULL DEFAULT 0.00,        -- Subsídios de contingência aprovados
    refunds_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,               -- Estornos compensatórios
    unresolved_divergences_count INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'closed',                            -- 'balanced', 'divergent', 'closed'
    closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_daily_closing_tenant_unit_date UNIQUE (tenant_id, closing_date, unit_id)
);

-- 5. Índices de Desempenho e Auditoria
CREATE INDEX IF NOT EXISTS idx_reconciliation_batches_tenant_date
    ON public.financial_reconciliation_batches (tenant_id, reference_date);

CREATE INDEX IF NOT EXISTS idx_reconciliation_divergences_batch
    ON public.financial_reconciliation_divergences (batch_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_divergences_status
    ON public.financial_reconciliation_divergences (tenant_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_reconciliation_divergences_payment
    ON public.financial_reconciliation_divergences (payment_id);

CREATE INDEX IF NOT EXISTS idx_daily_closings_tenant_date
    ON public.financial_daily_closings (tenant_id, closing_date);

-- 6. Habilitação de RLS Estrita e Forçada em Todas as Tabelas
ALTER TABLE public.financial_reconciliation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_reconciliation_batches FORCE ROW LEVEL SECURITY;

ALTER TABLE public.financial_reconciliation_divergences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_reconciliation_divergences FORCE ROW LEVEL SECURITY;

ALTER TABLE public.financial_daily_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_daily_closings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_reconciliation_batches, public.financial_reconciliation_divergences, public.financial_daily_closings FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.financial_reconciliation_batches TO authenticated;
GRANT SELECT, UPDATE ON public.financial_reconciliation_divergences TO authenticated;
GRANT SELECT ON public.financial_daily_closings TO authenticated;
GRANT ALL ON public.financial_reconciliation_batches, public.financial_reconciliation_divergences, public.financial_daily_closings TO service_role;

-- 7. Políticas de Segurança (RLS) com Verificação de Perfil Ativo e Escopo
DROP POLICY IF EXISTS batches_select_policy ON public.financial_reconciliation_batches;
CREATE POLICY batches_select_policy ON public.financial_reconciliation_batches
    FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND public.get_auth_user_status() = 'active'
        AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    );

DROP POLICY IF EXISTS batches_insert_policy ON public.financial_reconciliation_batches;
CREATE POLICY batches_insert_policy ON public.financial_reconciliation_batches
    FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND public.get_auth_user_status() = 'active'
        AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    );

DROP POLICY IF EXISTS divergences_select_policy ON public.financial_reconciliation_divergences;
CREATE POLICY divergences_select_policy ON public.financial_reconciliation_divergences
    FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND public.get_auth_user_status() = 'active'
        AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    );

DROP POLICY IF EXISTS divergences_update_policy ON public.financial_reconciliation_divergences;
CREATE POLICY divergences_update_policy ON public.financial_reconciliation_divergences
    FOR UPDATE
    TO authenticated
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND public.get_auth_user_status() = 'active'
        AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND public.get_auth_user_status() = 'active'
        AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    );

DROP POLICY IF EXISTS daily_closings_select_policy ON public.financial_daily_closings;
CREATE POLICY daily_closings_select_policy ON public.financial_daily_closings
    FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND public.get_auth_user_status() = 'active'
        AND (
            public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
            OR (
                public.get_auth_user_role() IN ('unit_manager', 'supervisor')
                AND unit_id IS NOT NULL
                AND public.has_unit_access(unit_id)
            )
        )
    );

-- 8. RPC: Execução de Auditoria de Conciliação Financeira
CREATE OR REPLACE FUNCTION public.run_financial_reconciliation_audit(
    p_tenant_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_profile RECORD;
    v_batch_id UUID;
    v_payments_count INT := 0;
    v_credits_count INT := 0;
    v_matched_count INT := 0;
    v_matched_amount NUMERIC(14,2) := 0.00;
    v_divergences_count INT := 0;
    v_divergences_amount NUMERIC(14,2) := 0.00;

    v_pay RECORD;
    v_tx RECORD;
    v_refund_tx RECORD;
    v_recharge RECORD;
BEGIN
    -- 1. Verificação de Autenticação e Autorização Estrita
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação necessária.' USING ERRCODE = '42501';
    END IF;

    SELECT id, tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = v_uid;

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil ativo obrigatório.' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('admin_general', 'operations_director', 'finance') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Apenas administração geral e diretoria financeira podem executar conciliação.' USING ERRCODE = '42501';
    END IF;

    IF v_profile.tenant_id <> p_tenant_id THEN
        RAISE EXCEPTION 'TENANT_MISMATCH: Acesso negado a dados de outro tenant.' USING ERRCODE = '42501';
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'INVALID_DATE_RANGE: Intervalo de conciliação inválido.' USING ERRCODE = '22023';
    END IF;

    -- 2. Criar Lote de Conciliação
    INSERT INTO public.financial_reconciliation_batches (
        tenant_id,
        reference_date,
        period_start,
        period_end,
        executed_by,
        status
    )
    VALUES (
        p_tenant_id,
        p_end_date,
        p_start_date::TIMESTAMPTZ,
        (p_end_date || ' 23:59:59.999')::TIMESTAMPTZ,
        v_uid,
        'in_progress'
    )
    RETURNING id INTO v_batch_id;

    -- 3. Análise de Pagamentos vs Créditos no Ledger
    FOR v_pay IN
        SELECT p.id, p.amount, p.status, p.external_payment_id, p.student_id, p.created_at, p.confirmed_at
          FROM public.payments p
         WHERE p.tenant_id = p_tenant_id
           AND p.created_at::DATE >= p_start_date
           AND p.created_at::DATE <= p_end_date
    LOOP
        v_payments_count := v_payments_count + 1;

        -- Localizar recarga correspondente
        SELECT r.id, r.status, r.amount, r.wallet_id
          INTO v_recharge
          FROM public.recharges r
         WHERE r.payment_id = v_pay.id
           AND r.tenant_id = p_tenant_id
         LIMIT 1;

        -- Localizar lançamento de crédito correspondente no ledger
        SELECT wt.id, wt.amount, wt.created_at
          INTO v_tx
          FROM public.wallet_transactions wt
         WHERE wt.reference_type = 'payment'
           AND wt.reference_id = v_pay.id
           AND wt.type = 'recharge'
           AND wt.tenant_id = p_tenant_id
         LIMIT 1;

        IF v_pay.status = 'confirmed' THEN
            IF v_tx.id IS NULL THEN
                -- Divergência: Pagamento confirmado mas SEM crédito no ledger
                v_divergences_count := v_divergences_count + 1;
                v_divergences_amount := v_divergences_amount + v_pay.amount;
                INSERT INTO public.financial_reconciliation_divergences (
                    tenant_id, batch_id, divergence_type, severity, payment_id, recharge_id,
                    student_id, expected_amount, actual_amount, difference_amount, description, status
                ) VALUES (
                    p_tenant_id, v_batch_id, 'missing_ledger_credit', 'critical', v_pay.id, v_recharge.id,
                    v_pay.student_id, v_pay.amount, 0.00, v_pay.amount,
                    'Cobrança confirmada no gateway (' || COALESCE(v_pay.external_payment_id, 'sem id') || ') sem crédito no ledger da carteira.',
                    'open'
                );
            ELSIF v_tx.amount <> v_pay.amount THEN
                -- Divergência: Valor pago difere do valor creditado
                v_divergences_count := v_divergences_count + 1;
                v_divergences_amount := v_divergences_amount + pg_catalog.abs(v_pay.amount - v_tx.amount);
                INSERT INTO public.financial_reconciliation_divergences (
                    tenant_id, batch_id, divergence_type, severity, payment_id, recharge_id, ledger_tx_id,
                    student_id, expected_amount, actual_amount, difference_amount, description, status
                ) VALUES (
                    p_tenant_id, v_batch_id, 'amount_mismatch', 'high', v_pay.id, v_recharge.id, v_tx.id,
                    v_pay.student_id, v_pay.amount, v_tx.amount, (v_pay.amount - v_tx.amount),
                    'Valor da cobrança (R$ ' || v_pay.amount || ') difere do valor lançado no ledger (R$ ' || v_tx.amount || ').',
                    'open'
                );
            ELSE
                v_matched_count := v_matched_count + 1;
                v_matched_amount := v_matched_amount + v_pay.amount;
            END IF;
        ELSIF v_pay.status = 'refunded' AND v_tx.id IS NOT NULL THEN
            -- Verificar se houve estorno compensatório no ledger
            SELECT wt.id, wt.amount
              INTO v_refund_tx
              FROM public.wallet_transactions wt
             WHERE wt.reference_type = 'payment'
               AND wt.reference_id = v_pay.id
               AND wt.type IN ('refund', 'adjustment')
               AND wt.amount < 0
               AND wt.tenant_id = p_tenant_id
             LIMIT 1;

            IF v_refund_tx.id IS NULL THEN
                v_divergences_count := v_divergences_count + 1;
                v_divergences_amount := v_divergences_amount + v_tx.amount;
                INSERT INTO public.financial_reconciliation_divergences (
                    tenant_id, batch_id, divergence_type, severity, payment_id, recharge_id, ledger_tx_id,
                    student_id, expected_amount, actual_amount, difference_amount, description, status
                ) VALUES (
                    p_tenant_id, v_batch_id, 'refund_mismatch', 'high', v_pay.id, v_recharge.id, v_tx.id,
                    v_pay.student_id, 0.00, v_tx.amount, v_tx.amount,
                    'Pagamento estornado no gateway sem lançamento compensatório de estorno no ledger.',
                    'open'
                );
            ELSE
                v_matched_count := v_matched_count + 1;
                v_matched_amount := v_matched_amount + v_pay.amount;
            END IF;
        ELSIF v_pay.status IN ('failed', 'cancelled') AND v_tx.id IS NOT NULL THEN
            -- Pagamento cancelado mas com crédito existente no ledger
            v_divergences_count := v_divergences_count + 1;
            v_divergences_amount := v_divergences_amount + v_tx.amount;
            INSERT INTO public.financial_reconciliation_divergences (
                tenant_id, batch_id, divergence_type, severity, payment_id, recharge_id, ledger_tx_id,
                student_id, expected_amount, actual_amount, difference_amount, description, status
            ) VALUES (
                p_tenant_id, v_batch_id, 'cancelled_with_credit', 'critical', v_pay.id, v_recharge.id, v_tx.id,
                v_pay.student_id, 0.00, v_tx.amount, v_tx.amount,
                'Pagamento cancelado/falho no gateway possui crédito indevido ativo no ledger da carteira.',
                'open'
            );
        END IF;
    END LOOP;

    -- 4. Análise Inversa: Créditos no Ledger sem Cobrança Registrada
    FOR v_tx IN
        SELECT wt.id, wt.amount, wt.reference_id, wt.student_id
          FROM public.wallet_transactions wt
         WHERE wt.tenant_id = p_tenant_id
           AND wt.type = 'recharge'
           AND wt.reference_type = 'payment'
           AND wt.created_at::DATE >= p_start_date
           AND wt.created_at::DATE <= p_end_date
    LOOP
        v_credits_count := v_credits_count + 1;

        IF NOT EXISTS (
            SELECT 1 FROM public.payments p
             WHERE p.id = v_tx.reference_id
               AND p.tenant_id = p_tenant_id
        ) THEN
            v_divergences_count := v_divergences_count + 1;
            v_divergences_amount := v_divergences_amount + v_tx.amount;
            INSERT INTO public.financial_reconciliation_divergences (
                tenant_id, batch_id, divergence_type, severity, ledger_tx_id,
                student_id, expected_amount, actual_amount, difference_amount, description, status
            ) VALUES (
                p_tenant_id, v_batch_id, 'orphan_ledger_credit', 'critical', v_tx.id,
                v_tx.student_id, 0.00, v_tx.amount, v_tx.amount,
                'Lançamento de recarga no ledger sem cobrança correspondente registrada no gateway.',
                'open'
            );
        END IF;
    END LOOP;

    -- 5. Atualizar Lote com os Resultados Finais
    UPDATE public.financial_reconciliation_batches
       SET total_payments_analyzed = v_payments_count,
           total_credits_analyzed = v_credits_count,
           matched_count = v_matched_count,
           matched_amount = v_matched_amount,
           divergences_count = v_divergences_count,
           divergences_amount = v_divergences_amount,
           status = CASE WHEN v_divergences_count > 0 THEN 'completed_with_divergences'::public.reconciliation_batch_status ELSE 'completed'::public.reconciliation_batch_status END,
           completed_at = pg_catalog.now(),
           summary = pg_catalog.jsonb_build_object(
               'reconciliation_rate_percent', CASE WHEN (v_matched_count + v_divergences_count) > 0 THEN pg_catalog.round((v_matched_count::NUMERIC / (v_matched_count + v_divergences_count)::NUMERIC) * 100, 2) ELSE 100.00 END,
               'total_audited_volume', (v_matched_amount + v_divergences_amount)
           )
     WHERE id = v_batch_id;

    RETURN pg_catalog.jsonb_build_object(
        'batch_id', v_batch_id,
        'status', CASE WHEN v_divergences_count > 0 THEN 'completed_with_divergences' ELSE 'completed' END,
        'payments_analyzed', v_payments_count,
        'credits_analyzed', v_credits_count,
        'matched_count', v_matched_count,
        'matched_amount', v_matched_amount,
        'divergences_count', v_divergences_count,
        'divergences_amount', v_divergences_amount
    );
END;
$$;

REVOKE ALL ON FUNCTION public.run_financial_reconciliation_audit(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_financial_reconciliation_audit(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_financial_reconciliation_audit(UUID, DATE, DATE) TO service_role;

COMMENT ON FUNCTION public.run_financial_reconciliation_audit IS
'Motor atômico de conciliação financeira da Sprint 16 (hardened Sprint 17): detecta missing credits, orphan credits, amount mismatches, refund mismatches e grava lote auditável sem alterar o ledger.';
