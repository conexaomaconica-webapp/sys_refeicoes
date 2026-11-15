import * as XLSX from 'xlsx';
import { sanitizeCellForExport } from '../security/formula-sanitizer';
import type { ConsolidatedFinancialReport } from '@/types/financial-reporting';

type CellFormat = 'text' | 'int' | 'currency';

interface SheetColumnSpec {
  header: string;
  minWidth: number;
  maxWidth?: number;
  format?: CellFormat;
}

function formatBrDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatGeneratedAtBr(isoDateTime: string): string {
  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) return isoDateTime;
  return parsed.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function sanitizeRowValue(value: string | number, format: CellFormat = 'text'): string | number {
  if (format === 'int' || format === 'currency') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return sanitizeCellForExport(value);
}

function buildStructuredSheet(params: {
  title: string;
  subtitle: string;
  periodLabel: string;
  generatedLabel: string;
  columns: SheetColumnSpec[];
  rows: Array<Array<string | number>>;
  totalRow?: Array<string | number>;
}): XLSX.WorkSheet {
  const { title, subtitle, periodLabel, generatedLabel, columns, rows, totalRow } = params;
  const colCount = Math.max(columns.length, 2);

  const sanitizedRows = rows.map((row) =>
    columns.map((col, idx) => sanitizeRowValue(row[idx] ?? '', col.format))
  );

  const sanitizedTotal = totalRow
    ? columns.map((col, idx) => sanitizeRowValue(totalRow[idx] ?? '', col.format))
    : null;

  const aoa: Array<Array<string | number>> = [
    [sanitizeCellForExport(title)],
    [sanitizeCellForExport(subtitle)],
    [sanitizeCellForExport(`${periodLabel}  |  ${generatedLabel}`)],
    [],
    columns.map((c) => sanitizeCellForExport(c.header)),
    ...sanitizedRows,
    ...(sanitizedTotal ? [sanitizedTotal] : []),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Mesclar as 3 linhas de cabeçalho institucional em toda a largura da tabela
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: colCount - 1 } },
  ];

  // Aplicar formato numérico/monetário nas células de dados e totais (linhas >= 5 em 0-based)
  const dataStartRow = 5;
  const dataEndRow = dataStartRow + sanitizedRows.length + (sanitizedTotal ? 1 : 0);

  for (let r = dataStartRow; r < dataEndRow; r++) {
    for (let c = 0; c < columns.length; c++) {
      const fmt = columns[c].format;
      if (!fmt || fmt === 'text') continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = fmt === 'currency' ? 'R$ #,##0.00' : '#,##0';
      }
    }
  }

  // Calcular largura das colunas considerando cabeçalho e valores (ignorando linhas mescladas 0..2)
  ws['!cols'] = columns.map((col, colIdx) => {
    let maxLen = col.header.length;
    for (const row of sanitizedRows) {
      const val = row[colIdx];
      const len =
        typeof val === 'number'
          ? col.format === 'currency'
            ? val.toFixed(2).length + 5
            : String(val).length + 2
          : String(val ?? '').length;
      if (len > maxLen) maxLen = len;
    }
    if (sanitizedTotal) {
      const totalVal = sanitizedTotal[colIdx];
      const totalLen =
        typeof totalVal === 'number'
          ? col.format === 'currency'
            ? totalVal.toFixed(2).length + 5
            : String(totalVal).length + 2
          : String(totalVal ?? '').length;
      if (totalLen > maxLen) maxLen = totalLen;
    }
    const capped = Math.min(Math.max(maxLen + 3, col.minWidth), col.maxWidth ?? 64);
    return { wch: capped };
  });

  ws['!rows'] = [
    { hpt: 24 },
    { hpt: 18 },
    { hpt: 16 },
    { hpt: 10 },
    { hpt: 22 },
  ];

  return ws;
}

export function generateFinancialReportExcelWorkbook(
  report: ConsolidatedFinancialReport
): Buffer {
  const wb = XLSX.utils.book_new();
  const periodLabel = `Período: ${formatBrDate(report.period.start_date)} a ${formatBrDate(report.period.end_date)}`;
  const generatedLabel = `Gerado em: ${formatGeneratedAtBr(report.generated_at)}`;
  const mainTitle = 'MA REFEIÇÕES — RELATÓRIO FINANCEIRO E CONTÁBIL CONSOLIDADO';

  // 1. Aba de Resumo Executivo
  const summarySheet = buildStructuredSheet({
    title: mainTitle,
    subtitle: 'Resumo Executivo de Faturamento, Subsídio e Custódia',
    periodLabel,
    generatedLabel,
    columns: [
      { header: 'Grupo', minWidth: 22, maxWidth: 26, format: 'text' },
      { header: 'Indicador Contábil', minWidth: 46, maxWidth: 62, format: 'text' },
      { header: 'Quantidade / Valor', minWidth: 22, maxWidth: 26, format: 'text' },
    ],
    rows: [
      ['Volumetria', 'Total de Refeições Regulares Servidas', report.summary.regular_meals_served],
      ['Volumetria', 'Regularizações Individuais Comprovadas (Tipo A)', report.summary.contingency_identified_meals ?? 0],
      ['Volumetria', 'Regularizações Agregadas Aprovadas (Tipos B/C)', report.summary.contingency_aggregated_meals ?? report.summary.contingency_meals_served],
      ['Volumetria', 'Total de Refeições em Regime de Contingência', report.summary.contingency_meals_served],
      ['Volumetria', 'Pendências Mensais Sem Data Alocada (Informativo / Não Faturado)', report.summary.unallocated_pending_meals_total ?? 0],
      ['Volumetria', 'TOTAL GERAL DE REFEIÇÕES FORNECIDAS', report.summary.total_meals_delivered],
      ['Faturamento', 'Faturamento Bruto Regular (R$)', Number(report.summary.gross_meal_amount.toFixed(2))],
      ['Faturamento', 'Faturamento Bruto Contingência (R$)', Number(report.summary.contingency_gross_amount.toFixed(2))],
      ['Faturamento', 'FATURAMENTO BRUTO TOTAL CONTRATUAL (R$)', Number(report.summary.total_gross_invoicing.toFixed(2))],
      ['Subsídio', 'Subsídio Regular da Instituição (R$)', Number(report.summary.regular_subsidy_amount.toFixed(2))],
      ['Subsídio', 'Subsídio de Contingência Aprovado (R$)', Number(report.summary.contingency_subsidy_amount.toFixed(2))],
      ['Subsídio', 'SUBSÍDIO TOTAL A FATURAR DA INSTITUIÇÃO (R$)', Number(report.summary.total_institutional_subsidy.toFixed(2))],
      ['Custódia / Receita', 'Receita Realizada — Arrecadação Direta de Comensais (R$)', Number(report.summary.student_paid_amount.toFixed(2))],
      ['Custódia / Receita', 'Recargas Recebidas no Período — Passivo de Custódia (R$)', Number(report.summary.recharges_in_period.toFixed(2))],
      ['Custódia / Receita', 'Saldo Total sob Custódia Atual — Passivo Circulante (R$)', Number(report.summary.current_custody_liability.toFixed(2))],
    ],
  });

  // Aplicar formato numérico/monetário específico por linha na coluna C (índice 2) do resumo
  const summaryFormats: CellFormat[] = [
    'int', 'int', 'int', 'int', 'int', 'int',
    'currency', 'currency', 'currency',
    'currency', 'currency', 'currency',
    'currency', 'currency', 'currency',
  ];
  summaryFormats.forEach((fmt, idx) => {
    const addr = XLSX.utils.encode_cell({ r: 5 + idx, c: 2 });
    const cell = summarySheet[addr];
    if (cell && typeof cell.v === 'number') {
      cell.t = 'n';
      cell.z = fmt === 'currency' ? 'R$ #,##0.00' : '#,##0';
    }
  });
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumo Faturamento');

  // 2. Aba de Subsídios por Categoria
  const catTotals = report.category_breakdown.reduce(
    (acc, c) => ({
      meals: acc.meals + c.meals_count,
      gross: acc.gross + c.gross_amount,
      subsidy: acc.subsidy + c.subsidy_amount,
      studentPaid: acc.studentPaid + c.student_paid_amount,
    }),
    { meals: 0, gross: 0, subsidy: 0, studentPaid: 0 }
  );

  const catSheet = buildStructuredSheet({
    title: mainTitle,
    subtitle: 'Detalhamento de Subsídios e Coparticipação por Categoria',
    periodLabel,
    generatedLabel,
    columns: [
      { header: 'Código', minWidth: 14, maxWidth: 20, format: 'text' },
      { header: 'Categoria', minWidth: 26, maxWidth: 38, format: 'text' },
      { header: 'Modalidade', minWidth: 26, maxWidth: 32, format: 'text' },
      { header: 'Refeições Servidas', minWidth: 18, format: 'int' },
      { header: 'Faturamento Bruto (R$)', minWidth: 22, format: 'currency' },
      { header: 'Subsídio Institucional (R$)', minWidth: 24, format: 'currency' },
      { header: 'Arrecadação Comensal (R$)', minWidth: 24, format: 'currency' },
    ],
    rows: report.category_breakdown.map((c) => [
      c.category_code,
      c.category_name,
      c.is_integral ? 'Integral (100% Subsidiado)' : 'Parcial (Com Coparticipação)',
      c.meals_count,
      Number(c.gross_amount.toFixed(2)),
      Number(c.subsidy_amount.toFixed(2)),
      Number(c.student_paid_amount.toFixed(2)),
    ]),
    totalRow: [
      'TOTAL',
      `${report.category_breakdown.length} categoria(s)`,
      '',
      catTotals.meals,
      Number(catTotals.gross.toFixed(2)),
      Number(catTotals.subsidy.toFixed(2)),
      Number(catTotals.studentPaid.toFixed(2)),
    ],
  });
  XLSX.utils.book_append_sheet(wb, catSheet, 'Subsídios por Categoria');

  // 3. Aba de Consolidado por Unidade
  const unitTotals = report.unit_breakdown.reduce(
    (acc, u) => ({
      meals: acc.meals + u.meals_count,
      gross: acc.gross + u.gross_amount,
      subsidy: acc.subsidy + u.subsidy_amount,
      studentPaid: acc.studentPaid + u.student_paid_amount,
    }),
    { meals: 0, gross: 0, subsidy: 0, studentPaid: 0 }
  );

  const unitSheet = buildStructuredSheet({
    title: mainTitle,
    subtitle: 'Consolidado Financeiro por Unidade / Restaurante',
    periodLabel,
    generatedLabel,
    columns: [
      { header: 'Unidade / Restaurante', minWidth: 28, maxWidth: 40, format: 'text' },
      { header: 'Instituição', minWidth: 24, maxWidth: 36, format: 'text' },
      { header: 'Refeições Servidas', minWidth: 18, format: 'int' },
      { header: 'Faturamento Bruto (R$)', minWidth: 22, format: 'currency' },
      { header: 'Subsídio Institucional (R$)', minWidth: 24, format: 'currency' },
      { header: 'Arrecadação Comensal (R$)', minWidth: 24, format: 'currency' },
    ],
    rows: report.unit_breakdown.map((u) => [
      u.unit_name,
      u.institution_name,
      u.meals_count,
      Number(u.gross_amount.toFixed(2)),
      Number(u.subsidy_amount.toFixed(2)),
      Number(u.student_paid_amount.toFixed(2)),
    ]),
    totalRow: [
      'TOTAL',
      `${report.unit_breakdown.length} unidade(s)`,
      unitTotals.meals,
      Number(unitTotals.gross.toFixed(2)),
      Number(unitTotals.subsidy.toFixed(2)),
      Number(unitTotals.studentPaid.toFixed(2)),
    ],
  });
  XLSX.utils.book_append_sheet(wb, unitSheet, 'Por Unidade');

  // 4. Aba de Contingência Auditada
  const contTotals = report.contingency_breakdown.reduce(
    (acc, b) => ({
      meals: acc.meals + b.total_meals_served,
      amount: acc.amount + b.total_amount,
      subsidy: acc.subsidy + b.total_subsidy_amount,
    }),
    { meals: 0, amount: 0, subsidy: 0 }
  );

  const contingencySheet = buildStructuredSheet({
    title: mainTitle,
    subtitle: 'Lotes de Contingência e Ajustes Aprovados',
    periodLabel,
    generatedLabel,
    columns: [
      { header: 'Data do Serviço', minWidth: 16, format: 'text' },
      { header: 'Unidade', minWidth: 24, maxWidth: 34, format: 'text' },
      { header: 'Refeição / Turno', minWidth: 18, maxWidth: 26, format: 'text' },
      { header: 'Tipologia', minWidth: 30, maxWidth: 38, format: 'text' },
      { header: 'Refeições Aprovadas', minWidth: 18, format: 'int' },
      { header: 'Valor Total (R$)', minWidth: 18, format: 'currency' },
      { header: 'Subsídio Aprovado (R$)', minWidth: 22, format: 'currency' },
      { header: 'Justificativa Técnica', minWidth: 36, maxWidth: 64, format: 'text' },
      { header: 'Aprovado Por', minWidth: 20, maxWidth: 28, format: 'text' },
    ],
    rows: report.contingency_breakdown.map((b) => [
      formatBrDate(b.service_date),
      b.unit_name,
      b.meal_type_name,
      b.batch_type === 'type_a_identified'
        ? 'Tipo A (Lista Identificada)'
        : b.batch_type === 'type_b_unidentified_count'
        ? 'Tipo B (Contagem Física Sem Aluno Fictício)'
        : 'Tipo C (Ajuste Administrativo)',
      b.total_meals_served,
      Number(b.total_amount.toFixed(2)),
      Number(b.total_subsidy_amount.toFixed(2)),
      b.justification,
      b.approved_by_name || 'Diretoria',
    ]),
    totalRow: [
      'TOTAL',
      `${report.contingency_breakdown.length} lote(s)`,
      '',
      '',
      contTotals.meals,
      Number(contTotals.amount.toFixed(2)),
      Number(contTotals.subsidy.toFixed(2)),
      '',
      '',
    ],
  });
  XLSX.utils.book_append_sheet(wb, contingencySheet, 'Contingência Auditada');

  // 5. Notas Explicativas e Memória Contábil
  const notesSheet = buildStructuredSheet({
    title: mainTitle,
    subtitle: 'Memória Contábil, Critérios e Normas de Auditoria',
    periodLabel,
    generatedLabel,
    columns: [
      { header: 'Nota Explicativa', minWidth: 34, maxWidth: 42, format: 'text' },
      { header: 'Detalhamento', minWidth: 64, maxWidth: 96, format: 'text' },
    ],
    rows: [
      [
        'Princípio da Não-Confusão Contábil',
        'Recargas de comensais são tratadas estritamente como Passivo de Custódia e não como receita imediata.',
      ],
      [
        'Conversão em Receita',
        'A conversão em receita operacional tributável ocorre exclusivamente no momento do consumo da refeição (débito em carteira).',
      ],
      [
        'Subsídio Institucional Faturável',
        'Corresponde à soma do subsídio contratual das refeições parciais mais o valor integral das refeições fornecidas a bolsistas integrais e contingências aprovadas.',
      ],
      [
        'Proibição de Comensais Fictícios',
        'Refeições fornecidas em apagão ou pane são registradas como lotes de contingência Tipo B e jamais atribuídas a matrículas aleatórias.',
      ],
    ],
  });
  XLSX.utils.book_append_sheet(wb, notesSheet, 'Memória e Normas');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
