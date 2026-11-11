\set ON_ERROR_STOP on

-- Parametros obrigatorios, fornecidos pelo operador via psql:
--   -v stage8a_valid_until='YYYY-MM-DD HH:MM:SS+00'
\if :{?stage8a_valid_until}
\else
  \error 'stage8a_valid_until e obrigatoria'
\endif

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

DO $stage8a_guard$
BEGIN
    IF pg_catalog.current_setting('server_version_num')::integer < 170000
       OR pg_catalog.current_setting('server_version_num')::integer >= 180000 THEN
        RAISE EXCEPTION 'STAGE8A_REQUIRES_POSTGRESQL_17';
    END IF;
    IF pg_catalog.to_regrole('ma_stage8a_auditor') IS NOT NULL THEN
        RAISE EXCEPTION 'STAGE8A_AUDITOR_ALREADY_EXISTS';
    END IF;
    IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'MIGRATION_HISTORY_NOT_FOUND';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace,
             LATERAL pg_catalog.aclexplode(COALESCE(
                 namespace.nspacl,
                 pg_catalog.acldefault('n', namespace.nspowner)
             )) AS acl
        WHERE namespace.nspname = 'public'
          AND acl.grantee = 0
          AND acl.privilege_type = 'CREATE'
    ) THEN
        RAISE EXCEPTION 'PUBLIC_CAN_CREATE_IN_PUBLIC_SCHEMA';
    END IF;
    IF EXISTS (
        SELECT 1
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
    ) THEN
        RAISE EXCEPTION 'PUBLIC_CAN_ACCESS_OPERATIONAL_TABLES';
    END IF;
    IF EXISTS (
        SELECT 1
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
    ) THEN
        RAISE EXCEPTION 'PUBLIC_CAN_EXECUTE_SENSITIVE_FUNCTIONS';
    END IF;
END;
$stage8a_guard$;

CREATE ROLE ma_stage8a_auditor
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS
    CONNECTION LIMIT 1
    PASSWORD NULL
    VALID UNTIL :'stage8a_valid_until';

-- \password evita expor o segredo na linha de comando, no repositorio ou no
-- historico do shell. O operador deve informar uma senha temporaria aleatoria.
\password ma_stage8a_auditor

ALTER ROLE ma_stage8a_auditor SET default_transaction_read_only = on;
ALTER ROLE ma_stage8a_auditor SET statement_timeout = '30s';
ALTER ROLE ma_stage8a_auditor SET lock_timeout = '2s';
ALTER ROLE ma_stage8a_auditor SET idle_in_transaction_session_timeout = '45s';

REVOKE ALL ON DATABASE :"DBNAME" FROM ma_stage8a_auditor;
REVOKE ALL ON SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ma_stage8a_auditor;

GRANT CONNECT ON DATABASE :"DBNAME" TO ma_stage8a_auditor;
GRANT USAGE ON SCHEMA supabase_migrations TO ma_stage8a_auditor;
GRANT SELECT (version) ON TABLE supabase_migrations.schema_migrations TO ma_stage8a_auditor;

COMMENT ON ROLE ma_stage8a_auditor IS
    'Temporario: inventario read-only da Etapa 8A; sem acesso a dados operacionais.';

COMMIT;
