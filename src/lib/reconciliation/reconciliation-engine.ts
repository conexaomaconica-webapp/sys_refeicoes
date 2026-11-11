import type {
  DailyClosingSummary,
  ReconciliationDivergence,
} from '@/types/reconciliation';

export interface RawPayment {
  id: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'refunded';
  method: 'pix' | 'credit_card' | 'debit_card' | 'cash';
  student_id: string;
  created_at: string;
  confirmed_at?: string | null;
}

export interface RawRecharge {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'failed' | 'reversed';
}

export interface RawLedgerTransaction {
  id: string;
  amount: number;
  type: string;
  reference_type: string;
  reference_id: string;
  student_id: string;
  created_at: string;
}

export interface RawDailyConsumption {
  id: string;
  unit_id: string;
  unit_name?: string;
  student_price: number;
  subsidy_amount: number;
  full_price: number;
  consumption_date: string;
}

export interface RawContingencyBatch {
  id: string;
  unit_id: string;
  unit_name?: string;
  service_date: string;
  total_meals_served: number;
  total_amount: number;
  total_subsidy_amount: number;
  status: 'pending' | 'approved' | 'rejected';
}

export interface EngineAuditResult {
  matchedCount: number;
  matchedAmount: number;
  divergencesCount: number;
  divergencesAmount: number;
  reconciliationRatePercent: number;
  divergences: Array<Omit<ReconciliationDivergence, 'id' | 'tenant_id' | 'created_at'>>;
}

/**
 * Motor puro de batimento financeiro: compara pagamentos confirmados com lançamentos de crédito no ledger.
 */
export function auditPaymentTransactions(
  payments: RawPayment[],
  recharges: RawRecharge[],
  ledgerTransactions: RawLedgerTransaction[]
): EngineAuditResult {
  const rechargesByPayment = new Map<string, RawRecharge>();
  for (const r of recharges) {
    rechargesByPayment.set(r.payment_id, r);
  }

  const creditByPayment = new Map<string, RawLedgerTransaction>();
  const refundByPayment = new Map<string, RawLedgerTransaction>();
  for (const tx of ledgerTransactions) {
    if (tx.reference_type === 'payment') {
      if (tx.type === 'recharge' && tx.amount > 0) {
        creditByPayment.set(tx.reference_id, tx);
      } else if ((tx.type === 'refund' || tx.type === 'adjustment') && tx.amount < 0) {
        refundByPayment.set(tx.reference_id, tx);
      }
    }
  }

  let matchedCount = 0;
  let matchedAmount = 0;
  let divergencesCount = 0;
  let divergencesAmount = 0;
  const divergences: Array<Omit<ReconciliationDivergence, 'id' | 'tenant_id' | 'created_at'>> = [];

  // 1. Verificar cada pagamento contra o ledger
  for (const pay of payments) {
    const recharge = rechargesByPayment.get(pay.id);
    const ledgerTx = creditByPayment.get(pay.id);
    const refundTx = refundByPayment.get(pay.id);

    if (pay.status === 'confirmed') {
      if (!ledgerTx) {
        divergencesCount++;
        divergencesAmount += pay.amount;
        divergences.push({
          divergence_type: 'missing_ledger_credit',
          severity: 'critical',
          payment_id: pay.id,
          recharge_id: recharge?.id || null,
          student_id: pay.student_id,
          expected_amount: pay.amount,
          actual_amount: 0,
          difference_amount: pay.amount,
          description: `Cobrança de R$ ${pay.amount.toFixed(2)} confirmada no gateway mas sem lançamento no ledger da carteira.`,
          status: 'open',
        });
      } else if (Number(ledgerTx.amount.toFixed(2)) !== Number(pay.amount.toFixed(2))) {
        const diff = Math.abs(pay.amount - ledgerTx.amount);
        divergencesCount++;
        divergencesAmount += diff;
        divergences.push({
          divergence_type: 'amount_mismatch',
          severity: 'high',
          payment_id: pay.id,
          recharge_id: recharge?.id || null,
          ledger_tx_id: ledgerTx.id,
          student_id: pay.student_id,
          expected_amount: pay.amount,
          actual_amount: ledgerTx.amount,
          difference_amount: diff,
          description: `Valor cobrado (R$ ${pay.amount.toFixed(2)}) diverge do valor creditado no ledger (R$ ${ledgerTx.amount.toFixed(2)}).`,
          status: 'open',
        });
      } else {
        matchedCount++;
        matchedAmount += pay.amount;
      }
    } else if (pay.status === 'refunded' && ledgerTx) {
      if (!refundTx) {
        divergencesCount++;
        divergencesAmount += ledgerTx.amount;
        divergences.push({
          divergence_type: 'refund_mismatch',
          severity: 'high',
          payment_id: pay.id,
          recharge_id: recharge?.id || null,
          ledger_tx_id: ledgerTx.id,
          student_id: pay.student_id,
          expected_amount: 0,
          actual_amount: ledgerTx.amount,
          difference_amount: ledgerTx.amount,
          description: `Cobrança estornada no gateway sem lançamento compensatório de estorno no ledger.`,
          status: 'open',
        });
      } else {
        matchedCount++;
        matchedAmount += pay.amount;
      }
    } else if (['failed', 'cancelled'].includes(pay.status) && ledgerTx) {
      divergencesCount++;
      divergencesAmount += ledgerTx.amount;
      divergences.push({
        divergence_type: 'cancelled_with_credit',
        severity: 'critical',
        payment_id: pay.id,
        recharge_id: recharge?.id || null,
        ledger_tx_id: ledgerTx.id,
        student_id: pay.student_id,
        expected_amount: 0,
        actual_amount: ledgerTx.amount,
        difference_amount: ledgerTx.amount,
        description: `Cobrança cancelada/falha possui crédito indevido ativo de R$ ${ledgerTx.amount.toFixed(2)} no ledger.`,
        status: 'open',
      });
    }
  }

  // 2. Análise Inversa: Lançamentos no Ledger de recarga sem qualquer cobrança registrada
  const allPaymentIds = new Set(payments.map((p) => p.id));

  for (const tx of ledgerTransactions) {
    if (tx.reference_type === 'payment' && tx.type === 'recharge' && !allPaymentIds.has(tx.reference_id)) {
      divergencesCount++;
      divergencesAmount += tx.amount;
      divergences.push({
        divergence_type: 'orphan_ledger_credit',
        severity: 'critical',
        ledger_tx_id: tx.id,
        student_id: tx.student_id,
        expected_amount: 0,
        actual_amount: tx.amount,
        difference_amount: tx.amount,
        description: `Crédito de recarga no ledger de R$ ${tx.amount.toFixed(2)} sem cobrança registrada no gateway.`,
        status: 'open',
      });
    }
  }

  const totalAuditedEvents = matchedCount + divergencesCount;
  const reconciliationRatePercent =
    totalAuditedEvents > 0 ? Number(((matchedCount / totalAuditedEvents) * 100).toFixed(2)) : 100.0;

  return {
    matchedCount,
    matchedAmount: Number(matchedAmount.toFixed(2)),
    divergencesCount,
    divergencesAmount: Number(divergencesAmount.toFixed(2)),
    reconciliationRatePercent,
    divergences,
  };
}

/**
 * Apuração do Fechamento Diário: Segregação estrita entre meios de recebimento,
 * movimentação real de custódia no ledger (créditos - débitos ± ajustes) e receita realizada.
 */
export function computeDailyClosingSheet(
  date: string,
  payments: RawPayment[],
  consumptions: RawDailyConsumption[],
  contingencyBatches: RawContingencyBatch[],
  refundsAmount = 0,
  unresolvedDivergencesCount = 0,
  options?: {
    ledgerTransactions?: RawLedgerTransaction[];
    closingCustodyBalance?: number;
    custodyLedgerDrift?: number;
  }
): DailyClosingSummary {
  let pixAmount = 0;
  let cardAmount = 0;
  let cashAmount = 0;

  for (const p of payments) {
    if (p.status === 'confirmed') {
      if (p.method === 'pix') pixAmount += p.amount;
      else if (p.method === 'cash') cashAmount += p.amount;
      else cardAmount += p.amount;
    }
  }

  // Entradas brutas recebidas por meio de pagamento (NÃO equivale automaticamente ao passivo final)
  const totalReceiptsByMethod = pixAmount + cardAmount + cashAmount;

  // Movimentação efetiva de custódia apurada no livro-razão (créditos - baixas por consumo/estorno)
  const ledgerTxs = options?.ledgerTransactions || [];
  let walletCreditsAdded = 0;
  let walletDebitsConsumed = 0;

  for (const tx of ledgerTxs) {
    if (tx.amount > 0) {
      walletCreditsAdded += tx.amount;
    } else if (tx.amount < 0) {
      walletDebitsConsumed += Math.abs(tx.amount);
    }
  }

  const closingCustodyBalance = Number((options?.closingCustodyBalance ?? 0).toFixed(2));
  const custodyLedgerDrift = Number((options?.custodyLedgerDrift ?? 0).toFixed(2));

  // Receita operacional dos alunos e subsídios regulares
  let realizedStudentRevenue = 0;
  let contractualSubsidies = 0;

  for (const c of consumptions) {
    realizedStudentRevenue += c.student_price;
    contractualSubsidies += c.subsidy_amount;
  }

  // Lotes de contingência aprovados
  let contingencySubsidies = 0;
  for (const cb of contingencyBatches) {
    if (cb.status === 'approved') {
      contingencySubsidies += cb.total_subsidy_amount;
    }
  }

  const isDivergent = unresolvedDivergencesCount > 0 || Math.abs(custodyLedgerDrift) > 0.009;

  return {
    closing_date: date,
    pix_receipts_amount: Number(pixAmount.toFixed(2)),
    card_receipts_amount: Number(cardAmount.toFixed(2)),
    cash_receipts_amount: Number(cashAmount.toFixed(2)),
    total_receipts_by_method: Number(totalReceiptsByMethod.toFixed(2)),
    wallet_credits_added: Number(walletCreditsAdded.toFixed(2)),
    wallet_debits_consumed: Number(walletDebitsConsumed.toFixed(2)),
    closing_custody_balance: closingCustodyBalance,
    custody_ledger_drift: custodyLedgerDrift,
    realized_student_revenue: Number(realizedStudentRevenue.toFixed(2)),
    contractual_subsidies: Number(contractualSubsidies.toFixed(2)),
    contingency_subsidies: Number(contingencySubsidies.toFixed(2)),
    refunds_amount: Number(refundsAmount.toFixed(2)),
    unresolved_divergences_count: unresolvedDivergencesCount,
    status: isDivergent ? 'divergent' : 'balanced',
  };
}
