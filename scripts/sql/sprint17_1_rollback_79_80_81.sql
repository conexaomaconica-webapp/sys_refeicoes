-- ==============================================================================
-- Sprint 17.1: Plano de Rollback Reverso das Migrations 81 -> 80 -> 79
-- IMPORTANTE: Rollback de schema NÃO substitui restauração integral (PITR /
--             backup lógico Etapa 9E.1-B). Se houver dados gravados nas tabelas
--             da Sprint 16, o script aborta para impedir perda de dados.
-- ==============================================================================

DO $$
BEGIN
    IF to_regclass('public.financial_reconciliation_batches') IS NOT NULL AND EXISTS (SELECT 1 FROM public.financial_reconciliation_batches LIMIT 1) THEN
        RAISE EXCEPTION 'ROLLBACK_BLOCKED_DATA_EXISTS: Existem lotes em financial_reconciliation_batches. Utilize backup lógico (9E.1-B) ou migration forward-only.';
    END IF;
    IF to_regclass('public.financial_reconciliation_divergences') IS NOT NULL AND EXISTS (SELECT 1 FROM public.financial_reconciliation_divergences LIMIT 1) THEN
        RAISE EXCEPTION 'ROLLBACK_BLOCKED_DATA_EXISTS: Existem registros em financial_reconciliation_divergences.';
    END IF;
    IF to_regclass('public.financial_daily_closings') IS NOT NULL AND EXISTS (SELECT 1 FROM public.financial_daily_closings LIMIT 1) THEN
        RAISE EXCEPTION 'ROLLBACK_BLOCKED_DATA_EXISTS: Existem registros em financial_daily_closings.';
    END IF;
END $$;

-- 1. Reverter objetos introduzidos pela Migration 81 e restaurar estado pré-81 (77/78)
DROP TRIGGER IF EXISTS trg_wallet_transactions_no_truncate ON public.wallet_transactions;
DROP TRIGGER IF EXISTS trg_wallet_transactions_immutable ON public.wallet_transactions;
DROP FUNCTION IF EXISTS public.prevent_wallet_ledger_mutation();
DROP FUNCTION IF EXISTS public.audit_wallet_custody_integrity(UUID);

DROP TRIGGER IF EXISTS trg_signal_meal_consumption ON public.meal_consumptions;
DROP TRIGGER IF EXISTS trg_signal_blocked_attempt ON public.blocked_attempts;
DROP FUNCTION IF EXISTS public.emit_operational_dashboard_signal();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'operational_dashboard_signals'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.operational_dashboard_signals;
    END IF;

    -- Restaurar publicação Realtime pré-81 (Migration 78)
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meal_consumptions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.meal_consumptions;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'blocked_attempts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.blocked_attempts;
    END IF;
END $$;

DROP TABLE IF EXISTS public.operational_dashboard_signals;
DROP TRIGGER IF EXISTS trg_prevent_contingency_tampering ON public.contingency_meal_batches;
DROP FUNCTION IF EXISTS public.prevent_contingency_tampering();

-- Restaurar políticas pré-81 da Migration 77
DROP POLICY IF EXISTS upd_contingency_batches_staff ON public.contingency_meal_batches;
CREATE POLICY upd_contingency_batches_staff ON public.contingency_meal_batches
FOR UPDATE TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND (
        (operator_id = auth.uid() AND status IN ('draft', 'pending_approval'))
        OR public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    )
);

DROP POLICY IF EXISTS sel_contingency_evidence_staff ON storage.objects;
CREATE POLICY sel_contingency_evidence_staff ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'contingency-evidence'
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
);

DROP POLICY IF EXISTS ins_contingency_evidence_staff ON storage.objects;
CREATE POLICY ins_contingency_evidence_staff ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'contingency-evidence'
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
);

-- 2. Reverter objetos introduzidos pela Migration 80 (Conciliação)
DROP FUNCTION IF EXISTS public.run_financial_reconciliation_audit(UUID, DATE, DATE);
DROP TABLE IF EXISTS public.financial_reconciliation_divergences;
DROP TABLE IF EXISTS public.financial_reconciliation_batches;
DROP TABLE IF EXISTS public.financial_daily_closings;
DROP TYPE IF EXISTS public.divergence_status;
DROP TYPE IF EXISTS public.divergence_severity;
DROP TYPE IF EXISTS public.reconciliation_divergence_type;
DROP TYPE IF EXISTS public.reconciliation_batch_status;

-- 3. Reverter objetos introduzidos pela Migration 79 (Relatórios Fiscais)
DROP FUNCTION IF EXISTS public.get_consolidated_financial_report(UUID, DATE, DATE, UUID, UUID, UUID);
