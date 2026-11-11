import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  auditPaymentTransactions,
  computeDailyClosingSheet,
  type RawContingencyBatch,
  type RawDailyConsumption,
  type RawLedgerTransaction,
  type RawPayment,
  type RawRecharge,
} from '@/lib/reconciliation/reconciliation-engine';
import type {
  CloseDailyPeriodInput,
  DailyClosingSummary,
  ReconciliationBatch,
  ReconciliationDashboardData,
  ReconciliationDivergence,
  ReconciliationFilters,
  ReconciliationKPIs,
  ResolveDivergenceInput,
} from '@/types/reconciliation';

type RpcCaller = (
  functionName: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

interface QueryFilterBuilder {
  eq: (column: string, value: unknown) => QueryFilterBuilder;
  gte: (column: string, value: unknown) => QueryFilterBuilder;
  lte: (column: string, value: unknown) => QueryFilterBuilder;
  order: (column: string, options: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>;
}

type DynamicTableCaller = (table: string) => {
  select: (columns: string) => QueryFilterBuilder;
  update: (values: Record<string, unknown>) => {
    eq: (col1: string, val1: unknown) => {
      eq: (col2: string, val2: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Carrega metadados iniciais e valida permissão para a tela de conciliação.
 */
export async function getReconciliationInitialData() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('AUTH_REQUIRED: Sessão expirada. Faça login novamente.');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { id: string; tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    throw new Error('ACTIVE_PROFILE_REQUIRED: Perfil de usuário inativo ou não autorizado.');
  }

  const allowedRoles = ['admin_general', 'operations_director', 'finance'];
  if (!allowedRoles.includes(profile.role)) {
    throw new Error('PERMISSION_DENIED: Acesso restrito à auditoria de conciliação financeira.');
  }

  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const defaultStartDate = firstDayOfMonth.toISOString().split('T')[0];
  const defaultEndDate = today.toISOString().split('T')[0];

  const { data: unitsData } = await supabase
    .from('units')
    .select('id,name')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .order('name');

  return {
    defaultStartDate,
    defaultEndDate,
    units: (unitsData || []) as Array<{ id: string; name: string }>,
    userRole: profile.role,
    userCanManage: true,
  };
}

/**
 * Consulta e consolida o dashboard completo de conciliação financeira.
 */
export async function getReconciliationDashboard(
  filters: ReconciliationFilters
): Promise<ReconciliationDashboardData> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('AUTH_REQUIRED: Autenticação necessária.');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { id: string; tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    throw new Error('ACTIVE_PROFILE_REQUIRED: Perfil inativo ou não autorizado.');
  }

  if (!['admin_general', 'operations_director', 'finance'].includes(profile.role)) {
    throw new Error('PERMISSION_DENIED: Perfil sem permissão para módulo de conciliação.');
  }

  const { startDate, endDate, unitId } = filters;
  if (!startDate || !endDate || endDate < startDate) {
    throw new Error('INVALID_DATE_RANGE: Período de conciliação inválido.');
  }

  // 1. Buscar pagamentos e lançamentos no período com janela protegida para batimento de fronteira (meia-noite)
  const [paymentsRes, ledgerPeriodRes, walletsRes, unitsRes] = await Promise.all([
    supabase
      .from('payments')
      .select('id, amount, status, method, student_id, created_at, confirmed_at')
      .eq('tenant_id', profile.tenant_id)
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`),
    supabase
      .from('wallet_transactions')
      .select('id, amount, type, reference_type, reference_id, student_id, created_at')
      .eq('tenant_id', profile.tenant_id)
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`),
    supabase
      .from('wallets')
      .select('balance')
      .eq('tenant_id', profile.tenant_id),
    supabase
      .from('units')
      .select('id, name')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'active')
      .order('name'),
  ]);

  const rawPayments = ((paymentsRes.data || []) as unknown) as RawPayment[];
  const periodLedger = ((ledgerPeriodRes.data || []) as unknown) as RawLedgerTransaction[];

  // Resolver contrapartes fora da fronteira de data (evita falsos positivos de virada de dia)
  const paymentIds = rawPayments.map((p) => p.id);
  const ledgerPaymentIds = periodLedger
    .filter((tx) => tx.reference_type === 'payment' && tx.reference_id)
    .map((tx) => tx.reference_id);

  const missingPaymentIds = ledgerPaymentIds.filter((id) => !paymentIds.includes(id));

  const [rechargesRes, extraLedgerRes, extraPaymentsRes] = await Promise.all([
    paymentIds.length > 0
      ? supabase
          .from('recharges')
          .select('id, payment_id, amount, status')
          .eq('tenant_id', profile.tenant_id)
          .in('payment_id', paymentIds)
      : Promise.resolve({ data: [] }),
    paymentIds.length > 0
      ? supabase
          .from('wallet_transactions')
          .select('id, amount, type, reference_type, reference_id, student_id, created_at')
          .eq('tenant_id', profile.tenant_id)
          .eq('reference_type', 'payment')
          .in('reference_id', paymentIds)
      : Promise.resolve({ data: [] }),
    missingPaymentIds.length > 0
      ? supabase
          .from('payments')
          .select('id, amount, status, method, student_id, created_at, confirmed_at')
          .eq('tenant_id', profile.tenant_id)
          .in('id', missingPaymentIds)
      : Promise.resolve({ data: [] }),
  ]);

  const rawRecharges = ((rechargesRes.data || []) as unknown) as RawRecharge[];

  // Unificar listas sem duplicar IDs para o batimento exato
  const mergedPaymentsMap = new Map<string, RawPayment>();
  for (const p of rawPayments) mergedPaymentsMap.set(p.id, p);
  for (const p of ((extraPaymentsRes.data || []) as unknown) as RawPayment[]) mergedPaymentsMap.set(p.id, p);

  const mergedLedgerMap = new Map<string, RawLedgerTransaction>();
  for (const tx of periodLedger) mergedLedgerMap.set(tx.id, tx);
  for (const tx of ((extraLedgerRes.data || []) as unknown) as RawLedgerTransaction[]) mergedLedgerMap.set(tx.id, tx);

  // 2. Executar auditoria do motor de conciliação
  const auditResult = auditPaymentTransactions(
    Array.from(mergedPaymentsMap.values()),
    rawRecharges,
    Array.from(mergedLedgerMap.values())
  );

  // 3. Buscar divergências registradas na tabela (se houver lote já gerado)
  const { data: dbDivergences } = await (supabase.from as unknown as DynamicTableCaller)('financial_reconciliation_divergences')
    .select(`
      id, tenant_id, batch_id, divergence_type, severity, payment_id, recharge_id, ledger_tx_id,
      student_id, expected_amount, actual_amount, difference_amount, description, status,
      resolved_by, resolved_at, resolution_notes, created_at,
      students (full_name, registration_number)
    `)
    .eq('tenant_id', profile.tenant_id)
    .gte('created_at', `${startDate}T00:00:00`)
    .lte('created_at', `${endDate}T23:59:59`)
    .order('created_at', { ascending: false });

  interface DbDivRow {
    id: string;
    tenant_id: string;
    batch_id: string | null;
    divergence_type: string;
    severity: string;
    payment_id: string | null;
    recharge_id: string | null;
    ledger_tx_id: string | null;
    student_id: string | null;
    expected_amount: number;
    actual_amount: number;
    difference_amount: number;
    description: string;
    status: string;
    resolved_by: string | null;
    resolved_at: string | null;
    resolution_notes: string | null;
    created_at: string;
    students: { full_name: string; registration_number: string } | null;
  }

  let finalDivergences: ReconciliationDivergence[] = [];
  const rawDivergences = Array.isArray(dbDivergences) ? (dbDivergences as unknown as DbDivRow[]) : [];

  if (rawDivergences.length > 0) {
    finalDivergences = rawDivergences.map((d) => ({
      id: d.id,
      tenant_id: d.tenant_id,
      batch_id: d.batch_id,
      divergence_type: d.divergence_type as ReconciliationDivergence['divergence_type'],
      severity: d.severity as ReconciliationDivergence['severity'],
      payment_id: d.payment_id,
      recharge_id: d.recharge_id,
      ledger_tx_id: d.ledger_tx_id,
      student_id: d.student_id,
      student_name: d.students?.full_name || null,
      student_registration: d.students?.registration_number || null,
      expected_amount: Number(d.expected_amount) || 0,
      actual_amount: Number(d.actual_amount) || 0,
      difference_amount: Number(d.difference_amount) || 0,
      description: d.description,
      status: d.status as ReconciliationDivergence['status'],
      resolved_by: d.resolved_by,
      resolved_at: d.resolved_at,
      resolution_notes: d.resolution_notes,
      created_at: d.created_at,
    }));
  } else {
    finalDivergences = auditResult.divergences.map((d, index) => ({
      ...d,
      id: `dyn-div-${index + 1}`,
      tenant_id: profile.tenant_id,
      created_at: new Date().toISOString(),
    }));
  }

  // 4. Batimento Patrimonial da Custódia (wallets.balance vs SUM wallet_transactions.amount)
  let totalCustodyBalance = (walletsRes.data || []).reduce(
    (acc: number, w: { balance: number }) => acc + Number(w.balance || 0),
    0
  );
  let custodyLedgerDrift = 0;
  let isCustodyBalanced = true;

  try {
    const { data: custodyAuditData, error: custodyAuditErr } = await (supabase.rpc as unknown as RpcCaller)(
      'audit_wallet_custody_integrity',
      { p_tenant_id: profile.tenant_id }
    );
    if (!custodyAuditErr && custodyAuditData) {
      const ca = custodyAuditData as {
        wallets_custody_balance?: number;
        custody_drift?: number;
        is_patrimony_balanced?: boolean;
      };
      totalCustodyBalance = Number(ca.wallets_custody_balance ?? totalCustodyBalance);
      custodyLedgerDrift = Number(ca.custody_drift ?? 0);
      isCustodyBalanced = Boolean(ca.is_patrimony_balanced ?? true);
    }
  } catch {
    // Caso a migration 81 ainda não esteja aplicada no ambiente remoto, preserva cálculo local de saldo de carteiras
  }

  // 5. Fechamento diário sintetizado (respeitando filtro de unidade quando aplicado)
  let consumptionsQuery = supabase
    .from('meal_consumptions')
    .select('id, unit_id, student_price, subsidy_amount, full_price, consumption_date')
    .eq('tenant_id', profile.tenant_id)
    .gte('consumption_date', startDate)
    .lte('consumption_date', endDate)
    .in('status', ['approved', 'financially_refunded']);

  let contingencyQuery = supabase
    .from('contingency_meal_batches')
    .select('id, unit_id, service_date, total_meals_served, total_amount, total_subsidy_amount, status')
    .eq('tenant_id', profile.tenant_id)
    .gte('service_date', startDate)
    .lte('service_date', endDate)
    .eq('status', 'approved');

  if (unitId) {
    consumptionsQuery = consumptionsQuery.eq('unit_id', unitId);
    contingencyQuery = contingencyQuery.eq('unit_id', unitId);
  }

  const [consumptionsRes, contingencyRes] = await Promise.all([consumptionsQuery, contingencyQuery]);

  const rawConsumptions = ((consumptionsRes.data || []) as unknown) as RawDailyConsumption[];
  const rawContingency = ((contingencyRes.data || []) as unknown) as RawContingencyBatch[];

  const unitNameById = new Map<string, string>(
    ((unitsRes.data || []) as Array<{ id: string; name: string }>).map((u) => [u.id, u.name])
  );

  const previewDailyClosing: DailyClosingSummary = {
    ...computeDailyClosingSheet(
      endDate,
      rawPayments,
      rawConsumptions,
      rawContingency,
      0,
      finalDivergences.filter((d) => d.status === 'open').length,
      {
        ledgerTransactions: periodLedger,
        closingCustodyBalance: totalCustodyBalance,
        custodyLedgerDrift,
      }
    ),
    unit_id: unitId || null,
    unit_name: unitId ? unitNameById.get(unitId) || 'Unidade' : 'Consolidado',
    is_persisted: false,
  };

  // Consultar histórico persistido em public.financial_daily_closings
  const persistedClosings: DailyClosingSummary[] = [];
  try {
    let closingsQuery = (supabase.from as unknown as DynamicTableCaller)('financial_daily_closings')
      .select(
        'id, unit_id, closing_date, pix_receipts_amount, card_receipts_amount, cash_receipts_amount, total_receipts_by_method, wallet_credits_added, wallet_debits_consumed, closing_custody_balance, custody_ledger_drift, realized_student_revenue, contractual_subsidies, contingency_subsidies, refunds_amount, unresolved_divergences_count, status, closed_by, created_at, metadata'
      )
      .eq('tenant_id', profile.tenant_id)
      .gte('closing_date', startDate)
      .lte('closing_date', endDate);

    if (unitId) {
      closingsQuery = closingsQuery.eq('unit_id', unitId);
    }

    const { data: closingRows } = await closingsQuery.order('closing_date', { ascending: false });

    if (Array.isArray(closingRows)) {
      for (const rawRow of closingRows) {
        const row = rawRow as Record<string, unknown>;
        const meta = ((row.metadata as Record<string, unknown> | null) || {}) as Record<string, unknown>;
        const rowUnitId = row.unit_id ? String(row.unit_id) : null;
        persistedClosings.push({
          id: String(row.id),
          unit_id: rowUnitId,
          unit_name: rowUnitId ? unitNameById.get(rowUnitId) || 'Unidade' : 'Consolidado',
          closing_date: String(row.closing_date),
          pix_receipts_amount: Number(row.pix_receipts_amount || 0),
          card_receipts_amount: Number(row.card_receipts_amount || 0),
          cash_receipts_amount: Number(row.cash_receipts_amount || 0),
          total_receipts_by_method: Number(row.total_receipts_by_method || 0),
          wallet_credits_added: Number(row.wallet_credits_added || 0),
          wallet_debits_consumed: Number(row.wallet_debits_consumed || 0),
          closing_custody_balance: Number(row.closing_custody_balance || 0),
          custody_ledger_drift: Number(row.custody_ledger_drift || 0),
          realized_student_revenue: Number(row.realized_student_revenue || 0),
          contractual_subsidies: Number(row.contractual_subsidies || 0),
          contingency_subsidies: Number(row.contingency_subsidies || 0),
          refunds_amount: Number(row.refunds_amount || 0),
          unresolved_divergences_count: Number(row.unresolved_divergences_count || 0),
          status: (String(row.status || 'closed') as DailyClosingSummary['status']),
          is_persisted: true,
          health_status: meta.health_status === 'divergent' ? 'divergent' : 'balanced',
          closed_by: row.closed_by ? String(row.closed_by) : null,
          closed_at: meta.closed_at ? String(meta.closed_at) : String(row.created_at),
          closing_notes: meta.notes ? String(meta.notes) : null,
        });
      }
    }
  } catch {
    // Mantém prévia dinâmica caso a tabela/migration não esteja presente no ambiente conectado
  }

  const targetScopeHasPersisted = persistedClosings.some(
    (c) => c.closing_date === endDate && (c.unit_id || null) === (unitId || null)
  );
  const dailyClosings: DailyClosingSummary[] = targetScopeHasPersisted
    ? persistedClosings
    : [previewDailyClosing, ...persistedClosings];

  const pendingPaymentsCount = rawPayments.filter((p) => p.status === 'pending').length;

  const kpis: ReconciliationKPIs = {
    totalAuditedAmount: Number((auditResult.matchedAmount + auditResult.divergencesAmount).toFixed(2)),
    matchedAmount: auditResult.matchedAmount,
    reconciliationRatePercent: auditResult.reconciliationRatePercent,
    openDivergencesCount: finalDivergences.filter((d) => d.status === 'open').length,
    criticalDivergencesCount: finalDivergences.filter((d) => d.severity === 'critical' && d.status === 'open').length,
    totalPendingPaymentsCount: pendingPaymentsCount,
    totalCustodyBalance: Number(totalCustodyBalance.toFixed(2)),
    custodyLedgerDrift: Number(custodyLedgerDrift.toFixed(2)),
    isCustodyBalanced,
  };

  // Buscar último lote persistido em financial_reconciliation_batches quando disponível
  let persistedBatch: ReconciliationBatch | null = null;
  try {
    const { data: batchRows } = await (supabase.from as unknown as DynamicTableCaller)('financial_reconciliation_batches')
      .select('id, tenant_id, reference_date, period_start, period_end, total_payments_analyzed, total_credits_analyzed, matched_count, matched_amount, divergences_count, divergences_amount, status, created_at, completed_at, summary')
      .eq('tenant_id', profile.tenant_id)
      .gte('reference_date', startDate)
      .lte('reference_date', endDate)
      .order('created_at', { ascending: false });

    if (Array.isArray(batchRows) && batchRows.length > 0) {
      const b = batchRows[0] as Record<string, unknown>;
      persistedBatch = {
        id: String(b.id),
        tenant_id: String(b.tenant_id),
        reference_date: String(b.reference_date),
        period_start: String(b.period_start),
        period_end: String(b.period_end),
        total_payments_analyzed: Number(b.total_payments_analyzed || 0),
        total_credits_analyzed: Number(b.total_credits_analyzed || 0),
        matched_count: Number(b.matched_count || 0),
        matched_amount: Number(b.matched_amount || 0),
        divergences_count: Number(b.divergences_count || 0),
        divergences_amount: Number(b.divergences_amount || 0),
        status: String(b.status || 'completed') as ReconciliationBatch['status'],
        created_at: String(b.created_at),
        completed_at: b.completed_at ? String(b.completed_at) : null,
        summary: (b.summary as ReconciliationBatch['summary']) || {
          reconciliation_rate_percent: auditResult.reconciliationRatePercent,
          total_audited_volume: Number((auditResult.matchedAmount + auditResult.divergencesAmount).toFixed(2)),
        },
      };
    }
  } catch {
    // Tabela opcional caso migration 80 ainda não esteja aplicada no ambiente conectado
  }

  const latestBatch: ReconciliationBatch = persistedBatch || {
    id: 'preview-unpersisted-audit',
    tenant_id: profile.tenant_id,
    reference_date: endDate,
    period_start: `${startDate}T00:00:00Z`,
    period_end: `${endDate}T23:59:59Z`,
    total_payments_analyzed: rawPayments.length,
    total_credits_analyzed: periodLedger.length,
    matched_count: auditResult.matchedCount,
    matched_amount: auditResult.matchedAmount,
    divergences_count: auditResult.divergencesCount,
    divergences_amount: auditResult.divergencesAmount,
    status: auditResult.divergencesCount > 0 ? 'completed_with_divergences' : 'completed',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    summary: {
      reconciliation_rate_percent: auditResult.reconciliationRatePercent,
      total_audited_volume: Number((auditResult.matchedAmount + auditResult.divergencesAmount).toFixed(2)),
    },
  };

  return {
    kpis,
    latestBatch,
    divergences: finalDivergences,
    dailyClosings,
    period: { startDate, endDate },
    units: (unitsRes.data || []) as Array<{ id: string; name: string }>,
    userRole: profile.role,
    userCanManage: true,
  };
}

/**
 * Dispara uma auditoria formal de conciliação financeira no banco.
 */
export async function runReconciliationAuditActionServer(
  startDate: string,
  endDate: string
): Promise<{ success: boolean; batchId?: string; summary?: unknown; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'AUTH_REQUIRED: Usuário não autenticado.' };
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { id: string; tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    return { success: false, error: 'ACTIVE_PROFILE_REQUIRED: Perfil inativo ou não autorizado.' };
  }

  if (!['admin_general', 'operations_director', 'finance'].includes(profile.role)) {
    return { success: false, error: 'PERMISSION_DENIED: Apenas administração geral e financeira podem executar conciliação.' };
  }

  try {
    const { data: rpcData, error: rpcError } = await (supabase.rpc as unknown as RpcCaller)(
      'run_financial_reconciliation_audit',
      {
        p_tenant_id: profile.tenant_id,
        p_start_date: startDate,
        p_end_date: endDate,
      }
    );

    if (rpcError) {
      return { success: false, error: `FALHA_RPC_CONCILIACAO: ${rpcError.message}` };
    }

    return { success: true, summary: rpcData };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Registra a resolução auditável de uma divergência financeira.
 */
export async function resolveDivergenceActionServer(
  input: ResolveDivergenceInput
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'AUTH_REQUIRED: Não autenticado.' };
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { id: string; tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    return { success: false, error: 'ACTIVE_PROFILE_REQUIRED: Perfil inativo ou não autorizado.' };
  }

  if (!['admin_general', 'operations_director', 'finance'].includes(profile.role)) {
    return { success: false, error: 'PERMISSION_DENIED: Permissão insuficiente para registrar resolução.' };
  }

  if (!UUID_REGEX.test(input.divergenceId)) {
    return {
      success: false,
      error: 'Divergência ainda não persistida em lote oficial. Clique em "Executar Auditoria" antes de registrar a resolução.',
    };
  }

  if (!input.resolutionNotes || input.resolutionNotes.trim().length < 5) {
    return { success: false, error: 'A justificativa de resolução é obrigatória (mínimo de 5 caracteres).' };
  }

  const { error } = await (supabase.from as unknown as DynamicTableCaller)('financial_reconciliation_divergences')
    .update({
      status: input.resolutionStatus,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_notes: input.resolutionNotes.trim(),
    })
    .eq('id', input.divergenceId)
    .eq('tenant_id', profile.tenant_id);

  if (error) {
    return { success: false, error: `Erro ao atualizar divergência: ${error.message}` };
  }

  return { success: true };
}

/**
 * Consolida e persiste o fechamento financeiro diário sem gerar mutações retroativas no ledger.
 */
export async function closeFinancialDailyPeriodServer(
  input: CloseDailyPeriodInput
): Promise<{ success: boolean; closing?: unknown; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'AUTH_REQUIRED: Usuário não autenticado.' };
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { id: string; tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    return { success: false, error: 'ACTIVE_PROFILE_REQUIRED: Perfil inativo ou não autorizado.' };
  }

  if (!['admin_general', 'operations_director', 'finance'].includes(profile.role)) {
    return {
      success: false,
      error: 'PERMISSION_DENIED: Apenas administração geral, diretoria ou financeiro podem fechar o período.',
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.closingDate || '')) {
    return { success: false, error: 'INVALID_CLOSING_DATE: Data de fechamento inválida.' };
  }

  if (input.unitId && !UUID_REGEX.test(input.unitId)) {
    return { success: false, error: 'INVALID_UNIT_ID: Identificador de unidade inválido.' };
  }

  const cleanNotes = (input.notes || '').trim();
  if (cleanNotes.length < 5) {
    return {
      success: false,
      error: 'JUSTIFICATION_REQUIRED: A justificativa/observação do fechamento deve ter no mínimo 5 caracteres.',
    };
  }

  try {
    const { data: rpcData, error: rpcError } = await (supabase.rpc as unknown as RpcCaller)(
      'close_financial_daily_period',
      {
        p_tenant_id: profile.tenant_id,
        p_closing_date: input.closingDate,
        p_unit_id: input.unitId || null,
        p_notes: cleanNotes,
      }
    );

    if (rpcError) {
      return { success: false, error: `FALHA_FECHAMENTO_DIARIO: ${rpcError.message}` };
    }

    return { success: true, closing: rpcData };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export { generateReconciliationExcelWorkbook } from '@/lib/reports/reconciliation-excel';
