const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- VALIDATING SPRINT 15: FINANCIAL REPORTING & SUBSIDY INVOICING ---');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const migrationPath = 'supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql';
const typesPath = 'src/types/financial-reporting.ts';
const serverServicePath = 'src/server/reports/financial-reporting.server.ts';
const excelLibPath = 'src/lib/reports/financial-excel.ts';
const componentPath = 'src/components/admin/FinancialReportingDashboard.tsx';
const pagePath = 'src/app/admin/relatorios/page.tsx';
const exportRoutePath = 'src/app/api/admin/relatorios/export/route.ts';
const docPath = 'docs/SPRINT_15_FINANCIAL_REPORTING.md';
const shellPath = 'src/components/admin/AdminShell.tsx';
const adminHomePath = 'src/app/admin/page.tsx';

// 1. Arquivos Essenciais
const files = [
  migrationPath,
  typesPath,
  serverServicePath,
  componentPath,
  pagePath,
  exportRoutePath,
  docPath,
];

for (const f of files) {
  assert(exists(f), `Arquivo essencial da Sprint 15 não encontrado: ${f}`);
}
console.log('✓ Todos os arquivos da Sprint 15 existem');

// 2. Integridade e Segurança da Migration 79
const migrationSql = read(migrationPath);
assert(migrationSql.includes('get_consolidated_financial_report'), 'Migration deve criar get_consolidated_financial_report');
assert(migrationSql.includes('SECURITY DEFINER'), 'RPC deve rodar como SECURITY DEFINER');
assert(
  migrationSql.includes("search_path = ''") || migrationSql.includes('search_path = public, pg_temp'),
  'RPC deve ter search_path restrito'
);
assert(migrationSql.includes("RAISE EXCEPTION 'AUTH_REQUIRED"), 'RPC deve exigir auth');
assert(migrationSql.includes("RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED"), 'RPC deve exigir perfil ativo');
assert(migrationSql.includes("RAISE EXCEPTION 'PERMISSION_DENIED"), 'RPC deve restringir papéis');
assert(migrationSql.includes("RAISE EXCEPTION 'TENANT_MISMATCH"), 'RPC deve validar tenant');
assert(migrationSql.includes('has_unit_access'), 'RPC deve validar escopo de unidade');
assert(!migrationSql.includes('DROP TABLE'), 'Migration não deve apagar tabelas');
assert(!migrationSql.includes('DISABLE ROW LEVEL SECURITY'), 'RLS nunca deve ser desabilitada');
console.log('✓ Migration 79 e segurança da RPC get_consolidated_financial_report validadas');

// 3. Contratos TypeScript da Sprint 15
const typesCode = read(typesPath);
assert(typesCode.includes('FinancialReportSummary'), 'Deve declarar FinancialReportSummary');
assert(typesCode.includes('CategoryFinancialMetric'), 'Deve declarar CategoryFinancialMetric');
assert(typesCode.includes('UnitFinancialMetric'), 'Deve declarar UnitFinancialMetric');
assert(typesCode.includes('ContingencyFinancialBatch'), 'Deve declarar ContingencyFinancialBatch');
assert(typesCode.includes('ConsolidatedFinancialReport'), 'Deve declarar ConsolidatedFinancialReport');
console.log('✓ Contratos TypeScript fiscais validados');

// 4. Segregação Contábil no Backend e Sanitização de Fórmulas
const serverCode = read(serverServicePath);
const excelCode = read(excelLibPath);
assert(serverCode.includes('server-only'), 'Serviço deve ser server-only');
assert(serverCode.includes('generateFinancialReportExcelWorkbook'), 'Servidor deve exportar generateFinancialReportExcelWorkbook');
assert(excelCode.includes('sanitizeCellForExport'), 'Exportação deve usar sanitizeCellForExport');
assert(excelCode.includes('generateFinancialReportExcelWorkbook'), 'Deve exportar planilha multi-abas');
assert(excelCode.includes('Resumo Faturamento'), 'Planilha deve conter aba Resumo Faturamento');
assert(excelCode.includes('Subsídios por Categoria'), 'Planilha deve conter aba Subsídios por Categoria');
assert(excelCode.includes('Por Unidade'), 'Planilha deve conter aba Por Unidade');
assert(excelCode.includes('Contingência Auditada'), 'Planilha deve conter aba Contingência Auditada');
assert(excelCode.includes('Memória e Normas'), 'Planilha deve conter aba Memória e Normas');
console.log('✓ Segregação contábil, multi-abas e proteção anti-formula injection validadas');

// 5. Interface de Usuário e Ações
const componentCode = read(componentPath);
assert(componentCode.includes('Faturamento Bruto'), 'UI deve exibir Faturamento Bruto');
assert(componentCode.includes('Subsídio da Instituição'), 'UI deve exibir Subsídio da Instituição');
assert(componentCode.includes('Receita dos Comensais'), 'UI deve exibir Receita dos Comensais');
assert(componentCode.includes('Passivo sob Custódia'), 'UI deve exibir Passivo sob Custódia');
assert(componentCode.includes('/api/admin/relatorios/export'), 'UI deve ter link para exportação XLSX');
assert(componentCode.includes('window.print'), 'UI deve ter suporte a impressão/PDF');
console.log('✓ Dashboard de visualização, cards de custódia e exportação validados');

// 6. Integração de Navegação
const shellCode = read(shellPath);
assert(shellCode.includes('/admin/relatorios'), 'AdminShell deve conter link para /admin/relatorios');

const adminHomeCode = read(adminHomePath);
assert(adminHomeCode.includes('/admin/relatorios'), 'Página inicial /admin deve conter card de Relatórios Fiscais');
console.log('✓ Navegação e rotas administrativas integradas');

// 7. Documento Técnico
const docContent = read(docPath);
assert(docContent.includes('SPRINT 15'), 'Documento deve conter cabeçalho da Sprint 15');
assert(docContent.includes('Passivo Circulante sob Custódia'), 'Documento deve registrar a regra de custódia');
assert(docContent.includes('Proibição de Comensais Fictícios'), 'Documento deve registrar a regra de contingência');
console.log('✓ Documento SPRINT_15_FINANCIAL_REPORTING.md validado');

console.log('\n--- ALL SPRINT 15 VERIFICATIONS PASSED (7/7) ---');

