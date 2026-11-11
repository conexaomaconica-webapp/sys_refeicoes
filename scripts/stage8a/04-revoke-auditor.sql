\set ON_ERROR_STOP on

-- Executar futuramente com administrador, depois de encerrar a sessao 8A.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

ALTER ROLE ma_stage8a_auditor NOLOGIN;

DO $stage8a_revoke_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_stat_activity AS activity
        WHERE activity.usename = 'ma_stage8a_auditor'
          AND activity.pid <> pg_catalog.pg_backend_pid()
    ) THEN
        RAISE EXCEPTION 'STAGE8A_AUDITOR_HAS_ACTIVE_SESSIONS';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class WHERE relowner = 'ma_stage8a_auditor'::regrole
        UNION ALL
        SELECT 1 FROM pg_catalog.pg_proc WHERE proowner = 'ma_stage8a_auditor'::regrole
        UNION ALL
        SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = 'ma_stage8a_auditor'::regrole
        UNION ALL
        SELECT 1 FROM pg_catalog.pg_database WHERE datdba = 'ma_stage8a_auditor'::regrole
    ) THEN
        RAISE EXCEPTION 'STAGE8A_AUDITOR_OWNS_OBJECTS';
    END IF;
END;
$stage8a_revoke_guard$;

REVOKE SELECT (version) ON TABLE supabase_migrations.schema_migrations FROM ma_stage8a_auditor;
REVOKE USAGE ON SCHEMA supabase_migrations FROM ma_stage8a_auditor;
REVOKE ALL ON DATABASE :"DBNAME" FROM ma_stage8a_auditor;
REVOKE ALL ON SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ma_stage8a_auditor;

DROP ROLE ma_stage8a_auditor;
COMMIT;
