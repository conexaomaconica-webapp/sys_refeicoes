'use server';

import { getConsolidatedFinancialReport } from '@/server/reports/financial-reporting.server';
import type {
  ConsolidatedFinancialReport,
  FinancialReportFilters,
} from '@/types/financial-reporting';

export async function getConsolidatedFinancialReportAction(
  filters: FinancialReportFilters
): Promise<ConsolidatedFinancialReport> {
  return await getConsolidatedFinancialReport(filters);
}

