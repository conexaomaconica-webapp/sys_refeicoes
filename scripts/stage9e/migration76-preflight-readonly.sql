\set ON_ERROR_STOP on

SELECT jsonb_build_object(
    'serverVersionNum', current_setting('server_version_num')::integer,
    'vaultExtensionInstalled', EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault'
    ),
    'vaultCreateSecretExists', to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NOT NULL,
    'integrationTableExists', to_regclass('public.payment_gateway_integrations') IS NOT NULL,
    'migration76Recorded', EXISTS (
        SELECT 1
        FROM supabase_migrations.schema_migrations
        WHERE version = '20261028000076'
    )
) AS stage9e2_migration76_preflight;
