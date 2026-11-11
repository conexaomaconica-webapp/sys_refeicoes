-- Etapa 8A.2: preflight para o Supabase SQL Editor.
-- Nao cria nem altera objetos. Revise o JSON antes de executar o passo 02.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

SELECT jsonb_pretty(jsonb_build_object(
    'serverVersionNum', pg_catalog.current_setting('server_version_num')::integer,
    'database', pg_catalog.current_database(),
    'auditorRoleAlreadyExists', pg_catalog.to_regrole('ma_stage8a_auditor') IS NOT NULL,
    'migrationHistoryExists',
        pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'migrationVersionColumnExists', EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
          AND attribute.attname = 'version'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
    ),
    'publicCanCreateInPublicSchema', EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace,
             LATERAL pg_catalog.aclexplode(COALESCE(
                 namespace.nspacl,
                 pg_catalog.acldefault('n', namespace.nspowner)
             )) AS acl
        WHERE namespace.nspname = 'public'
          AND acl.grantee = 0
          AND acl.privilege_type = 'CREATE'
    ),
    'publicTablePrivileges', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'relation', namespace.nspname || '.' || class.relname,
            'privilege', acl.privilege_type
        ) ORDER BY class.relname, acl.privilege_type)
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace,
             LATERAL pg_catalog.aclexplode(COALESCE(
                 class.relacl,
                 pg_catalog.acldefault('r', class.relowner)
             )) AS acl
        WHERE namespace.nspname = 'public'
          AND class.relkind IN ('r', 'p')
          AND acl.grantee = 0
          AND acl.privilege_type = ANY (ARRAY[
              'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
              'REFERENCES', 'TRIGGER'
          ])
    ), '[]'::jsonb),
    'publicSensitiveExecutables', COALESCE((
        SELECT jsonb_agg(
            namespace.nspname || '.' || procedure.proname ||
            '(' || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')'
            ORDER BY procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid)
        )
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND (procedure.prosecdef OR procedure.provolatile = 'v')
          AND EXISTS (
              SELECT 1
              FROM pg_catalog.aclexplode(COALESCE(
                  procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner)
              )) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
          )
    ), '[]'::jsonb)
)) AS stage8a_preflight;

ROLLBACK;
