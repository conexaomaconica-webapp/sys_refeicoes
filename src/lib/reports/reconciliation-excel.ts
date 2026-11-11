import * as XLSX from 'xlsx';
import { sanitizeCellForExport } from '../security/formula-sanitizer';
import type {
  DailyClosingSummary,
  ReconciliationBatch,
  ReconciliationDivergence,
  ReconciliationKPIs,
} from '@/types/reconciliation';

export function generateReconciliationExcelWorkbook(data: {
  kpis: ReconciliationKPIs;
  latestBatch: ReconciliationBatch | null;
  divergences: ReconciliationDivergence[];
  dailyClosings: DailyClosingSummary[];
  period: { startDate: string; endDate: string };
}): Buffer {
  const wb = XLSX.utils.book_new();

  // 1. Aba Resumo Executivo e KPIs
  const kpiRows = [
    { Indicador: 'Período Inicial', Valor: data.period.startDate },
    { Indicador: 'Período Final', Valor: data.period.endDate },
    { Indicador: '---', Valor: '---' },
    { Indicador: 'Volume Total Auditado (R$)', Valor: data.kpis.totalAuditedAmount.toFixed(2) },
    { Indicador: 'Volume Casado/Conciliado (R$)', Valor: data.kpis.matchedAmount.toFixed(2) },
    { Indicador: 'Taxa de Conciliação (%)', Valor: `${data.kpis.reconciliationRatePercent.toFixed(2)}%` },
    { Indicador: '---', Valor: '---' },
    { Indicador: 'Total de Divergências Abertas', Valor: data.kpis.openDivergencesCount },
    { Indicador: 'Divergências de Gravidade Crítica', Valor: data.kpis.criticalDivergencesCount },
    { Indicador: 'Cobranças Pendentes no Gateway', Valor: data.kpis.totalPendingPaymentsCount },
    { Indicador: 'Passivo Real em Custódia (Saldo Carteiras R$)', Valor: data.kpis.totalCustodyBalance.toFixed(2) },
    { Indicador: 'Diferença Patrimonial Custódia vs Ledger (R$)', Valor: data.kpis.custodyLedgerDrift.toFixed(2) },
  ].map((r) => ({
    Indicador: sanitizeCellForExport(r.Indicador),
    Valor: sanitizeCellForExport(r.Valor),
  }));

  const kpiSheet = XLSX.utils.json_to_sheet(kpiRows);
  XLSX.utils.book_append_sheet(wb, kpiSheet, 'Resumo Conciliação');

  // 2. Aba Divergências Detectadas
  const divRows = data.divergences.map((d) => ({
    'Data/Hora': sanitizeCellForExport(d.created_at),
    'Tipo de Divergência': sanitizeCellForExport(d.divergence_type),
    'Severidade': sanitizeCellForExport(d.severity.toUpperCase()),
    'Status': sanitizeCellForExport(d.status),
    'Comensal / Matrícula': sanitizeCellForExport(d.student_registration || d.student_name || 'N/A'),
    'Valor Esperado (R$)': sanitizeCellForExport(d.expected_amount.toFixed(2)),
    'Valor Apurado (R$)': sanitizeCellForExport(d.actual_amount.toFixed(2)),
    'Diferença (R$)': sanitizeCellForExport(d.difference_amount.toFixed(2)),
    'Descrição': sanitizeCellForExport(d.description),
    'Resolução': sanitizeCellForExport(d.resolution_notes || 'Pendente'),
  }));

  const divSheet = XLSX.utils.json_to_sheet(divRows.length > 0 ? divRows : [{ Info: 'Nenhuma divergência registrada' }]);
  XLSX.utils.book_append_sheet(wb, divSheet, 'Divergências');

  // 3. Aba Fechamento Diário
  const closingRows = data.dailyClosings.map((c) => ({
    'Data': sanitizeCellForExport(c.closing_date),
    'Unidade': sanitizeCellForExport(c.unit_name || 'Consolidado'),
    'Recebimentos Pix (R$)': sanitizeCellForExport(c.pix_receipts_amount.toFixed(2)),
    'Recebimentos Cartão (R$)': sanitizeCellForExport(c.card_receipts_amount.toFixed(2)),
    'Recebimentos Dinheiro (R$)': sanitizeCellForExport(c.cash_receipts_amount.toFixed(2)),
    'Total Recebimentos Brutos (R$)': sanitizeCellForExport(c.total_receipts_by_method.toFixed(2)),
    'Créditos em Carteira no Ledger (R$)': sanitizeCellForExport(c.wallet_credits_added.toFixed(2)),
    'Consumos Debitados da Carteira (R$)': sanitizeCellForExport(c.wallet_debits_consumed.toFixed(2)),
    'Passivo Final em Custódia (R$)': sanitizeCellForExport(c.closing_custody_balance.toFixed(2)),
    'Deriva Patrimonial (R$)': sanitizeCellForExport(c.custody_ledger_drift.toFixed(2)),
    'Receita Realizada Alunos (R$)': sanitizeCellForExport(c.realized_student_revenue.toFixed(2)),
    'Subsídios Regulares (R$)': sanitizeCellForExport(c.contractual_subsidies.toFixed(2)),
    'Subsídios Contingência (R$)': sanitizeCellForExport(c.contingency_subsidies.toFixed(2)),
    'Estornos (R$)': sanitizeCellForExport(c.refunds_amount.toFixed(2)),
    'Divergências': sanitizeCellForExport(c.unresolved_divergences_count),
    'Status': sanitizeCellForExport(c.status),
  }));

  const closingSheet = XLSX.utils.json_to_sheet(closingRows.length > 0 ? closingRows : [{ Info: 'Sem fechamentos registrados' }]);
  XLSX.utils.book_append_sheet(wb, closingSheet, 'Fechamento Diário');

  // 4. Aba Normas e Critérios de Conciliação
  const rulesRows = [
    { Critério: 'Passivo de Custódia vs Receita', Descrição: 'Recargas de carteira são passivo circulante. Receita é reconhecida no consumo.' },
    { Critério: 'Falta de Crédito (missing_ledger_credit)', Descrição: 'Cobrança confirmada pelo gateway onde o aluno não recebeu saldo no ledger.' },
    { Critério: 'Crédito Órfão (orphan_ledger_credit)', Descrição: 'Lançamento positivo no ledger de recarga sem confirmação no gateway.' },
    { Critério: 'Idempotência', Descrição: 'Webhooks repetidos ou atrasados não podem creditar saldo em duplicidade.' },
    { Critério: 'Proibição de Lançamentos Automáticos', Descrição: 'Divergências devem ser auditadas. Proibido compensar sem regra e aprovação.' },
  ].map((r) => ({
    Critério: sanitizeCellForExport(r.Critério),
    Descrição: sanitizeCellForExport(r.Descrição),
  }));

  const rulesSheet = XLSX.utils.json_to_sheet(rulesRows);
  XLSX.utils.book_append_sheet(wb, rulesSheet, 'Normas de Auditoria');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

