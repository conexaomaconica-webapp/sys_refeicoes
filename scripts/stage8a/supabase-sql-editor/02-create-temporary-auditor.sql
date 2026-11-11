-- Etapa 8A.2: executar no Supabase SQL Editor somente apos revisar o preflight.
-- A senha aparece uma unica vez no resultado final. Copie-a para um canal
-- seguro e nao salve o resultado como evidencia do projeto.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

CREATE TEMP TABLE stage8a_generated_secret (
    role_name text NOT NULL,
    temporary_password text NOT NULL,
    valid_until timestamptz NOT NULL
) ON COMMIT DROP;

INSERT INTO stage8a_generated_secret (role_name, temporary_password, valid_until)
VALUES (
    'ma_stage8a_auditor',
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
        replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    pg_catalog.clock_timestamp() + interval '2 hours'
);

DO $stage8a_create$
DECLARE
    generated_password text;
    expiration timestamptz;
BEGIN
    IF pg_catalog.current_setting('server_version_num')::integer < 170000
       OR pg_catalog.current_setting('server_version_num')::integer >= 180000 THEN
        RAISE EXCEPTION 'STAGE8A_REQUIRES_POSTGRESQL_17';
    END IF;
    IF pg_catalog.current_database() <> 'postgres' THEN
        RAISE EXCEPTION 'STAGE8A_REQUIRES_POSTGRES_DATABASE';
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
        RAISE EXCEPTION 'PUBLIC_CAN_ACCESS_PUBLIC_TABLES';
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

    SELECT secret.temporary_password, secret.valid_until
    INTO generated_password, expiration
    FROM pg_temp.stage8a_generated_secret AS secret;

    EXECUTE pg_catalog.format(
        'CREATE ROLE ma_stage8a_auditor LOGIN NOSUPERUSER NOCREATEDB ' ||
        'NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS ' ||
        'CONNECTION LIMIT 1 PASSWORD %L VALID UNTIL %L',
        generated_password,
        expiration
    );
END;
$stage8a_create$;

ALTER ROLE ma_stage8a_auditor SET default_transaction_read_only = on;
ALTER ROLE ma_stage8a_auditor SET statement_timeout = '30s';
ALTER ROLE ma_stage8a_auditor SET lock_timeout = '2s';
ALTER ROLE ma_stage8a_auditor SET idle_in_transaction_session_timeout = '45s';

REVOKE ALL ON DATABASE postgres FROM ma_stage8a_auditor;
REVOKE ALL ON SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ma_stage8a_auditor;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ma_stage8a_auditor;

GRANT CONNECT ON DATABASE postgres TO ma_stage8a_auditor;
GRANT USAGE ON SCHEMA supabase_migrations TO ma_stage8a_auditor;
GRANT SELECT (version) ON TABLE supabase_migrations.schema_migrations TO ma_stage8a_auditor;

COMMENT ON ROLE ma_stage8a_auditor IS
    'Temporario: inventario read-only da Etapa 8A; expira em duas horas.';

SELECT role_name,
       temporary_password,
       valid_until,
       'COPIAR AGORA; NAO SALVAR COMO EVIDENCIA' AS handling_instruction
FROM stage8a_generated_secret;

COMMIT;
