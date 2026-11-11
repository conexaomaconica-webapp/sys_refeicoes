'use server';

import {
  closeFinancialDailyPeriodServer,
  getReconciliationDashboard,
  resolveDivergenceActionServer,
  runReconciliationAuditActionServer,
} from '@/server/reconciliation/reconciliation.server';
import type {
  CloseDailyPeriodInput,
  ReconciliationDashboardData,
  ReconciliationFilters,
  ResolveDivergenceInput,
} from '@/types/reconciliation';

export async function getReconciliationDashboardAction(
  filters: ReconciliationFilters
): Promise<ReconciliationDashboardData> {
  return await getReconciliationDashboard(filters);
}

export async function runReconciliationAuditAction(
  startDate: string,
  endDate: string
) {
  return await runReconciliationAuditActionServer(startDate, endDate);
}

export async function resolveDivergenceAction(
  input: ResolveDivergenceInput
) {
  return await resolveDivergenceActionServer(input);
}

export async function closeDailyFinancialPeriodAction(
  input: CloseDailyPeriodInput
) {
  return await closeFinancialDailyPeriodServer(input);
}

