const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027000075_harden_public_function_execution.sql'), 'utf8');
const cashService = fs.readFileSync(path.join(root, 'src/services/cash-shift.service.ts'), 'utf8');
const reportService = fs.readFileSync(path.join(root, 'src/services/shift-reports.service.ts'), 'utf8');
const migration44 = fs.readFileSync(path.join(root, 'supabase/migrations/20261019000044_stabilize_counter_payments_and_cash_reconciliation.sql'), 'utf8');
const migration47 = fs.readFileSync(path.join(root, 'supabase/migrations/20261019000047_restore_visitor_entry_contract.sql'), 'utf8');
const migration60 = fs.readFileSync(path.join(root, 'supabase/migrations/20261021000060_add_configurable_cash_shift_mode.sql'), 'utf8');
const migration67 = fs.readFileSync(path.join(root, 'supabase/migrations/20261022000067_create_consumer_first_access.sql'), 'utf8');
const report = fs.readFileSync(path.join(root, 'docs/STAGE_8A3_FUNCTION_HARDENING.md'), 'utf8');
const allMigrations = fs.readdirSync(path.join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql') && !name.includes('00075_'))
  .map((name) => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8'))
  .join('\n');
const checks = [];

function check(name, condition) { checks.push([name, Boolean(condition)]); }
function hasAll(text, tokens) { return tokens.every((token) => text.includes(token)); }

const twelveNames = [
  'admin_list_cash_shifts', 'get_active_cash_shift', 'get_terminal_shift_reports',
  'record_cash_movement', 'register_visitor_entry', 'enrich_cash_movement',
  'handle_updated_at', 'refresh_cash_shift_payment_totals', 'rls_auto_enable',
  'sync_imported_consumer_identity', 'trg_prevent_profile_escalation',
  'trg_prevent_student_tampering',
];

check('migration 75 cobre as 12 funcoes do preflight', hasAll(migration, twelveNames));
check('PUBLIC e anon sao removidos de todas as assinaturas', twelveNames.every((name) => migration.includes(`public.${name}`)) && (migration.match(/FROM PUBLIC, anon/g) || []).length >= 11);
check('RPC ativa de relatorio preserva authenticated', migration.includes('GRANT EXECUTE ON FUNCTION public.get_terminal_shift_reports') && migration.includes('TO authenticated'));
check('frontend ainda usa relatorio do terminal', reportService.includes("rpc('get_terminal_shift_reports'"));
check('frontend usa overload atual de admin com meal type', cashService.includes('p_meal_type_id:') && cashService.includes("rpc('admin_list_cash_shifts'"));
check('overload legado admin nao recebe novo grant', !/GRANT EXECUTE ON FUNCTION public\.admin_list_cash_shifts\(\s*UUID, VARCHAR, DATE, DATE/s.test(migration));
check('RPCs legadas seguem fechadas para authenticated', hasAll(migration44, [
  'get_active_cash_shift(UUID, VARCHAR) FROM authenticated',
  'record_cash_movement(UUID, VARCHAR, NUMERIC, VARCHAR, TEXT) FROM authenticated',
]));
check('overload atual de visitante ja e interno', migration47.includes('REVOKE ALL ON FUNCTION public.register_visitor_entry(UUID, UUID, VARCHAR, VARCHAR)'));
check('overload atual de admin ja possui ACL explicita', migration60.includes('REVOKE ALL ON FUNCTION public.admin_list_cash_shifts(UUID, UUID, VARCHAR, DATE, DATE) FROM PUBLIC, anon'));
check('triggers permanecem associados no schema', [
  'enrich_cash_movement()', 'refresh_cash_shift_payment_totals()',
  'handle_updated_at()', 'sync_imported_consumer_identity()',
  'trg_prevent_profile_escalation()', 'trg_prevent_student_tampering()',
].every((signature) => allMigrations.includes(`EXECUTE FUNCTION public.${signature}`)));
check('trigger de identidade continua definido', migration67.includes('CREATE TRIGGER trg_import_rows_consumer_identity'));
check('drift rls_auto_enable e tratado sem quebrar schema novo', migration.includes("to_regprocedure('public.rls_auto_enable()') IS NOT NULL"));
check('pos-condicao verifica ACL efetivo de PUBLIC', migration.includes('acl.grantee = 0') && migration.includes("acl.privilege_type = 'EXECUTE'"));
check('migration nao remove funcoes ou triggers', !/\bDROP\s+(FUNCTION|TRIGGER)\b/i.test(migration));
check('migration nao altera corpos ou search_path', !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|ALTER\s+FUNCTION/i.test(migration));
check('migration nao concede service role', !/GRANT EXECUTE[\s\S]+service_role/i.test(migration));
check('migrations 72 73 e 74 nao sao modificadas pela 75', !/ALTER TABLE|CREATE POLICY|DROP POLICY|get_operational_intelligence_v1/i.test(migration));
check('relatorio registra 12 assinaturas e 20 controles', twelveNames.every((name) => report.includes(name)) && report.includes('20/20 aprovados'));
check('relatorio proibe rollback para PUBLIC', report.includes('nunca restaurar `PUBLIC` como atalho'));
check('relatorio mantem aplicacao remota em NO-GO', report.includes('NO-GO para aplicação remota e para criação da conta temporária'));

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
