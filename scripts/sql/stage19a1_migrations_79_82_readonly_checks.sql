-- ==============================================================================
-- Stage 19A.1: Verificação Read-Only Pós-Aplicação das Migrations 79–82
-- USO FUTURO EXCLUSIVO EM STAGING AUTORIZADO (NÃO EXECUTAR AGORA).
-- Somente consultas SELECT/catálogo — zero mutações no banco.
-- ==============================================================================

-- 1. Verificar existência e proteção RLS/FORCE RLS das tabelas das Sprints 16–18
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS force_rls_enabled
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
      'contingency_meal_batches',
      'contingency_batch_items',
      'operational_dashboard_signals',
      'financial_reconciliation_batches',
      'financial_reconciliation_divergences',
      'financial_daily_closings',
      'wallet_transactions'
  )
ORDER BY c.relname;

-- 2. Confirmar que PII (meal_consumptions e blocked_attempts) NÃO está no supabase_realtime
--    e apenas operational_dashboard_signals permanece publicada
SELECT
    pubname,
    schemaname,
    tablename
FROM pg_catalog.pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- 3. Verificar triggers críticos de integridade (imutabilidade ledger e anti-autoaprovação)
SELECT
    t.tgname AS trigger_name,
    c.relname AS table_name,
    p.proname AS trigger_function
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND t.tgname IN (
      'trg_wallet_transactions_immutable',
      'trg_wallet_transactions_no_truncate',
      'trg_prevent_contingency_tampering',
      'trg_signal_meal_consumption',
      'trg_signal_blocked_attempt'
  )
ORDER BY c.relname, t.tgname;

-- 4. Verificar índices de performance criados pela Migration 82 (válidos e prontos)
SELECT
    idx.relname AS index_name,
    tbl.relname AS table_name,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname = 'public'
  AND idx.relname IN (
      'idx_cash_shifts_open_operator_terminal',
      'idx_meal_consumptions_unit_date_meal_status',
      'idx_wallets_student_tenant',
      'idx_ops_signals_emitted_at'
  )
ORDER BY idx.relname;

-- 5. Verificar search_path seguro e ausência de privilégios para PUBLIC/anon nas RPCs críticas
SELECT
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
    p.prosecdef AS is_security_definer,
    p.proconfig AS config_settings,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_exec,
    pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_exec
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'get_consolidated_financial_report',
      'run_financial_reconciliation_audit',
      'audit_wallet_custody_integrity',
      'review_contingency_batch',
      'submit_contingency_batch',
      'get_realtime_operational_dashboard'
  )
ORDER BY p.proname;

