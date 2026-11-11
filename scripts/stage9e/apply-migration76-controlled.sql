\set ON_ERROR_STOP on
BEGIN;

DO $preapply$
BEGIN
    IF EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version = '20261028000076'
    ) THEN
        RAISE EXCEPTION 'MIGRATION_76_ALREADY_RECORDED';
    END IF;
    IF to_regclass('public.payment_gateway_integrations') IS NOT NULL THEN
        RAISE EXCEPTION 'MIGRATION_76_PARTIAL_STATE_DETECTED';
    END IF;
END;
$preapply$;

\ir ../../supabase/migrations/20261028000076_add_secure_asaas_integrations.sql

INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES (
    '20261028000076',
    ARRAY['source_sha256:44ec0bc69a7cf86d5e5d0861ec019d94b61b4294d75ed59e8da62682bba7d3b2'],
    'add_secure_asaas_integrations'
);

DO $postapply$
BEGIN
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.payment_gateway_integrations'::regclass) THEN
        RAISE EXCEPTION 'MIGRATION_76_RLS_POSTCONDITION_FAILED';
    END IF;
    IF has_table_privilege('authenticated', 'public.payment_gateway_integrations', 'SELECT') THEN
        RAISE EXCEPTION 'MIGRATION_76_DIRECT_ACCESS_POSTCONDITION_FAILED';
    END IF;
    IF has_function_privilege('authenticated', 'public.service_get_asaas_integration(uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'MIGRATION_76_SECRET_ACCESS_POSTCONDITION_FAILED';
    END IF;
END;
$postapply$;

COMMIT;

SELECT jsonb_build_object(
    'applied', true,
    'version', version,
    'name', name,
    'integrationTableExists', to_regclass('public.payment_gateway_integrations') IS NOT NULL,
    'auditTableExists', to_regclass('public.payment_gateway_integration_audit') IS NOT NULL
) AS migration76_result
FROM supabase_migrations.schema_migrations
WHERE version = '20261028000076';
