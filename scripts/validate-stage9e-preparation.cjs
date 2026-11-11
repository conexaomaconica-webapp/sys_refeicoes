const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const master = read('docs/STAGE_9E_LOCAL_PREPARATION.md');
const backup = read('docs/STAGE_9E1_BACKUP_RESTORE_RUNBOOK.md');
const payments = read('docs/STAGE_9E2_PAYMENT_SANDBOX_PLAN.md');
const isolation = read('docs/STAGE_9E3_MULTIUNIT_ISOLATION_MATRIX.md');
const rollback = read('docs/STAGE_9E4_HOSTED_ROLLBACK_RUNBOOK.md');
const physical = read('docs/STAGE_9E5_PHYSICAL_ACCEPTANCE_CHECKLIST.md');
const evidenceValidator = read('scripts/stage9e/validate-evidence.cjs');
const packageJson = JSON.parse(read('package.json'));

const templates = [
  '9e1-backup-restore.template.json',
  '9e2-payment-sandbox.template.json',
  '9e3-multiunit-isolation.template.json',
  '9e4-hosted-rollback.template.json',
  '9e5-physical-acceptance.template.json',
].map((file) => `docs/evidence/stage9e/templates/${file}`);

const checks = [
  ['plano mestre existe', exists('docs/STAGE_9E_LOCAL_PREPARATION.md')],
  ['cinco runbooks existem', [backup, payments, isolation, rollback, physical].every(Boolean)],
  ['execuções externas permanecem não autorizadas', master.includes('não autorizada') && master.includes('0/5 homologações externas executadas')],
  ['autorizações são independentes', master.includes('Nenhuma autorização de uma frente implica autorização das demais')],
  ['evidências proíbem segredos e dados operacionais', master.includes('Credenciais') && master.includes('dados operacionais')],
  ['backup exige projeto novo isolado', backup.includes('projeto novo') && backup.includes('nunca sobre o único projeto operacional')],
  ['backup trata Storage separadamente', backup.includes('Storage') && backup.includes('mecanismo independente')],
  ['backup contém risco de extensões externas', backup.includes('pg_cron') && backup.includes('pg_net')],
  ['backup define RPO de 15 minutos', backup.includes('≤ 15 minutos')],
  ['backup define RTO de 4 horas', backup.includes('≤ 4 horas')],
  ['backup exige 31 cenários RLS', backup.includes('31/31')],
  ['backup exige origem intacta', backup.includes('alterações na origem') && backup.includes('zero')],
  ['pagamentos exigem credenciais de teste', payments.includes('credenciais de teste')],
  ['pagamentos impedem crédito antecipado', payments.includes('sem crédito antecipado')],
  ['pagamentos cobrem assinatura inválida', payments.includes('assinatura inválida') && payments.includes('HTTP 401')],
  ['pagamentos cobrem segredo ausente', payments.includes('segredo ausente') && payments.includes('falha fechada')],
  ['pagamentos cobrem idempotência', payments.includes('event_id') && payments.includes('uma única vez')],
  ['pagamentos cobrem eventos fora de ordem', payments.includes('eventos fora de ordem')],
  ['pagamentos cobrem indisponibilidade', payments.includes('indisponibilidade do gateway')],
  ['pagamentos exigem 14/14', payments.includes('14/14')],
  ['isolamento exige duas unidades', isolation.includes('duas unidades distintas')],
  ['isolamento proíbe bypass RLS', isolation.includes('BYPASSRLS') && isolation.includes('SUPERUSER')],
  ['isolamento cobre perfis operacionais', ['operador', 'gerente de unidade', 'supervisor'].every((role) => isolation.includes(role))],
  ['isolamento cobre recursos financeiros', isolation.includes('carteiras, recargas, pagamentos e ledger')],
  ['isolamento cobre RPC definer', isolation.includes('SECURITY DEFINER')],
  ['isolamento define vazamento como crítico', isolation.includes('falha crítica')],
  ['rollback exige ambiente isolado', rollback.includes('ambiente isolado')],
  ['rollback separa versões A e B', rollback.includes('A (conhecida)') && rollback.includes('B (candidata)')],
  ['rollback proíbe migration no exercício', rollback.includes('nenhuma migration')],
  ['rollback distingue aplicação e banco', rollback.includes('não foram revertidos')],
  ['rollback define RTO de 30 minutos', rollback.includes('≤ 30 minutos')],
  ['rollback possui critérios de interrupção', rollback.includes('Critérios de interrupção')],
  ['aceite físico inventaria equipamentos', physical.includes('scanner') && physical.includes('impressora')],
  ['aceite físico cobre 16 casos', physical.includes('16/16')],
  ['aceite físico exige fail-closed', physical.includes('fail-closed')],
  ['aceite físico não cria fila offline', physical.includes('nenhuma fila')],
  ['aceite físico mede p50 p95 p99', ['p50', 'p95', 'p99'].every((metric) => physical.includes(metric))],
  ['aceite físico mantém p95 em 400ms', physical.includes('p95 ≤ 400 ms')],
  ['cinco templates existem', templates.every(exists)],
  ['templates estão marcados não executados', templates.every((file) => JSON.parse(read(file)).executionStatus === 'not_executed')],
  ['templates ficam em NO-GO', templates.every((file) => JSON.parse(read(file)).decision === 'NO_GO_NOT_EXECUTED')],
  ['templates registram zero conexão remota', templates.every((file) => JSON.parse(read(file)).remoteConnectionsPerformed === 0)],
  ['templates registram zero transação real', templates.every((file) => JSON.parse(read(file)).realFinancialTransactionsPerformed === 0)],
  ['validador não possui cliente remoto', !/(fetch\s*\(|createClient|SUPABASE_|vercel\s|pg_dump|spawn\s*\(|exec\s*\()/.test(evidenceValidator)],
  ['validador bloqueia URLs e segredos', evidenceValidator.includes('forbiddenValuePatterns')],
  ['script de preparação está registrado', packageJson.scripts['validate:stage9e-prep'] === 'node scripts/validate-stage9e-preparation.cjs && node scripts/stage9e/validate-evidence.cjs'],
  ['build estabilizado não foi alterado pela preparação', read('next.config.mjs').includes('webpackBuildWorker: true') && read('next.config.mjs').includes('webpackMemoryOptimizations: true')],
  ['produção permanece NO-GO', master.includes('NO-GO para execução externa e publicação')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
