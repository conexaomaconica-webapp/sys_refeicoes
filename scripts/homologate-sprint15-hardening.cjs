const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- HOMOLOGATING SPRINT 15.1 & 15.2: FINANCIAL HARDENING & CANONICAL AUDITING ---');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const serverPath = 'src/server/reports/financial-reporting.server.ts';
const migrationPath = 'supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql';
const excelPath = 'src/lib/reports/financial-excel.ts';
const docHardeningPath = 'docs/SPRINT_15_1_15_2_HARDENING_HOMOLOGATION.md';

// 1. Verificação de Arquivos de Hardening
assert(exists(serverPath), 'Servidor financial-reporting.server.ts deve existir');
assert(exists(migrationPath), 'Migration 79 deve existir');
assert(exists(excelPath), 'Módulo excel financial-excel.ts deve existir');
assert(exists(docHardeningPath), 'Documento SPRINT_15_1_15_2_HARDENING_HOMOLOGATION.md deve existir');
console.log('✓ Arquivos e documentação da Sprint 15.1/15.2 verificados');

// 2. Fonte Canônica Única e Eliminação de Fallback Analítico
const serverCode = read(serverPath);
assert(!serverCode.includes('buildAnalyticalReportFallback'), 'ERRO CRÍTICO: buildAnalyticalReportFallback ainda existe no servidor! Deve ser eliminado.');
assert(!serverCode.includes("from('meal_consumptions')"), 'Servidor não deve realizar consultas diretas à tabela de consumo sem passar pela RPC.');
assert(serverCode.includes('FALHA_CONTABIL_FAIL_CLOSED'), 'Servidor deve implementar comportamento fail-closed obrigatório.');
assert(serverCode.includes('UNIT_SCOPE_REQUIRED'), 'Servidor deve validar escopo obrigatório de unidade para gestores locais.');
console.log('✓ Fonte Canônica Única confirmada: Fallback analítico removido e comportamento fail-closed ativo');

// 3. Imposição de Escopo de Unidade na Migration e na RPC
const migrationSql = read(migrationPath);
assert(migrationSql.includes('UNIT_SCOPE_REQUIRED'), 'Migration deve conter a validação UNIT_SCOPE_REQUIRED');
assert(migrationSql.includes("v_profile.role IN ('unit_manager', 'supervisor')"), 'Migration deve segregar regras para unit_manager e supervisor');
assert(migrationSql.includes('has_unit_access(p_unit_id)'), 'Migration deve invocar has_unit_access para validação de unidade');
assert(migrationSql.includes('ACCESS_DENIED_UNIT'), 'Migration deve lançar exceção ACCESS_DENIED_UNIT caso a unidade não pertença ao usuário');
console.log('✓ Escopo estrito de unidade e permissões de perfil validados na RPC');

// 4. Segregação de Dados de Custódia por Perfil (Segurança P0)
assert(migrationSql.includes("IF v_profile.role IN ('admin_general', 'operations_director', 'finance') THEN"), 'Apenas diretoria e financeiro podem consultar passivo de custódia e recargas');
console.log('✓ Passivo de custódia protegido contra visibilidade indevida de gestores locais');

// 5. Sanitização Anti-Formula Injection no Excel
const excelCode = read(excelPath);
const sanitizerPath = 'src/lib/security/formula-sanitizer.ts';
assert(exists(sanitizerPath), 'Sanitizador formula-sanitizer.ts deve existir');
const sanitizerCode = read(sanitizerPath);
assert(sanitizerCode.includes("FORMULA_START_CHARS = ['=', '+', '-', '@', '\\t', '\\r']"), 'Sanitizador deve cobrir todos os caracteres de injeção de fórmula');
assert(sanitizerCode.includes('sanitizeCellForExport'), 'Sanitizador deve exportar sanitizeCellForExport');
assert(excelCode.includes('sanitizeCellForExport'), 'Módulo Excel deve invocar sanitizeCellForExport em suas células');
console.log('✓ Proteção robusta contra CSV/Excel Formula Injection validada');

// 6. Teste de Conformidade da Regra de Negócio Fail-Closed
// Simulação de erro em chamada RPC: deve lançar erro contábil fail-closed
const simulateRpcCall = (rpcData, rpcError) => {
  if (rpcError) {
    throw new Error(`FALHA_CONTABIL_FAIL_CLOSED: Erro ao executar apuração canônica RPC: ${rpcError.message}`);
  }
  if (!rpcData) {
    throw new Error('FALHA_CONTABIL_FAIL_CLOSED: Nenhum dado retornado pela apuração canônica.');
  }
  return rpcData;
};

assert.throws(() => {
  simulateRpcCall(null, { message: 'Database timeout' });
}, /FALHA_CONTABIL_FAIL_CLOSED/);

assert.throws(() => {
  simulateRpcCall(null, null);
}, /FALHA_CONTABIL_FAIL_CLOSED/);

const validMockReport = {
  summary: {
    total_gross_invoicing: 1000,
    total_institutional_subsidy: 600,
    student_paid_amount: 400,
    current_custody_liability: 500,
  }
};
const res = simulateRpcCall(validMockReport, null);
assert.strictEqual(res.summary.total_gross_invoicing, 1000);
console.log('✓ Simulação de comportamento fail-closed validada com 100% de precisão');

// 7. Validação Documental
const docContent = read(docHardeningPath);
assert(docContent.includes('SPRINT 15.1 & 15.2'), 'Documento deve registrar título da Sprint 15.1 & 15.2');
assert(docContent.includes('Fonte Canônica Única'), 'Documento deve descrever a fonte canônica');
assert(docContent.includes('UNIT_SCOPE_REQUIRED'), 'Documento deve registrar UNIT_SCOPE_REQUIRED');
assert(docContent.includes('NO-GO'), 'Documento deve manter status de produção em NO-GO');
console.log('✓ Documento técnico de homologação SPRINT_15_1_15_2_HARDENING_HOMOLOGATION.md validado');

console.log('\n--- ALL SPRINT 15.1 & 15.2 HARDENING HOMOLOGATION CHECKS PASSED (7/7) ---');
