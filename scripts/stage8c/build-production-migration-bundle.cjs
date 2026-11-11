const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..', '..');
const migrationFiles = [
  'supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql',
  'supabase/migrations/20261026000073_harden_scoped_read_policies.sql',
  'supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql',
];
const outputPath = path.join(
  root,
  'scripts/stage8c/supabase-sql-editor/02-apply-production-migrations-72-74.sql',
);

const migrations = migrationFiles.map((relativePath) => {
  const sql = fs.readFileSync(path.join(root, relativePath), 'utf8').trim();
  return {
    relativePath,
    sql,
    sha256: crypto.createHash('sha256').update(`${sql}\n`).digest('hex'),
  };
});

const preflight = `
DO $stage8c_preflight$
DECLARE
    v_version integer := current_setting('server_version_num')::integer;
    v_relation text;
    v_function text;
    v_invalid_statuses bigint;
BEGIN
    IF v_version < 170000 OR v_version >= 180000 THEN
        RAISE EXCEPTION 'Etapa 8C exige PostgreSQL 17; encontrado %.', v_version;
    END IF;

    FOREACH v_relation IN ARRAY ARRAY[
        'public.offline_contingency_events',
        'public.institutions',
        'public.profiles',
        'public.user_institution_access',
        'public.user_unit_access',
        'public.students',
        'public.wallets',
        'public.wallet_transactions',
        'public.payments',
        'public.recharges',
        'public.cash_shifts',
        'public.cash_movements',
        'public.units',
        'public.meal_consumptions',
        'public.student_categories'
    ] LOOP
        IF to_regclass(v_relation) IS NULL THEN
            RAISE EXCEPTION 'Relação obrigatória ausente: %.', v_relation;
        END IF;
    END LOOP;

    FOREACH v_function IN ARRAY ARRAY[
        'public.get_auth_tenant_id()',
        'public.get_auth_user_role()',
        'public.get_auth_user_status()',
        'public.has_unit_access(uuid)',
        'public.reconcile_offline_consumptions(jsonb)',
        'public.get_terminal_shift_snapshot(uuid)'
    ] LOOP
        IF to_regprocedure(v_function) IS NULL THEN
            RAISE EXCEPTION 'Função obrigatória ausente: %.', v_function;
        END IF;
    END LOOP;

    IF to_regprocedure(
        'public.get_operational_intelligence_v1(date,date,date,date,uuid[],uuid[],uuid[])'
    ) IS NOT NULL THEN
        RAISE EXCEPTION 'RPC da migration 74 já existe sem histórico reconciliado.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM supabase_migrations.schema_migrations
         WHERE version IN ('20261026000072', '20261026000073', '20261027000074')
    ) THEN
        RAISE EXCEPTION 'Uma migration 72–74 já consta no histórico; interromper para reconciliar.';
    END IF;

    SELECT count(*)
      INTO v_invalid_statuses
      FROM public.offline_contingency_events
     WHERE status NOT IN (
        'pending',
        'received',
        'confirmed_regular',
        'conflict_duplicate',
        'pending_administrative_review',
        'failed_irrecoverable'
     );

    IF v_invalid_statuses <> 0 THEN
        RAISE EXCEPTION 'Existem % eventos offline com status incompatível.', v_invalid_statuses;
    END IF;
END
$stage8c_preflight$;
`;

const postflight = `
DO $stage8c_postflight$
DECLARE
    v_offline_policies text[];
    v_rpc regprocedure :=
        to_regprocedure('public.get_operational_intelligence_v1(date,date,date,date,uuid[],uuid[],uuid[])');
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.offline_contingency_events'::regclass
           AND conname = 'chk_offline_events_status'
           AND convalidated
    ) THEN
        RAISE EXCEPTION 'Constraint offline esperada não foi validada.';
    END IF;

    SELECT array_agg(policyname ORDER BY policyname)
      INTO v_offline_policies
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'offline_contingency_events';

    IF v_offline_policies IS DISTINCT FROM ARRAY['sel_offline_events_scoped_staff']::text[] THEN
        RAISE EXCEPTION 'Policies offline divergentes após migration 72: %.', v_offline_policies;
    END IF;

    IF has_function_privilege('anon', 'public.reconcile_offline_consumptions(jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.reconcile_offline_consumptions(jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_terminal_shift_snapshot(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.get_terminal_shift_snapshot(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'RPCs offline legadas continuam executáveis por clientes.';
    END IF;

    IF to_regprocedure('public.can_manage_students_at_institution(uuid)') IS NULL THEN
        RAISE EXCEPTION 'Função de escopo institucional da migration 73 ausente.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'students'
           AND policyname = 'sel_students'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'cash_movements'
           AND policyname = 'cash_movements_select_policy'
    ) THEN
        RAISE EXCEPTION 'Policies obrigatórias da migration 73 ausentes.';
    END IF;

    IF v_rpc IS NULL THEN
        RAISE EXCEPTION 'RPC operacional da migration 74 ausente.';
    END IF;

    -- Se PUBLIC mantivesse EXECUTE, o papel anon também teria privilégio efetivo.
    IF has_function_privilege('anon', v_rpc, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_rpc, 'EXECUTE') THEN
        RAISE EXCEPTION 'ACL da RPC operacional diverge do contrato.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc
         WHERE oid = v_rpc
           AND prosecdef
           AND provolatile = 's'
           AND EXISTS (
               SELECT 1
                 FROM unnest(proconfig) AS setting(value)
                WHERE setting.value IN ('search_path=', 'search_path=""')
           )
    ) THEN
        RAISE EXCEPTION 'Segurança, volatilidade ou search_path da RPC operacional diverge.';
    END IF;
END
$stage8c_postflight$;
`;

const header = `-- GERADO. Não editar manualmente.
-- Etapa 8C: aplicação atômica autorizada no projeto oficial.
-- Ordem: 72 -> 73 -> 74. A migration 75 não é reaplicada.
-- Gerado por scripts/stage8c/build-production-migration-bundle.cjs
${migrations.map((item) => `-- SHA-256 ${item.relativePath}: ${item.sha256}`).join('\n')}

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '180s';
${preflight}`;

const body = migrations
  .map((item) => `\n-- BEGIN ${item.relativePath}\n${item.sql}\n-- END ${item.relativePath}\n`)
  .join('\n');

const footer = `${postflight}
COMMIT;

SELECT jsonb_build_object(
    'approved', true,
    'serverVersionNum', current_setting('server_version_num')::integer,
    'offlinePolicies', (
        SELECT jsonb_agg(policyname ORDER BY policyname)
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'offline_contingency_events'
    ),
    'operationalRpcExists',
        to_regprocedure('public.get_operational_intelligence_v1(date,date,date,date,uuid[],uuid[],uuid[])') IS NOT NULL,
    'migrationHistoryRecorded', EXISTS (
        SELECT 1
          FROM supabase_migrations.schema_migrations
         WHERE version IN ('20261026000072', '20261026000073', '20261027000074')
    )
);
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${header}${body}${footer}`, 'utf8');
console.log(path.relative(root, outputPath));
console.log(migrations.map((item) => `${path.basename(item.relativePath)} ${item.sha256}`).join('\n'));
