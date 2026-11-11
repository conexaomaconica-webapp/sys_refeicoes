import type { IntelligenceAccessContext } from './contracts';

export const OPERATIONAL_INTELLIGENCE_RPC = 'get_operational_intelligence_v1' as const;
export const OPERATIONAL_INTELLIGENCE_SCHEMA_VERSION = 'stage7d-operational-v1' as const;

export interface OperationalIntelligencePeriod {
  startDate: string;
  endDateExclusive: string;
}

export interface OperationalIntelligenceQuery {
  currentPeriod: OperationalIntelligencePeriod;
  previousPeriod: OperationalIntelligencePeriod;
  institutionIds?: readonly string[];
  unitIds?: readonly string[];
  categoryIds?: readonly string[];
}

export interface OperationalIntelligenceRpcArgs {
  p_period_start: string;
  p_period_end: string;
  p_previous_start: string;
  p_previous_end: string;
  p_institution_ids: string[] | null;
  p_unit_ids: string[] | null;
  p_category_ids: string[] | null;
}

export interface OperationalPeriodComparison {
  currentMealsServed: number;
  previousMealsServed: number;
  variationPercent: number | null;
}

export interface OperationalUnitVolume {
  unitId: string;
  institutionId: string;
  unitName: string;
  mealsServed: number;
  previousMealsServed: number;
  variationPercent: number | null;
}

export interface OperationalCategoryUtilization {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  mealsServed: number;
  percentage: number;
}

export interface OperationalIntelligenceSnapshot {
  schemaVersion: typeof OPERATIONAL_INTELLIGENCE_SCHEMA_VERSION;
  generatedAt: string;
  periods: {
    current: OperationalIntelligencePeriod;
    previous: OperationalIntelligencePeriod;
  };
  appliedScope: {
    institutionIds: string[];
    unitIds: string[];
    categoryIds: string[];
  };
  mealsServed: number;
  volumeByUnit: OperationalUnitVolume[];
  utilizationByCategory: OperationalCategoryUtilization[];
  periodComparison: OperationalPeriodComparison;
}

export type OperationalIntelligenceProviderResult =
  | { status: 'ready'; snapshot: OperationalIntelligenceSnapshot }
  | { status: 'empty'; snapshot: OperationalIntelligenceSnapshot; reason: string }
  | { status: 'unavailable'; reason: string; retryable: boolean };

export interface OperationalIntelligenceRpcError {
  message: string;
  code?: string;
}

export interface OperationalIntelligenceRpcExecutor {
  invoke(
    functionName: typeof OPERATIONAL_INTELLIGENCE_RPC,
    args: OperationalIntelligenceRpcArgs
  ): Promise<{ data: unknown; error: OperationalIntelligenceRpcError | null }>;
}

export interface OperationalIntelligenceProvider {
  getOperationalSnapshot(
    query: OperationalIntelligenceQuery,
    access: IntelligenceAccessContext
  ): Promise<OperationalIntelligenceProviderResult>;
}

