const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const paths = {
  migration: 'supabase/migrations/20261027000075_harden_public_function_execution.sql',
  preapply: 'scripts/stage8a/05-migration75-preapply-readonly.sql',
  postapply: 'scripts/stage8a/06-migration75-postapply-readonly.sql',
  report: 'docs/STAGE_8A5_REMOTE_READINESS_REVIEW.md',
  shiftService: 'src/services/shift-reports.service.ts',
  cashService: 'src/services/cash-shift.service.ts',
};
const contents = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), 'utf8')]));
const checks = [];
function check(name, condition) { checks.push({ name, passed: Boolean(condition) }); console.log(`${condition ? 'PASS' : 'FAIL'} ${String(checks.length).padStart(2, '0')} ${name}`); }
const forbiddenWrite = /^\s*(?:alter|create|delete|do|drop|grant|insert|notify|revoke|truncate|update)\b/im;
const targets = [
  'admin_list_cash_shifts', 'get_active_cash_shift', 'get_terminal_shift_reports',
  'record_cash_movement', 'register_visitor_entry', 'enrich_cash_movement',
  'handle_updated_at', 'refresh_cash_shift_payment_totals', 'rls_auto_enable',
  'sync_imported_consumer_identity', 'trg_prevent_profile_escalation',
  'trg_prevent_student_tampering',
];

check('snapshot pre-apply e estritamente read-only', contents.preapply.includes('BEGIN TRANSACTION READ ONLY') && contents.preapply.includes('ROLLBACK;') && !forbiddenWrite.test(contents.preapply));
check('verificacao post-apply e estritamente read-only', contents.postapply.includes('BEGIN TRANSACTION READ ONLY') && contents.postapply.includes('ROLLBACK;') && !forbiddenWrite.test(contents.postapply));
check('snapshot cobre as 12 assinaturas', targets.every((name) => contents.preapply.includes(name)));
check('pos-verificacao cobre as 12 assinaturas', targets.every((name) => contents.postapply.includes(name)));
check('snapshot registra owner e SECURITY DEFINER', contents.preapply.includes("'owner'") && contents.preapply.includes("'securityDefiner'"));
check('snapshot registra hash sem expor corpo', contents.preapply.includes("'definitionMd5'") && !contents.preapply.includes("'definitionBody'"));
check('snapshot registra configuracao e search_path efetivo', contents.preapply.includes("'configuration'"));
check('snapshot registra triggers comuns e de evento', contents.preapply.includes("'triggers'") && contents.preapply.includes("'eventTriggers'"));
check('snapshot registra ACL dos tres papeis', ['publicExecute','anonExecute','authenticatedExecute'].every((name) => contents.preapply.includes(`'${name}'`)));
check('post-check exige somente RPC ativa para authenticated', contents.postapply.includes("('public.get_terminal_shift_reports(uuid,uuid,text)', true)") && (contents.postapply.match(/, false\)/g) || []).length === 11);
check('migration continua sem DDL destrutivo', !/^\s*(?:drop|alter)\s+(?:function|trigger|table)\b/im.test(contents.migration));
check('migration nao restaura PUBLIC', !/GRANT\s+EXECUTE[\s\S]*?TO\s+PUBLIC/i.test(contents.migration));
check('frontend usa somente RPC ativa entre assinaturas alvo', contents.shiftService.includes("rpc('get_terminal_shift_reports'") && !contents.cashService.includes("rpc('get_active_cash_shift'") && !contents.cashService.includes("rpc('record_cash_movement'") && !contents.cashService.includes("rpc('register_visitor_entry'"));
check('frontend usa overload atual de admin com meal type', contents.cashService.includes("rpc('admin_list_cash_shifts'") && contents.cashService.includes('p_meal_type_id:'));
check('relatorio separa hardening de conta auditora', contents.report.toLowerCase().includes('autorizações independentes') && contents.report.includes('Conta temporaria'));
check('relatorio proibe rollback para PUBLIC', contents.report.includes('Nunca conceder novamente a `PUBLIC`'));
check('relatorio exige snapshot antes de aplicacao', contents.report.includes('05-migration75-preapply-readonly.sql'));
check('relatorio mantem Supabase em NO-GO', contents.report.includes('NO-GO para aplicar a migration 75 no Supabase'));

const failed = checks.filter((item) => !item.passed).length;
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
