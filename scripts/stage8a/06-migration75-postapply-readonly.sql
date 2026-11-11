-- Etapa 8A.5: verificacao posterior estritamente read-only.
-- Deve ser executada somente se a aplicacao remota for autorizada futuramente.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

WITH targets(signature, authenticated_expected) AS (
    VALUES
        ('public.admin_list_cash_shifts(uuid,character varying,date,date)', false),
        ('public.get_active_cash_shift(uuid,character varying)', false),
        ('public.get_terminal_shift_reports(uuid,uuid,text)', true),
        ('public.record_cash_movement(uuid,character varying,numeric,character varying,text)', false),
        ('public.register_visitor_entry(uuid,uuid,text,character varying)', false),
        ('public.enrich_cash_movement()', false),
        ('public.handle_updated_at()', false),
        ('public.refresh_cash_shift_payment_totals()', false),
        ('public.sync_imported_consumer_identity()', false),
        ('public.trg_prevent_profile_escalation()', false),
        ('public.trg_prevent_student_tampering()', false),
        ('public.rls_auto_enable()', false)
), resolved AS (
    SELECT target.*,
           pg_catalog.to_regprocedure(target.signature) AS procedure_oid
      FROM targets AS target
), checks AS (
    SELECT resolved.signature,
           resolved.procedure_oid IS NOT NULL AS exists,
           CASE WHEN resolved.procedure_oid IS NULL THEN NULL ELSE EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_proc AS procedure,
                      LATERAL pg_catalog.aclexplode(COALESCE(
                          procedure.proacl,
                          pg_catalog.acldefault('f', procedure.proowner)
                      )) AS acl
                WHERE procedure.oid = resolved.procedure_oid
                  AND acl.grantee = 0
                  AND acl.privilege_type = 'EXECUTE'
           ) END AS public_execute,
           CASE WHEN resolved.procedure_oid IS NULL THEN NULL
                ELSE pg_catalog.has_function_privilege('anon', resolved.procedure_oid, 'EXECUTE') END AS anon_execute,
           CASE WHEN resolved.procedure_oid IS NULL THEN NULL
                ELSE pg_catalog.has_function_privilege('authenticated', resolved.procedure_oid, 'EXECUTE') END AS authenticated_execute,
           resolved.authenticated_expected
      FROM resolved
)
SELECT jsonb_build_object(
    'migration75Recorded', EXISTS (
        SELECT 1
          FROM supabase_migrations.schema_migrations
         WHERE version = '20261027000075'
    ),
    'approved', bool_and(
        exists
        AND public_execute = false
        AND anon_execute = false
        AND authenticated_execute = authenticated_expected
    ),
    'checks', jsonb_agg(jsonb_build_object(
        'signature', signature,
        'exists', exists,
        'publicExecute', public_execute,
        'anonExecute', anon_execute,
        'authenticatedExecute', authenticated_execute,
        'authenticatedExpected', authenticated_expected
    ) ORDER BY signature)
)
FROM checks;

ROLLBACK;
