\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Executar conectado como ma_stage8a_auditor antes do inventario.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

SELECT (
    NOT role.rolsuper
    AND NOT role.rolbypassrls
    AND NOT role.rolcreaterole
    AND NOT role.rolcreatedb
    AND NOT role.rolreplication
    AND NOT pg_catalog.has_schema_privilege(pg_catalog.current_user, 'public', 'CREATE')
    AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relkind IN ('r', 'p')
          AND (
              pg_catalog.has_table_privilege(pg_catalog.current_user, class.oid, 'SELECT')
              OR pg_catalog.has_table_privilege(
                  pg_catalog.current_user,
                  class.oid,
                  'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
          )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND (procedure.prosecdef OR procedure.provolatile = 'v')
          AND pg_catalog.has_function_privilege(
              pg_catalog.current_user,
              procedure.oid,
              'EXECUTE'
          )
    )
    AND pg_catalog.has_column_privilege(
        pg_catalog.current_user,
        'supabase_migrations.schema_migrations',
        'version',
        'SELECT'
    )
) AS stage8a_compliant
FROM pg_catalog.pg_roles AS role
WHERE role.rolname = pg_catalog.current_user
\gset

\if :stage8a_compliant
\else
  \error 'STAGE8A_AUDITOR_PRIVILEGE_CHECK_FAILED'
\endif

SELECT jsonb_build_object(
    'role', pg_catalog.current_user,
    'transactionReadOnly', pg_catalog.current_setting('transaction_read_only'),
    'migrationVersionsVisible', (
        SELECT pg_catalog.count(version)
        FROM supabase_migrations.schema_migrations
    ),
    'compliant', true
)::text;

ROLLBACK;
