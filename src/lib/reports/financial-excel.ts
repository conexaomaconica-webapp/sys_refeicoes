import * as XLSX from 'xlsx';
import { sanitizeCellForExport } from '../security/formula-sanitizer';
import type { ConsolidatedFinancialReport } from '@/types/financial-reporting';

export function generateFinancialReportExcelWorkbook(
  report: ConsolidatedFinancialReport
): Buffer {
  const wb = XLSX.utils.book_new();

  // 1. Aba de Resumo Executivo
  const summaryRows = [
    { 'Indicador Contábil': 'Data de Geração', 'Valor': report.generated_at },
    { 'Indicador Contábil': 'Período Inicial', 'Valor': report.period.start_date },
    { 'Indicador Contábil': 'Período Final', 'Valor': report.period.end_date },
    { 'Indicador Contábil': '---', 'Valor': '---' },
    { 'Indicador Contábil': 'Total de Refeições Regulares Servidas', 'Valor': report.summary.regular_meals_served },
    { 'Indicador Contábil': 'Regularizações Individuais Comprovadas (Tipo A)', 'Valor': report.summary.contingency_identified_meals ?? 0 },
    { 'Indicador Contábil': 'Regularizações Agregadas Aprovadas (Tipos B/C)', 'Valor': report.summary.contingency_aggregated_meals ?? report.summary.contingency_meals_served },
    { 'Indicador Contábil': 'Refeições em Regime de Contingência', 'Valor': report.summary.contingency_meals_served },
    { 'Indicador Contábil': 'Pendências Mensais Sem Data Alocada (Informativo / Não Faturado)', 'Valor': report.summary.unallocated_pending_meals_total ?? 0 },
    { 'Indicador Contábil': 'Total Geral de Refeições Fornecidas', 'Valor': report.summary.total_meals_delivered },
    { 'Indicador Contábil': '---', 'Valor': '---' },
    { 'Indicador Contábil': 'Faturamento Bruto Regular (R$)', 'Valor': report.summary.gross_meal_amount.toFixed(2) },
    { 'Indicador Contábil': 'Faturamento Bruto Contingência (R$)', 'Valor': report.summary.contingency_gross_amount.toFixed(2) },
    { 'Indicador Contábil': 'FATURAMENTO BRUTO TOTAL CONTRATUAL (R$)', 'Valor': report.summary.total_gross_invoicing.toFixed(2) },
    { 'Indicador Contábil': '---', 'Valor': '---' },
    { 'Indicador Contábil': 'Subsídio Regular da Instituição (R$)', 'Valor': report.summary.regular_subsidy_amount.toFixed(2) },
    { 'Indicador Contábil': 'Subsídio de Contingência Aprovado (R$)', 'Valor': report.summary.contingency_subsidy_amount.toFixed(2) },
    { 'Indicador Contábil': 'SUBSÍDIO TOTAL A FATURAR DA INSTITUIÇÃO (R$)', 'Valor': report.summary.total_institutional_subsidy.toFixed(2) },
    { 'Indicador Contábil': '---', 'Valor': '---' },
    { 'Indicador Contábil': 'Receita Realizada (Arrecadação Direta de Comensais) (R$)', 'Valor': report.summary.student_paid_amount.toFixed(2) },
    { 'Indicador Contábil': 'Recargas Recebidas no Período (Passivo de Custódia Gerado) (R$)', 'Valor': report.summary.recharges_in_period.toFixed(2) },
    { 'Indicador Contábil': 'Saldo Total sob Custódia Atual (Passivo Circulante) (R$)', 'Valor': report.summary.current_custody_liability.toFixed(2) },
  ].map((row) => ({
    'Indicador Contábil': sanitizeCellForExport(row['Indicador Contábil']),
    'Valor': sanitizeCellForExport(row['Valor']),
  }));

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumo Faturamento');

  // 2. Aba de Subsídios por Categoria
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

  // 3. Aba de Consolidado por Unidade
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

  // 4. Aba de Contingência Auditada
  const contingencyRows = report.contingency_breakdown.map((b) => ({
    'Data do Serviço': sanitizeCellForExport(b.service_date),
    'Unidade': sanitizeCellForExport(b.unit_name),
    'Refeição': sanitizeCellForExport(b.meal_type_name),
    'Tipologia': sanitizeCellForExport(
      b.batch_type === 'type_a_identified'
        ? 'Tipo A (Lista Identificada)'
        : b.batch_type === 'type_b_unidentified_count'
        ? 'Tipo B (Contagem Física Sem Aluno Fictício)'
        : 'Tipo C (Ajuste Administrativo)'
    ),
    'Refeições Aprovadas': b.total_meals_served,
    'Valor Total (R$)': b.total_amount.toFixed(2),
    'Subsídio Aprovado (R$)': b.total_subsidy_amount.toFixed(2),
    'Justificativa Técnica': sanitizeCellForExport(b.justification),
    'Aprovado Por': sanitizeCellForExport(b.approved_by_name || 'Diretoria'),
  }));
  const contingencySheet = XLSX.utils.json_to_sheet(contingencyRows);
  XLSX.utils.book_append_sheet(wb, contingencySheet, 'Contingência Auditada');

  // 5. Notas Explicativas e Memória Contábil
  const notesRows = [
    { 'Nota Explicativa': 'Princípio da Não-Confusão Contábil', 'Detalhamento': 'Recargas de comensais são tratadas estritamente como Passivo de Custódia e não como receita imediata.' },
    { 'Nota Explicativa': 'Conversão em Receita', 'Detalhamento': 'A conversão em receita operacional tributável ocorre exclusivamente no momento do consumo da refeição (débito em carteira).' },
    { 'Nota Explicativa': 'Subsídio Institucional Faturável', 'Detalhamento': 'Corresponde à soma do subsídio contratual das refeições parciais mais o valor integral das refeições fornecidas a bolsistas integrais e contingências aprovadas.' },
    { 'Nota Explicativa': 'Proibição de Comensais Fictícios', 'Detalhamento': 'Refeições fornecidas em apagão ou pane são registradas como lotes de contingência Tipo B e jamais atribuídas a matrículas aleatórias.' },
  ].map((row) => ({
    'Nota Explicativa': sanitizeCellForExport(row['Nota Explicativa']),
    'Detalhamento': sanitizeCellForExport(row['Detalhamento']),
  }));
  const notesSheet = XLSX.utils.json_to_sheet(notesRows);
  XLSX.utils.book_append_sheet(wb, notesSheet, 'Memória e Normas');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

