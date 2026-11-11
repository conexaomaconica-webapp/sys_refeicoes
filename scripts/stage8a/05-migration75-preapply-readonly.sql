-- Etapa 8A.5: snapshot de prontidao estritamente read-only.
-- Nao executa a migration 75 e nao consulta linhas operacionais.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

WITH targets(signature, category, authenticated_expected) AS (
    VALUES
        ('public.admin_list_cash_shifts(uuid,character varying,date,date)', 'legacy_rpc', false),
        ('public.get_active_cash_shift(uuid,character varying)', 'legacy_rpc', false),
        ('public.get_terminal_shift_reports(uuid,uuid,text)', 'active_rpc', true),
        ('public.record_cash_movement(uuid,character varying,numeric,character varying,text)', 'legacy_rpc', false),
        ('public.register_visitor_entry(uuid,uuid,text,character varying)', 'legacy_rpc', false),
        ('public.enrich_cash_movement()', 'trigger', false),
        ('public.handle_updated_at()', 'trigger', false),
        ('public.refresh_cash_shift_payment_totals()', 'trigger', false),
        ('public.sync_imported_consumer_identity()', 'trigger', false),
        ('public.trg_prevent_profile_escalation()', 'trigger', false),
        ('public.trg_prevent_student_tampering()', 'trigger', false),
        ('public.rls_auto_enable()', 'event_trigger', false)
), resolved AS (
    SELECT target.*,
           pg_catalog.to_regprocedure(target.signature) AS procedure_oid
      FROM targets AS target
), function_inventory AS (
    SELECT resolved.signature,
           resolved.category,
           resolved.authenticated_expected,
           procedure.oid,
           pg_catalog.pg_get_userbyid(procedure.proowner) AS owner,
           procedure.prosecdef AS security_definer,
           procedure.provolatile AS volatility,
           procedure.prokind AS kind,
           procedure.proconfig AS configuration,
           language.lanname AS language,
           pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)) AS definition_md5,
           pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') AS anon_execute,
           pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') AS authenticated_execute,
           EXISTS (
               SELECT 1
                 FROM pg_catalog.aclexplode(COALESCE(
                     procedure.proacl,
                     pg_catalog.acldefault('f', procedure.proowner)
                 )) AS acl
                WHERE acl.grantee = 0
                  AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute
      FROM resolved
      JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.procedure_oid
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
), trigger_inventory AS (
    SELECT resolved.signature,
           COALESCE(jsonb_agg(jsonb_build_object(
               'name', trigger.tgname,
               'table', trigger.tgrelid::regclass::text,
               'enabled', trigger.tgenabled
           ) ORDER BY trigger.tgrelid::regclass::text, trigger.tgname)
           FILTER (WHERE trigger.oid IS NOT NULL), '[]'::jsonb) AS triggers
      FROM resolved
      LEFT JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgfoid = resolved.procedure_oid
       AND NOT trigger.tgisinternal
     GROUP BY resolved.signature
), event_trigger_inventory AS (
    SELECT resolved.signature,
           COALESCE(jsonb_agg(jsonb_build_object(
               'name', event_trigger.evtname,
               'enabled', event_trigger.evtenabled,
               'event', event_trigger.evtevent
           ) ORDER BY event_trigger.evtname)
           FILTER (WHERE event_trigger.oid IS NOT NULL), '[]'::jsonb) AS event_triggers
      FROM resolved
      LEFT JOIN pg_catalog.pg_event_trigger AS event_trigger
        ON event_trigger.evtfoid = resolved.procedure_oid
     GROUP BY resolved.signature
)
SELECT jsonb_build_object(
    'database', pg_catalog.current_database(),
    'serverVersionNum', pg_catalog.current_setting('server_version_num')::integer,
    'migration75Recorded', EXISTS (
        SELECT 1
          FROM supabase_migrations.schema_migrations
         WHERE version = '20261027000075'
    ),
    'missingSignatures', COALESCE((
        SELECT jsonb_agg(signature ORDER BY signature)
          FROM resolved
         WHERE procedure_oid IS NULL
    ), '[]'::jsonb),
    'functions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'signature', inventory.signature,
            'category', inventory.category,
            'owner', inventory.owner,
            'securityDefiner', inventory.security_definer,
            'volatility', inventory.volatility,
            'kind', inventory.kind,
            'language', inventory.language,
            'configuration', inventory.configuration,
            'definitionMd5', inventory.definition_md5,
            'publicExecute', inventory.public_execute,
            'anonExecute', inventory.anon_execute,
            'authenticatedExecute', inventory.authenticated_execute,
            'authenticatedExpectedAfter', inventory.authenticated_expected,
            'triggers', trigger_inventory.triggers,
            'eventTriggers', event_trigger_inventory.event_triggers
        ) ORDER BY inventory.signature)
          FROM function_inventory AS inventory
          JOIN trigger_inventory USING (signature)
          JOIN event_trigger_inventory USING (signature)
    ), '[]'::jsonb)
);

ROLLBACK;
