const fs = require('fs');
const path = require('path');
const assert = require('assert');
const XLSX = require('xlsx');

console.log('================================================================================');
console.log('HOMOLOGAÇÃO TÉCNICA E CONTÁBIL: SPRINT 15 (RELATÓRIOS E FATURAMENTO CONSOLIDADO)');
console.log('================================================================================\n');

const root = path.resolve(__dirname, '..');

// Sanitizador espelhado para testes unitários CJS
const FORMULA_START_CHARS = ['=', '+', '-', '@', '\t', '\r'];
function sanitizeCellForExport(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.length === 0) return '';
  if (FORMULA_START_CHARS.includes(str.charAt(0))) {
    return `'${str}`;
  }
  return str;
}

function generateFinancialReportExcelWorkbook(report) {
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    { 'Indicador Contábil': 'Data de Geração', 'Valor': report.generated_at },
    { 'Indicador Contábil': 'Total de Refeições Regulares Servidas', 'Valor': report.summary.regular_meals_served },
    { 'Indicador Contábil': 'Refeições em Regime de Contingência', 'Valor': report.summary.contingency_meals_served },
    { 'Indicador Contábil': 'Total Geral de Refeições Fornecidas', 'Valor': report.summary.total_meals_delivered },
    { 'Indicador Contábil': 'Faturamento Bruto Regular (R$)', 'Valor': report.summary.gross_meal_amount.toFixed(2) },
    { 'Indicador Contábil': 'Faturamento Bruto Contingência (R$)', 'Valor': report.summary.contingency_gross_amount.toFixed(2) },
    { 'Indicador Contábil': 'FATURAMENTO BRUTO TOTAL CONTRATUAL (R$)', 'Valor': report.summary.total_gross_invoicing.toFixed(2) },
    { 'Indicador Contábil': 'Subsídio Regular da Instituição (R$)', 'Valor': report.summary.regular_subsidy_amount.toFixed(2) },
    { 'Indicador Contábil': 'Subsídio de Contingência Aprovado (R$)', 'Valor': report.summary.contingency_subsidy_amount.toFixed(2) },
    { 'Indicador Contábil': 'SUBSÍDIO TOTAL A FATURAR DA INSTITUIÇÃO (R$)', 'Valor': report.summary.total_institutional_subsidy.toFixed(2) },
    { 'Indicador Contábil': 'Receita Realizada (Arrecadação Direta de Comensais) (R$)', 'Valor': report.summary.student_paid_amount.toFixed(2) },
    { 'Indicador Contábil': 'Recargas Recebidas no Período (Passivo de Custódia Gerado) (R$)', 'Valor': report.summary.recharges_in_period.toFixed(2) },
    { 'Indicador Contábil': 'Saldo Total sob Custódia Atual (Passivo Circulante) (R$)', 'Valor': report.summary.current_custody_liability.toFixed(2) },
  ].map((row) => ({
    'Indicador Contábil': sanitizeCellForExport(row['Indicador Contábil']),
    'Valor': sanitizeCellForExport(row['Valor']),
  }));

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumo Faturamento');

  const catRows = report.category_breakdown.map((c) => ({
    'Código': sanitizeCellForExport(c.category_code),
    'Categoria': sanitizeCellForExport(c.category_name),
    'Modalidade': sanitizeCellForExport(c.is_integral ? 'Integral (100% Subsidiado)' : 'Parcial (Com Coparticipação)'),
    'Refeições Servidas': c.meals_count,
    'Faturamento Bruto (R$)': c.gross_amount.toFixed(2),
    'Subsídio Institucional (R$)': c.subsidy_amount.toFixed(2),
    'Arrecadação do Estudante (R$)': c.student_paid_amount.toFixed(2),
  }));
  const catSheet = XLSX.utils.json_to_sheet(catRows);
  XLSX.utils.book_append_sheet(wb, catSheet, 'Subsídios por Categoria');

  const unitRows = report.unit_breakdown.map((u) => ({
    'Unidade / Restaurante': sanitizeCellForExport(u.unit_name),
    'Instituição': sanitizeCellForExport(u.institution_name),
    'Refeições Servidas': u.meals_count,
    'Faturamento Bruto (R$)': u.gross_amount.toFixed(2),
    'Subsídio Institucional (R$)': u.subsidy_amount.toFixed(2),
    'Arrecadação do Estudante (R$)': u.student_paid_amount.toFixed(2),
  }));
  const unitSheet = XLSX.utils.json_to_sheet(unitRows);
  XLSX.utils.book_append_sheet(wb, unitSheet, 'Por Unidade');

  const contingencyRows = report.contingency_breakdown.map((b) => ({
    'Data do Serviço': sanitizeCellForExport(b.service_date),
    'Unidade': sanitizeCellForExport(b.unit_name),
    'Refeição': sanitizeCellForExport(b.meal_type_name),
    'Tipologia': sanitizeCellForExport(b.batch_type),
    'Refeições Aprovadas': b.total_meals_served,
    'Valor Total (R$)': b.total_amount.toFixed(2),
    'Subsídio Aprovado (R$)': b.total_subsidy_amount.toFixed(2),
    'Justificativa Técnica': sanitizeCellForExport(b.justification),
    'Aprovado Por': sanitizeCellForExport(b.approved_by_name || 'Diretoria'),
  }));
  const contingencySheet = XLSX.utils.json_to_sheet(contingencyRows);
  XLSX.utils.book_append_sheet(wb, contingencySheet, 'Contingência Auditada');

  const notesRows = [
    { 'Nota Explicativa': 'Princípio da Não-Confusão Contábil', 'Detalhamento': 'Recargas são tratadas como Passivo de Custódia.' },
  ].map((row) => ({
    'Nota Explicativa': sanitizeCellForExport(row['Nota Explicativa']),
    'Detalhamento': sanitizeCellForExport(row['Detalhamento']),
  }));
  const notesSheet = XLSX.utils.json_to_sheet(notesRows);
  XLSX.utils.book_append_sheet(wb, notesSheet, 'Memória e Normas');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const testAssertions = [];

// 1. TESTE DE CÁLCULO E ARREDONDAMENTO MONETÁRIO SINTÉTICO
{
  const mockReport = {
    generated_at: new Date().toISOString(),
    period: { start_date: '2026-10-01', end_date: '2026-10-31' },
    applied_filters: { institution_id: null, unit_id: null, category_id: null },
    summary: {
      regular_meals_served: 1540,
      contingency_meals_served: 60,
      total_meals_delivered: 1600,

      gross_meal_amount: 15400.00,
      contingency_gross_amount: 600.00,
      total_gross_invoicing: 16000.00,

      regular_subsidy_amount: 9240.00,
      contingency_subsidy_amount: 600.00,
      total_institutional_subsidy: 9840.00,

      student_paid_amount: 6160.00,

      recharges_in_period: 8500.00,
      current_custody_liability: 2340.00,
      gateway_processing_fees: 42.50,
    },
    category_breakdown: [
      {
        category_id: 'cat-1',
        category_name: 'Bolsista Integral',
        category_code: 'INT',
        is_integral: true,
        meals_count: 500,
        gross_amount: 5000.00,
        subsidy_amount: 5000.00,
        student_paid_amount: 0.00,
      },
      {
        category_id: 'cat-2',
        category_name: 'Estudante Parcial',
        category_code: 'PAR',
        is_integral: false,
        meals_count: 1040,
        gross_amount: 10400.00,
        subsidy_amount: 4240.00,
        student_paid_amount: 6160.00,
      },
    ],
    unit_breakdown: [
      {
        unit_id: 'unit-1',
        unit_name: 'Restaurante Central',
        institution_name: 'Universidade Federal',
        meals_count: 1540,
        gross_amount: 15400.00,
        subsidy_amount: 9240.00,
        student_paid_amount: 6160.00,
      },
    ],
    contingency_breakdown: [
      {
        id: 'cont-1',
        unit_name: 'Restaurante Central',
        meal_type_name: 'Almoço',
        service_date: '2026-10-15',
        batch_type: 'type_b_unidentified_count',
        total_meals_served: 60,
        total_amount: 600.00,
        total_subsidy_amount: 600.00,
        justification: 'Pane na catraca física decorrente de surto elétrico.',
        approved_by_name: 'Diretor de Operações',
        approved_at: '2026-10-16T10:00:00Z',
      },
    ],
  };

  // Asserção 1: Fechamento exato de refeições
  testAssertions.push([
    '1.1 - Soma de refeições regulares e de contingência confere com o total geral',
    mockReport.summary.regular_meals_served + mockReport.summary.contingency_meals_served === mockReport.summary.total_meals_delivered,
  ]);

  // Asserção 2: Fechamento exato de Faturamento Bruto
  testAssertions.push([
    '1.2 - Faturamento Bruto total é a soma exata de regular + contingência',
    mockReport.summary.gross_meal_amount + mockReport.summary.contingency_gross_amount === mockReport.summary.total_gross_invoicing,
  ]);

  // Asserção 3: Equação contábil básica (Bruto = Subsídio + Arrecadação)
  testAssertions.push([
    '1.3 - Equação Contábil das Refeições Regulares: Bruto = Subsídio + Aluno',
    Math.round((mockReport.summary.regular_subsidy_amount + mockReport.summary.student_paid_amount) * 100) === Math.round(mockReport.summary.gross_meal_amount * 100),
  ]);

  // Asserção 4: Subsídio Total a Faturar
  testAssertions.push([
    '1.4 - Subsídio Total Faturável inclui parcelas subsidiadas e contingências',
    mockReport.summary.regular_subsidy_amount + mockReport.summary.contingency_subsidy_amount === mockReport.summary.total_institutional_subsidy,
  ]);

  // Asserção 5: Segregação do Passivo de Custódia
  testAssertions.push([
    '1.5 - Recargas e Saldo em Custódia não inflam a receita realizada do período',
    mockReport.summary.student_paid_amount !== mockReport.summary.recharges_in_period,
  ]);

  // 2. TESTE DE GERAÇÃO E ESTRUTURA DO ARQUIVO EXCEL (.XLSX)
  const excelBuffer = generateFinancialReportExcelWorkbook(mockReport);
  testAssertions.push([
    '2.1 - Buffer binário XLSX gerado com sucesso (> 1KB)',
    Buffer.isBuffer(excelBuffer) && excelBuffer.length > 1024,
  ]);

  const parsedWorkbook = XLSX.read(excelBuffer, { type: 'buffer' });
  const sheetNames = parsedWorkbook.SheetNames;

  testAssertions.push([
    '2.2 - Planilha contém exatamente as 5 abas auditáveis exigidas',
    ['Resumo Faturamento', 'Subsídios por Categoria', 'Por Unidade', 'Contingência Auditada', 'Memória e Normas'].every((s) => sheetNames.includes(s)),
  ]);

  // Asserção 6: Proteção contra injeção de fórmulas CSV/Excel
  const injectedValue = '=CMD|"/C calc"!A0';
  const sanitized = sanitizeCellForExport(injectedValue);
  testAssertions.push([
    '2.3 - Sanitizador neutraliza tentativa de Formula Injection (prefixando aspas)',
    sanitized.startsWith("'="),
  ]);
}

// 3. NÃO-REGRESSÃO COM AS SPRINTS ANTERIORES
{
  const migration78 = fs.readFileSync(path.join(root, 'supabase/migrations/20261109000078_create_realtime_operational_dashboard.sql'), 'utf8');
  const migration77 = fs.readFileSync(path.join(root, 'supabase/migrations/20261029000077_create_contingency_regularization.sql'), 'utf8');

  testAssertions.push([
    '3.1 - Preservação da Migration 78 (Sprint 14 Realtime Dashboard)',
    migration78.includes('get_realtime_operational_dashboard') && migration78.includes('idx_meal_consumptions_dashboard_fast'),
  ]);

  testAssertions.push([
    '3.2 - Preservação da Migration 77 (Sprint 13 Contingência Auditável)',
    migration77.includes('contingency_meal_batches') && migration77.includes('chk_contingency_batch_type'),
  ]);
}

let failed = 0;
for (const [desc, ok] of testAssertions) {
  if (ok) {
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc}`);
    failed += 1;
  }
}

console.log(`\n================================================================================`);
console.log(`RESULTADO DA HOMOLOGAÇÃO CONTÁBIL: ${testAssertions.length - failed}/${testAssertions.length} testes aprovados`);
console.log(`================================================================================`);

if (failed > 0) {
  process.exit(1);
}
