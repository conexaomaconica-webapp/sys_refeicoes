export type IntelligencePeriodId = 'october' | 'september' | 'last30';
export type IntelligenceUnitId = 'all' | 'central' | 'north' | 'south';
export type IntelligenceCategoryId = 'all' | 'integral' | 'partial' | 'visitor';
export type IntelligenceSourceKind = 'synthetic' | 'remote-readonly';

export interface IntelligenceFilters {
  period: IntelligencePeriodId;
  unit: IntelligenceUnitId;
  category: IntelligenceCategoryId;
}

export interface IntelligenceAccessContext {
  mode: 'synthetic-demo' | 'authenticated';
  tenantId: string | null;
  institutionIds: readonly string[];
  unitIds: readonly string[];
  role: string | null;
  profileStatus: 'active' | 'inactive' | 'suspended' | null;
}

export interface IntelligenceRequest {
  filters: IntelligenceFilters;
  access: IntelligenceAccessContext;
}

export interface IntelligencePoint {
  label: string;
  value: number;
}

export interface IntelligenceUnitMetric {
  id: Exclude<IntelligenceUnitId, 'all'>;
  name: string;
  meals: number;
  target: number;
  variation: number;
  divergence: number;
}

export interface IntelligenceCategoryMetric {
  id: Exclude<IntelligenceCategoryId, 'all'>;
  label: string;
  percentage: number;
  meals: number;
  color: string;
}

export interface IntelligenceActionItem {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  owner: string;
  due: string;
}

export interface IntelligenceSnapshot {
  source: {
    providerId: string;
    kind: IntelligenceSourceKind;
    synthetic: boolean;
    generatedAt: string;
    disclaimer: string;
  };
  filters: IntelligenceFilters;
  summary: {
    mealsServed: number;
    previousMealsServed: number;
    periodVariation: number;
    faceValue: number;
    confirmedRecharges: number;
    custodyBalance: number;
    cashDivergence: number;
  };
  service: {
    averageServiceSeconds: number;
    peakVolume: number;
    offlineEvents: number;
    hourlyFlow: IntelligencePoint[];
    blockedReasons: IntelligencePoint[];
  };
  trend: {
    points: IntelligencePoint[];
    target: number;
  };
  units: IntelligenceUnitMetric[];
  audience: {
    categories: IntelligenceCategoryMetric[];
    frequencies: IntelligencePoint[];
  };
  financialComposition: IntelligencePoint[];
  actions: IntelligenceActionItem[];
}

export type IntelligenceProviderResult =
  | { status: 'ready'; snapshot: IntelligenceSnapshot }
  | { status: 'empty'; reason: string }
  | { status: 'unavailable'; reason: string; retryable: boolean };

export interface IntelligenceDataProvider {
  readonly id: string;
  readonly sourceKind: IntelligenceSourceKind;
  getSnapshot(request: IntelligenceRequest): Promise<IntelligenceProviderResult>;
}

export const SYNTHETIC_DEMO_ACCESS: IntelligenceAccessContext = {
  mode: 'synthetic-demo',
  tenantId: null,
  institutionIds: [],
  unitIds: [],
  role: null,
  profileStatus: null,
};
