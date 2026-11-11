const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- VALIDATING SPRINT 16: FINANCIAL RECONCILIATION & DAILY CLOSINGS ---');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const migrationPath = 'supabase/migrations/20261109000080_create_financial_reconciliation.sql';
const typesPath = 'src/types/reconciliation.ts';
const enginePath = 'src/lib/reconciliation/reconciliation-engine.ts';
const excelLibPath = 'src/lib/reports/reconciliation-excel.ts';
const serverServicePath = 'src/server/reconciliation/reconciliation.server.ts';
const exportRoutePath = 'src/app/api/admin/conciliacao/export/route.ts';
const actionsPath = 'src/app/admin/conciliacao/actions.ts';
const pagePath = 'src/app/admin/conciliacao/page.tsx';
const componentPath = 'src/components/admin/ReconciliationDashboard.tsx';
const docPath = 'docs/SPRINT_16_FINANCIAL_RECONCILIATION.md';
const shellPath = 'src/components/admin/AdminShell.tsx';
const adminHomePath = 'src/app/admin/page.tsx';

// 1. Arquivos Essenciais da Sprint 16
const requiredFiles = [
  migrationPath,
  typesPath,
  enginePath,
  excelLibPath,
  serverServicePath,
  exportRoutePath,
  actionsPath,
  pagePath,
  componentPath,
  docPath,
];

for (const f of requiredFiles) {
  assert(exists(f), `Arquivo obrigatório da Sprint 16 não encontrado: ${f}`);
}
console.log('✓ Todos os 10 arquivos essenciais da Sprint 16 existem');

// 2. Integridade e Segurança da Migration 80
const migrationSql = read(migrationPath);
assert(migrationSql.includes('financial_reconciliation_batches'), 'Deve criar financial_reconciliation_batches');
assert(migrationSql.includes('financial_reconciliation_divergences'), 'Deve criar financial_reconciliation_divergences');
assert(migrationSql.includes('financial_daily_closings'), 'Deve criar financial_daily_closings');
assert(migrationSql.includes('run_financial_reconciliation_audit'), 'Deve criar RPC run_financial_reconciliation_audit');
assert(migrationSql.includes('SECURITY DEFINER'), 'RPC de conciliação deve ser SECURITY DEFINER');
assert(
  migrationSql.includes("search_path = ''") || migrationSql.includes('search_path = public, pg_temp'),
  'RPC de conciliação deve ter search_path restrito'
);
assert(migrationSql.includes('ENABLE ROW LEVEL SECURITY'), 'RLS deve estar habilitada');
assert(migrationSql.includes("RAISE EXCEPTION 'AUTH_REQUIRED"), 'RPC deve exigir autenticação');
assert(migrationSql.includes("RAISE EXCEPTION 'PERMISSION_DENIED"), 'RPC deve restringir papéis');
assert(migrationSql.includes("RAISE EXCEPTION 'TENANT_MISMATCH"), 'RPC deve validar tenant');
assert(!migrationSql.includes('DROP TABLE'), 'Migration não deve apagar tabelas');
console.log('✓ Migration 80 e segurança da RPC validadas com sucesso');

// 3. Contratos e Tipos TypeScript
const typesCode = read(typesPath);
assert(typesCode.includes('ReconciliationBatch'), 'Deve declarar ReconciliationBatch');
assert(typesCode.includes('ReconciliationDivergence'), 'Deve declarar ReconciliationDivergence');
assert(typesCode.includes('DailyClosingSummary'), 'Deve declarar DailyClosingSummary');
assert(typesCode.includes('ReconciliationKPIs'), 'Deve declarar ReconciliationKPIs');
assert(typesCode.includes('missing_ledger_credit'), 'Deve conter missing_ledger_credit');
assert(typesCode.includes('orphan_ledger_credit'), 'Deve conter orphan_ledger_credit');
assert(typesCode.includes('amount_mismatch'), 'Deve conter amount_mismatch');
console.log('✓ Contratos de tipos da conciliação financeira validados');

// 4. Motor Puro e Proteção de Exportação
const engineCode = read(enginePath);
const excelCode = read(excelLibPath);
const serverCode = read(serverServicePath);

assert(engineCode.includes('auditPaymentTransactions'), 'Motor deve conter auditPaymentTransactions');
assert(engineCode.includes('computeDailyClosingSheet'), 'Motor deve conter computeDailyClosingSheet');
assert(excelCode.includes('sanitizeCellForExport'), 'Exportação Excel deve usar sanitizeCellForExport');
assert(excelCode.includes('Resumo Conciliação'), 'Planilha deve conter aba Resumo Conciliação');
assert(excelCode.includes('Divergências'), 'Planilha deve conter aba Divergências');
assert(excelCode.includes('Fechamento Diário'), 'Planilha deve conter aba Fechamento Diário');
assert(serverCode.includes('server-only'), 'Servidor de conciliação deve ser server-only');
assert(serverCode.includes('resolveDivergenceActionServer'), 'Servidor deve fornecer resolução de divergência');
console.log('✓ Motor de conciliação, segregação diária e proteção de exportação validados');

// 5. Interface e Componentes Administrativos
const componentCode = read(componentPath);
assert(componentCode.includes('Conciliação Financeira Automática'), 'UI deve ter título de conciliação');
assert(componentCode.includes('Taxa de Conciliação'), 'UI deve apresentar taxa de conciliação');
assert(componentCode.includes('Divergências Abertas'), 'UI deve listar divergências');
assert(componentCode.includes('Fechamento Diário Consolidado'), 'UI deve ter aba de fechamento diário');
assert(componentCode.includes('/api/admin/conciliacao/export'), 'UI deve conter link de exportação');
console.log('✓ Componente ReconciliationDashboard e modal de auditoria validados');

// 6. Integração na Navegação
const shellCode = read(shellPath);
assert(shellCode.includes('/admin/conciliacao'), 'AdminShell deve conter navegação para /admin/conciliacao');
assert(shellCode.includes('Conciliação e fechamento'), 'AdminShell deve ter rótulo da conciliação');

const adminHomeCode = read(adminHomePath);
assert(adminHomeCode.includes('/admin/conciliacao'), 'Página inicial /admin deve conter card de Conciliação');
console.log('✓ Navegação e rotas administrativas integradas');

// 7. Documento Técnico da Sprint 16
const docContent = read(docPath);
assert(docContent.includes('SPRINT 16'), 'Documento deve conter cabeçalho da Sprint 16');
assert(docContent.includes('missing_ledger_credit'), 'Documento deve registrar a regra de missing_ledger_credit');
assert(docContent.includes('orphan_ledger_credit'), 'Documento deve registrar a regra de orphan_ledger_credit');
assert(docContent.includes('NO-GO'), 'Documento deve registrar NO-GO para produção');
console.log('✓ Documento SPRINT_16_FINANCIAL_RECONCILIATION.md validado');

console.log('\n--- ALL SPRINT 16 VALIDATION CHECKS PASSED (7/7) ---');

