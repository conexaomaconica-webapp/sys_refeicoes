export type ReconciliationBatchStatus =
  | 'in_progress'
  | 'completed'
  | 'completed_with_divergences'
  | 'failed';

export type ReconciliationDivergenceType =
  | 'missing_ledger_credit'
  | 'orphan_ledger_credit'
  | 'amount_mismatch'
  | 'delayed_webhook'
  | 'cancelled_with_credit'
  | 'refund_mismatch'
  | 'duplicate_webhook_attempt';

export type DivergenceSeverity = 'critical' | 'high' | 'medium' | 'low';

export type DivergenceStatus = 'open' | 'under_review' | 'resolved' | 'acknowledged_manual';

export interface ReconciliationBatch {
  id: string;
  tenant_id: string;
  reference_date: string;
  period_start: string;
  period_end: string;
  total_payments_analyzed: number;
  total_credits_analyzed: number;
  matched_count: number;
  matched_amount: number;
  divergences_count: number;
  divergences_amount: number;
  status: ReconciliationBatchStatus;
  executed_by?: string | null;
  created_at: string;
  completed_at?: string | null;
  summary: {
    reconciliation_rate_percent?: number;
    total_audited_volume?: number;
  };
}

export interface ReconciliationDivergence {
  id: string;
  tenant_id: string;
  batch_id?: string | null;
  divergence_type: ReconciliationDivergenceType;
  severity: DivergenceSeverity;
  payment_id?: string | null;
  recharge_id?: string | null;
  ledger_tx_id?: string | null;
  student_id?: string | null;
  student_name?: string | null;
  student_registration?: string | null;
  expected_amount: number;
  actual_amount: number;
  difference_amount: number;
  description: string;
  status: DivergenceStatus;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_notes?: string | null;
  created_at: string;
}

export interface DailyClosingSummary {
  id?: string;
  unit_id?: string | null;
  unit_name?: string | null;
  closing_date: string;
  pix_receipts_amount: number;
  card_receipts_amount: number;
  cash_receipts_amount: number;
  total_receipts_by_method: number;   // Entradas brutas por meio de pagamento (Pix + Cartão + Dinheiro)
  wallet_credits_added: number;       // Créditos efetivamente lançados no ledger (recargas/estornos+)
  wallet_debits_consumed: number;     // Baixas de custódia por consumo de refeições no ledger
  closing_custody_balance: number;    // Passivo real sob custódia devido aos comensais (SUM wallets.balance)
  custody_ledger_drift: number;       // Diferença de batimento patrimonial (wallets.balance vs SUM ledger)
  realized_student_revenue: number;   // Consumo direto do aluno (Receita Realizada)
  contractual_subsidies: number;      // Subsídio regular faturável
  contingency_subsidies: number;      // Subsídio de contingência faturável
  refunds_amount: number;             // Estornos
  unresolved_divergences_count: number;
  status: 'balanced' | 'divergent' | 'closed';
  is_persisted?: boolean;
  health_status?: 'balanced' | 'divergent';
  closed_by?: string | null;
  closed_at?: string | null;
  closing_notes?: string | null;
}

export interface ReconciliationKPIs {
  totalAuditedAmount: number;
  matchedAmount: number;
  reconciliationRatePercent: number;
  openDivergencesCount: number;
  criticalDivergencesCount: number;
  totalPendingPaymentsCount: number;
  totalCustodyBalance: number;
  custodyLedgerDrift: number;
  isCustodyBalanced: boolean;
}

export interface ReconciliationFilters {
  startDate: string;
  endDate: string;
  unitId?: string;
  divergenceType?: string;
  severity?: string;
  status?: string;
}

export interface ReconciliationDashboardData {
  kpis: ReconciliationKPIs;
  latestBatch: ReconciliationBatch | null;
  divergences: ReconciliationDivergence[];
  dailyClosings: DailyClosingSummary[];
  period: {
    startDate: string;
    endDate: string;
  };
  units: Array<{ id: string; name: string }>;
  userRole: string;
  userCanManage: boolean;
}

export interface ResolveDivergenceInput {
  divergenceId: string;
  resolutionStatus: 'resolved' | 'acknowledged_manual' | 'under_review';
  resolutionNotes: string;
}

export interface CloseDailyPeriodInput {
  closingDate: string;
  unitId?: string | null;
  notes: string;
}

