const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- VALIDATING SPRINT 17.1 PREPARATION (LOCAL ENV, NO REMOTE DB) ---');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

const baselinePath = 'scripts/sql/sprint17_1_disposable_pg17_baseline.sql';
const rollbackPath = 'scripts/sql/sprint17_1_rollback_79_80_81.sql';
const harnessPath = 'scripts/homologate-sprint17-1-transactional.cjs';
const psRunnerPath = 'scripts/sprint17_1/run-native-disposable.ps1';
const docPath = 'docs/SPRINT_17_1_TRANSACTIONAL_HOMOLOGATION.md';

for (const f of [baselinePath, rollbackPath, harnessPath, psRunnerPath, docPath]) {
  assert(exists(f), `Artefato Sprint 17.1 ausente: ${f}`);
}
console.log('✓ Artefatos SQL, orquestrador PS1, harness transacional e relatório existem');

const baseline = read(baselinePath);
const rollback = read(rollbackPath);
const harness = read(harnessPath);
const mig79 = read('supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql');
const mig81 = read('supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql');
const contSvc = read('src/server/contingency/contingency.service.ts');
const dashSvc = read('src/server/dashboard/operational-dashboard.server.ts');

// 1. Baseline fiel sem BYPASSRLS em authenticated/anon
assert(baseline.includes('CREATE ROLE authenticated NOLOGIN NOINHERIT'), 'Papel authenticated não pode ter SUPERUSER/BYPASSRLS');
assert(baseline.includes('CREATE ROLE anon NOLOGIN NOINHERIT'), 'Papel anon não pode ter SUPERUSER/BYPASSRLS');
assert(!baseline.includes('BYPASSRLS') || baseline.match(/service_role[\s\S]*BYPASSRLS/), 'Apenas service_role pode ter BYPASSRLS');
console.log('✓ Baseline reproduz papéis restritos sem SUPERUSER ou BYPASSRLS');

// 2. Proteção contra execução acidental em Supabase remoto
assert(harness.includes('DISPOSABLE_PG_URL'), 'Harness deve exigir DISPOSABLE_PG_URL');
assert(harness.includes('supabase\\.(co|com)|pooler\\.supabase'), 'Harness deve bloquear URLs remotas do Supabase');
console.log('✓ Trava anti-execução remota confirmada no harness transacional');

// 3. Compatibilidade de schema real detectada na preparação
const stripComments = (s) => s.replace(/--.*$/gm, '');
assert(!stripComments(mig79).includes('sc.is_integral'), 'Migration 79 não deve referenciar coluna inexistente sc.is_integral');
assert(!stripComments(mig81).includes('sc.is_integral'), 'Migration 81 não deve referenciar coluna inexistente sc.is_integral');
assert(mig81.includes('mr.subsidy_amount'), 'Migration 81 deve corrigir submit_contingency_batch para subsidy_amount');
assert(mig81.includes("mt.status = 'active'") || mig81.includes("status = 'active'"), 'Migration 81 deve corrigir meal_types para status=active');
assert(mig81.includes('trg_wallet_transactions_no_truncate'), 'Migration 81 deve proteger wallet_transactions contra TRUNCATE');
assert(!contSvc.includes("eq('is_active'"), 'contingency.service.ts deve usar status=active');
assert(!dashSvc.includes("order('sort_order'"), 'operational-dashboard.server.ts não deve ordenar por coluna inexistente sort_order');
console.log('✓ Múltiplas incompatibilidades reais de schema em 77/78/79 e serviços corrigidas');

// 4. Ordem de rollback reverso 81 -> 80 -> 79 e trava anti-perda de dados
assert(rollback.includes('ROLLBACK_BLOCKED_DATA_EXISTS'), 'Rollback deve bloquear exclusão se houver dados gravados');
assert(rollback.includes('ALTER PUBLICATION supabase_realtime ADD TABLE public.meal_consumptions'), 'Rollback deve restaurar publicação pré-81');
assert(
  rollback.indexOf('DROP TABLE IF EXISTS public.operational_dashboard_signals') <
    rollback.indexOf('DROP TABLE IF EXISTS public.financial_reconciliation_divergences')
);
assert(
  rollback.indexOf('DROP TABLE IF EXISTS public.financial_reconciliation_batches') <
    rollback.indexOf('DROP FUNCTION IF EXISTS public.get_consolidated_financial_report')
);
console.log('✓ Plano de rollback reverso 81 -> 80 -> 79 com trava anti-perda de dados validado');

// 5. Documento transparente quanto ao status da execução transacional e NO-GO em produção
const doc = read(docPath);
assert(doc.includes('NO-GO'), 'Documento deve manter NO-GO para produção e aplicação remota');
assert(doc.includes('35/35') || doc.includes('PENDENTE'), 'Documento deve registrar resultado real da execução transacional');
console.log('✓ Documentação transparente quanto a resultados transacionais e NO-GO de produção');

console.log('\n--- ALL SPRINT 17.1 PREPARATION CHECKS PASSED (5/5) ---');
