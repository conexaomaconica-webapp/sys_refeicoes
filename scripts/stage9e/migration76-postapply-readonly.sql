\set ON_ERROR_STOP on

SELECT jsonb_build_object(
    'approved',
        EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028000076')
        AND to_regclass('public.payment_gateway_integrations') IS NOT NULL
        AND to_regclass('public.payment_gateway_integration_audit') IS NOT NULL
        AND NOT has_table_privilege('authenticated', 'public.payment_gateway_integrations', 'SELECT')
        AND NOT has_function_privilege('authenticated', 'public.service_get_asaas_integration(uuid,text)', 'EXECUTE'),
    'migrationRecorded', EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028000076'
    ),
    'rlsForced', (
        SELECT relrowsecurity AND relforcerowsecurity
        FROM pg_class WHERE oid = 'public.payment_gateway_integrations'::regclass
    ),
    'authenticatedDirectSelect', has_table_privilege('authenticated', 'public.payment_gateway_integrations', 'SELECT'),
    'authenticatedSecretRpc', has_function_privilege('authenticated', 'public.service_get_asaas_integration(uuid,text)', 'EXECUTE'),
    'configuredIntegrations', (SELECT count(*) FROM public.payment_gateway_integrations),
    'auditEvents', (SELECT count(*) FROM public.payment_gateway_integration_audit),
    'managedVaultSecrets', (
        SELECT count(*) FROM vault.secrets WHERE name LIKE 'ma_refeicoes_asaas_%'
    )
) AS migration76_postapply;
