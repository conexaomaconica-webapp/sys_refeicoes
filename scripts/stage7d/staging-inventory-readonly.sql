-- Etapa 7D.4: inventario sanitizado e estritamente read-only.
-- Compativel com Supabase SQL Editor: nao contem metacomandos do psql.
-- Executar somente no ambiente expressamente autorizado e preservar apenas a
-- unica linha JSON sanitizada produzida.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '45s';

SELECT jsonb_build_object(
    'contractVersion', 1,
    'capturedAt', pg_catalog.clock_timestamp(),
    'database', pg_catalog.current_database(),
    'serverVersionNum', pg_catalog.current_setting('server_version_num')::integer,
    'session', (
        SELECT jsonb_build_object(
            'currentUser', current_user,
            'isSuperuser', role.rolsuper,
            'bypassRls', role.rolbypassrls
        )
        FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
    ),
    'migrations', COALESCE((
        SELECT jsonb_agg(migration.version ORDER BY migration.version)
        FROM supabase_migrations.schema_migrations AS migration
        WHERE migration.version IN ('20261026000072', '20261026000073', '20261027000074')
    ), '[]'::jsonb),
    'relations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', namespace.nspname || '.' || class.relname,
            'kind', class.relkind,
            'rlsEnabled', class.relrowsecurity,
            'rlsForced', class.relforcerowsecurity,
            'owner', pg_catalog.pg_get_userbyid(class.relowner),
            'estimatedRows', class.reltuples::bigint
        ) ORDER BY namespace.nspname, class.relname)
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relname = ANY (ARRAY[
              'offline_contingency_events', 'institutions', 'profiles',
              'user_institution_access', 'user_unit_access', 'students',
              'wallets', 'wallet_transactions', 'payments', 'recharges',
              'cash_shifts', 'cash_movements', 'units',
              'meal_consumptions', 'student_categories'
          ])
    ), '[]'::jsonb),
    'columns', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'relation', namespace.nspname || '.' || class.relname,
            'name', attribute.attname,
            'dataType', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
            'udtName', type.typname,
            'nullable', NOT attribute.attnotnull,
            'default', pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
        ) ORDER BY class.relname, attribute.attnum)
        FROM pg_catalog.pg_attribute AS attribute
        JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
        JOIN pg_catalog.pg_type AS type ON type.oid = attribute.atttypid
        LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
          ON attribute_default.adrelid = attribute.attrelid
         AND attribute_default.adnum = attribute.attnum
        WHERE namespace.nspname = 'public'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND class.relname = ANY (ARRAY[
              'offline_contingency_events', 'institutions', 'profiles',
              'user_institution_access', 'user_unit_access', 'students',
              'wallets', 'wallet_transactions', 'payments', 'recharges',
              'cash_shifts', 'cash_movements', 'units',
              'meal_consumptions', 'student_categories'
          ])
    ), '[]'::jsonb),
    'constraints', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'relation', namespace.nspname || '.' || class.relname,
            'name', constraint_info.conname,
            'type', constraint_info.contype,
            'validated', constraint_info.convalidated,
            'definition', pg_catalog.pg_get_constraintdef(constraint_info.oid, true)
        ) ORDER BY class.relname, constraint_info.conname)
        FROM pg_catalog.pg_constraint AS constraint_info
        JOIN pg_catalog.pg_class AS class ON class.oid = constraint_info.conrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relname = ANY (ARRAY[
              'offline_contingency_events', 'institutions', 'profiles',
              'user_institution_access', 'user_unit_access', 'students',
              'wallets', 'wallet_transactions', 'payments', 'recharges',
              'cash_shifts', 'cash_movements', 'units',
              'meal_consumptions', 'student_categories'
          ])
    ), '[]'::jsonb),
    'policies', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'relation', policy.schemaname || '.' || policy.tablename,
            'name', policy.policyname,
            'command', policy.cmd,
            'roles', policy.roles,
            'permissive', policy.permissive,
            'using', policy.qual,
            'withCheck', policy.with_check
        ) ORDER BY policy.tablename, policy.policyname)
        FROM pg_catalog.pg_policies AS policy
        WHERE policy.schemaname = 'public'
          AND policy.tablename = ANY (ARRAY[
              'offline_contingency_events', 'students', 'wallets',
              'wallet_transactions', 'payments', 'recharges',
              'cash_shifts', 'cash_movements', 'meal_consumptions'
          ])
    ), '[]'::jsonb),
    'functions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'identity', namespace.nspname || '.' || procedure.proname ||
                '(' || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',
            'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
            'securityDefiner', procedure.prosecdef,
            'volatility', procedure.provolatile,
            'configuration', procedure.proconfig,
            'acl', procedure.proacl,
            'definitionMd5', pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
        ) ORDER BY procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid))
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = ANY (ARRAY[
              'get_auth_tenant_id', 'get_auth_user_status', 'get_auth_user_role',
              'has_unit_access', 'can_manage_students_at_institution',
              'reconcile_offline_consumptions', 'get_terminal_shift_snapshot',
              'get_operational_intelligence_v1'
          ])
    ), '[]'::jsonb),
    'indexes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'relation', index_info.schemaname || '.' || index_info.tablename,
            'name', index_info.indexname,
            'definition', index_info.indexdef
        ) ORDER BY index_info.tablename, index_info.indexname)
        FROM pg_catalog.pg_indexes AS index_info
        WHERE index_info.schemaname = 'public'
          AND index_info.tablename IN ('offline_contingency_events', 'meal_consumptions')
    ), '[]'::jsonb)
)::text;

ROLLBACK;
