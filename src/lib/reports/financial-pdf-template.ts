import type { ConsolidatedFinancialReport } from '@/types/financial-reporting';

export interface FinancialReportPdfBrand {
  appName: string;
  primaryColor: string;
  logoUrl?: string | null;
}

export interface FinancialReportPdfFilters {
  institutionName?: string;
  unitName?: string;
  categoryName?: string;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function formatInt(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatBrDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatGeneratedAt(isoDateTime: string): string {
  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) return isoDateTime;
  return parsed.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function buildFinancialReportPdfHtml(
  report: ConsolidatedFinancialReport,
  brand: FinancialReportPdfBrand,
  filters: FinancialReportPdfFilters = {}
): string {
  const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(brand.primaryColor)
    ? brand.primaryColor
    : '#C5161D';
  const safeLogoUrl = brand.logoUrl?.trim() ? brand.logoUrl.trim() : null;

  const summary = report.summary;

  const catTotals = report.category_breakdown.reduce(
    (acc, c) => ({
      meals: acc.meals + c.meals_count,
      gross: acc.gross + c.gross_amount,
      subsidy: acc.subsidy + c.subsidy_amount,
      studentPaid: acc.studentPaid + c.student_paid_amount,
    }),
    { meals: 0, gross: 0, subsidy: 0, studentPaid: 0 }
  );

  const unitTotals = report.unit_breakdown.reduce(
    (acc, u) => ({
      meals: acc.meals + u.meals_count,
      gross: acc.gross + u.gross_amount,
      subsidy: acc.subsidy + u.subsidy_amount,
      studentPaid: acc.studentPaid + u.student_paid_amount,
    }),
    { meals: 0, gross: 0, subsidy: 0, studentPaid: 0 }
  );

  const contTotals = report.contingency_breakdown.reduce(
    (acc, b) => ({
      meals: acc.meals + b.total_meals_served,
      amount: acc.amount + b.total_amount,
      subsidy: acc.subsidy + b.total_subsidy_amount,
    }),
    { meals: 0, amount: 0, subsidy: 0 }
  );

  const filterSummary = [
    `Instituição: ${filters.institutionName || 'Todas'}`,
    `Unidade: ${filters.unitName || 'Todas'}`,
    `Categoria: ${filters.categoryName || 'Todas'}`,
  ].join(' · ');

  const categoryRowsHtml =
    report.category_breakdown.length === 0
      ? '<tr><td colspan="7" class="empty">Nenhum consumo por categoria no período selecionado.</td></tr>'
      : report.category_breakdown
          .map(
            (c) => `
          <tr>
            <td class="mono">${escapeHtml(c.category_code)}</td>
            <td><strong>${escapeHtml(c.category_name)}</strong></td>
            <td>${escapeHtml(c.is_integral ? 'Integral (100%)' : 'Parcial')}</td>
            <td class="num">${formatInt(c.meals_count)}</td>
            <td class="num">${escapeHtml(formatCurrency(c.gross_amount))}</td>
            <td class="num">${escapeHtml(formatCurrency(c.subsidy_amount))}</td>
            <td class="num">${escapeHtml(formatCurrency(c.student_paid_amount))}</td>
          </tr>`
          )
          .join('') +
        `
          <tr class="total-row">
            <td colspan="3">TOTAL POR CATEGORIA (${report.category_breakdown.length})</td>
            <td class="num">${formatInt(catTotals.meals)}</td>
            <td class="num">${escapeHtml(formatCurrency(catTotals.gross))}</td>
            <td class="num">${escapeHtml(formatCurrency(catTotals.subsidy))}</td>
            <td class="num">${escapeHtml(formatCurrency(catTotals.studentPaid))}</td>
          </tr>`;

  const unitRowsHtml =
    report.unit_breakdown.length === 0
      ? '<tr><td colspan="6" class="empty">Nenhuma movimentação por unidade no período selecionado.</td></tr>'
      : report.unit_breakdown
          .map(
            (u) => `
          <tr>
            <td><strong>${escapeHtml(u.unit_name)}</strong></td>
            <td>${escapeHtml(u.institution_name)}</td>
            <td class="num">${formatInt(u.meals_count)}</td>
            <td class="num">${escapeHtml(formatCurrency(u.gross_amount))}</td>
            <td class="num">${escapeHtml(formatCurrency(u.subsidy_amount))}</td>
            <td class="num">${escapeHtml(formatCurrency(u.student_paid_amount))}</td>
          </tr>`
          )
          .join('') +
        `
          <tr class="total-row">
            <td colspan="2">TOTAL POR UNIDADE (${report.unit_breakdown.length})</td>
            <td class="num">${formatInt(unitTotals.meals)}</td>
            <td class="num">${escapeHtml(formatCurrency(unitTotals.gross))}</td>
            <td class="num">${escapeHtml(formatCurrency(unitTotals.subsidy))}</td>
            <td class="num">${escapeHtml(formatCurrency(unitTotals.studentPaid))}</td>
          </tr>`;

  const contingencyRowsHtml =
    report.contingency_breakdown.length === 0
      ? '<tr><td colspan="7" class="empty">Nenhum lote de contingência aprovado no período selecionado.</td></tr>'
      : report.contingency_breakdown
          .map((b) => {
            const typeLabel =
              b.batch_type === 'type_a_identified'
                ? 'Tipo A (Identificada)'
                : b.batch_type === 'type_b_unidentified_count'
                ? 'Tipo B (Contagem Física)'
                : 'Tipo C (Ajuste)';
            return `
          <tr>
            <td class="mono">${escapeHtml(formatBrDate(b.service_date))}</td>
            <td>${escapeHtml(b.unit_name)}</td>
            <td>${escapeHtml(b.meal_type_name)}</td>
            <td>${escapeHtml(typeLabel)}</td>
            <td class="num">${formatInt(b.total_meals_served)}</td>
            <td class="num">${escapeHtml(formatCurrency(b.total_amount))}</td>
            <td class="num">${escapeHtml(formatCurrency(b.total_subsidy_amount))}</td>
          </tr>`;
          })
          .join('') +
        `
          <tr class="total-row">
            <td colspan="4">TOTAL CONTINGÊNCIA AUDITADA (${report.contingency_breakdown.length})</td>
            <td class="num">${formatInt(contTotals.meals)}</td>
            <td class="num">${escapeHtml(formatCurrency(contTotals.amount))}</td>
            <td class="num">${escapeHtml(formatCurrency(contTotals.subsidy))}</td>
          </tr>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório Financeiro — ${escapeHtml(brand.appName)} (${escapeHtml(report.period.start_date)} a ${escapeHtml(report.period.end_date)})</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Inter", "Segoe UI", Arial, sans-serif;
      color: #0f172a;
      font-size: 10.5px;
      line-height: 1.4;
      background: #ffffff;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid ${safeColor};
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo {
      max-height: 36px;
      max-width: 110px;
      object-fit: contain;
    }
    .doc-title {
      font-size: 15px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      margin: 0;
      color: #0f172a;
    }
    .doc-subtitle {
      font-size: 10px;
      color: #475569;
      margin: 2px 0 0;
    }
    .meta {
      text-align: right;
      font-size: 9.5px;
      color: #475569;
    }
    .meta strong { color: #0f172a; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 14px;
      break-inside: avoid;
    }
    .kpi {
      border: 1px solid #cbd5e1;
      border-top: 3px solid ${safeColor};
      border-radius: 6px;
      padding: 8px 10px;
      background: #f8fafc;
    }
    .kpi-label {
      font-size: 8.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
      letter-spacing: 0.04em;
    }
    .kpi-value {
      font-size: 13px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 3px;
    }
    .kpi-sub {
      font-size: 8.5px;
      color: #64748b;
      margin-top: 2px;
    }
    section {
      margin-bottom: 14px;
    }
    h2 {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: ${safeColor};
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 3px;
      margin: 0 0 6px;
      break-after: avoid;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5px;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: left;
      padding: 5px 6px;
      border: 1px solid #cbd5e1;
      font-size: 8.5px;
      text-transform: uppercase;
    }
    td {
      padding: 5px 6px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
    }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; }
    .total-row td {
      background: #f8fafc;
      font-weight: 800;
      border-top: 1.5px solid #94a3b8;
      color: #0f172a;
    }
    .empty {
      text-align: center;
      color: #64748b;
      font-style: italic;
      padding: 10px;
    }
    .notes {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      background: #f8fafc;
      font-size: 9px;
      color: #334155;
      break-inside: avoid;
    }
    .notes ul { margin: 4px 0 0; padding-left: 16px; }
    .notes li { margin-bottom: 2px; }
    .signatures {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid #cbd5e1;
      break-inside: avoid;
    }
    .sig-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
      margin-top: 30px;
      text-align: center;
    }
    .sig-line {
      border-top: 1px solid #334155;
      padding-top: 4px;
      font-size: 9.5px;
    }
    .sig-role { font-weight: 700; color: #0f172a; }
    .sig-org { font-size: 8.5px; color: #64748b; }
  </style>
</head>
<body>
  <header class="header">
    <div class="brand-row">
      ${safeLogoUrl ? `<img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(brand.appName)}" class="logo" />` : ''}
      <div>
        <h1 class="doc-title">${escapeHtml(brand.appName)} — Demonstrativo Financeiro</h1>
        <p class="doc-subtitle">Período de apuração: <strong>${escapeHtml(formatBrDate(report.period.start_date))}</strong> até <strong>${escapeHtml(formatBrDate(report.period.end_date))}</strong></p>
        <p class="doc-subtitle">${escapeHtml(filterSummary)}</p>
      </div>
    </div>
    <div class="meta">
      <div>Gerado em: <strong>${escapeHtml(formatGeneratedAt(report.generated_at))}</strong></div>
      <div class="mono">Documento Auditável</div>
    </div>
  </header>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Faturamento Bruto</div>
      <div class="kpi-value">${escapeHtml(formatCurrency(summary.total_gross_invoicing))}</div>
      <div class="kpi-sub">${formatInt(summary.total_meals_delivered)} refeições</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Subsídio Institucional</div>
      <div class="kpi-value">${escapeHtml(formatCurrency(summary.total_institutional_subsidy))}</div>
      <div class="kpi-sub">Valor faturável contratante</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Arrecadação Comensais</div>
      <div class="kpi-value">${escapeHtml(formatCurrency(summary.student_paid_amount))}</div>
      <div class="kpi-sub">Receita direta no consumo</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Custódia / Recargas</div>
      <div class="kpi-value">${escapeHtml(formatCurrency(summary.current_custody_liability))}</div>
      <div class="kpi-sub">Recargas período: ${escapeHtml(formatCurrency(summary.recharges_in_period))}</div>
    </div>
  </div>

  <section>
    <h2>1. Resumo Executivo de Volumetria e Faturamento</h2>
    <table>
      <thead>
        <tr>
          <th>Indicador Contábil</th>
          <th class="num">Refeições</th>
          <th class="num">Valor Bruto / Custódia</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Refeições Regulares Servidas</td>
          <td class="num">${formatInt(summary.regular_meals_served)}</td>
          <td class="num">${escapeHtml(formatCurrency(summary.gross_meal_amount))}</td>
        </tr>
        <tr>
          <td>Contingência — Regularizações Individuais (Tipo A)</td>
          <td class="num">${formatInt(summary.contingency_identified_meals ?? 0)}</td>
          <td class="num">${escapeHtml(formatCurrency(summary.contingency_identified_gross ?? 0))}</td>
        </tr>
        <tr>
          <td>Contingência — Regularizações Agregadas (Tipos B/C)</td>
          <td class="num">${formatInt(summary.contingency_aggregated_meals ?? summary.contingency_meals_served)}</td>
          <td class="num">${escapeHtml(formatCurrency(summary.contingency_aggregated_gross ?? summary.contingency_gross_amount))}</td>
        </tr>
        <tr>
          <td>Pendências Mensais Sem Data Alocada (Informativo / Não Faturado)</td>
          <td class="num">${formatInt(summary.unallocated_pending_meals_total ?? 0)}</td>
          <td class="num">—</td>
        </tr>
        <tr class="total-row">
          <td>TOTAL GERAL CONTRATUAL</td>
          <td class="num">${formatInt(summary.total_meals_delivered)}</td>
          <td class="num">${escapeHtml(formatCurrency(summary.total_gross_invoicing))}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>2. Detalhamento por Categoria de Comensal</h2>
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Categoria</th>
          <th>Modalidade</th>
          <th class="num">Refeições</th>
          <th class="num">Faturamento Bruto</th>
          <th class="num">Subsídio</th>
          <th class="num">Coparticipação</th>
        </tr>
      </thead>
      <tbody>${categoryRowsHtml}</tbody>
    </table>
  </section>

  <section>
    <h2>3. Consolidado por Unidade / Restaurante</h2>
    <table>
      <thead>
        <tr>
          <th>Unidade</th>
          <th>Instituição</th>
          <th class="num">Refeições</th>
          <th class="num">Faturamento Bruto</th>
          <th class="num">Subsídio</th>
          <th class="num">Coparticipação</th>
        </tr>
      </thead>
      <tbody>${unitRowsHtml}</tbody>
    </table>
  </section>

  <section>
    <h2>4. Lotes de Contingência Auditada</h2>
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Unidade</th>
          <th>Turno</th>
          <th>Tipologia</th>
          <th class="num">Refeições</th>
          <th class="num">Valor Total</th>
          <th class="num">Subsídio</th>
        </tr>
      </thead>
      <tbody>${contingencyRowsHtml}</tbody>
    </table>
  </section>

  <div class="notes">
    <strong>Notas Explicativas e Conformidade Contábil:</strong>
    <ul>
      <li><strong>Não-Confusão Contábil:</strong> Recargas são registradas como Passivo de Custódia; a conversão em receita ocorre exclusivamente no momento do consumo.</li>
      <li><strong>Contingência Sem Comensais Fictícios:</strong> Lotes Tipo B representam contagem física sem atribuição artificial a matrículas cadastradas.</li>
    </ul>
  </div>

  <div class="signatures">
    <div style="font-size: 9px; color: #475569;">
      <strong>Termo de Encerramento:</strong> Certifico que o presente demonstrativo reflete fidedignamente o livro-razão e os consumos validados no período informado.
    </div>
    <div class="sig-grid">
      <div class="sig-line">
        <div class="sig-role">Gestor Operacional da Unidade</div>
        <div class="sig-org">${escapeHtml(brand.appName)}</div>
      </div>
      <div class="sig-line">
        <div class="sig-role">Fiscal do Contrato / Instituição</div>
        <div class="sig-org">${escapeHtml(filters.institutionName || 'Contratante')}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

