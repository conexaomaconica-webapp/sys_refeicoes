\set ON_ERROR_STOP on
BEGIN;
\ir ../../supabase/migrations/20261028000076_add_secure_asaas_integrations.sql
\ir ../../supabase/migrations/20261028000076_add_secure_asaas_integrations.sql

DO $checks$
BEGIN
    IF to_regclass('public.payment_gateway_integrations') IS NULL THEN
        RAISE EXCEPTION 'integration table missing';
    END IF;
    IF to_regclass('public.payment_gateway_integration_audit') IS NULL THEN
        RAISE EXCEPTION 'audit table missing';
    END IF;
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.payment_gateway_integrations'::regclass) THEN
        RAISE EXCEPTION 'integration RLS not forced';
    END IF;
    IF has_table_privilege('authenticated', 'public.payment_gateway_integrations', 'SELECT') THEN
        RAISE EXCEPTION 'authenticated can select integration metadata directly';
    END IF;
    IF has_function_privilege('authenticated', 'public.service_get_asaas_integration(uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated can retrieve secrets';
    END IF;
    IF NOT has_function_privilege('service_role', 'public.service_get_asaas_integration(uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'service role cannot retrieve secrets';
    END IF;
END;
$checks$;

SELECT jsonb_build_object(
    'approved', true,
    'idempotentApply', true,
    'rlsForced', true,
    'authenticatedSecretAccess', false,
    'auditEnabled', true
) AS migration76_dry_run;
ROLLBACK;
