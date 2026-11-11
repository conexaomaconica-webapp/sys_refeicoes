import type { IntelligenceAccessContext } from '../contracts';
import {
  OPERATIONAL_INTELLIGENCE_RPC,
  OPERATIONAL_INTELLIGENCE_SCHEMA_VERSION,
  type OperationalCategoryUtilization,
  type OperationalIntelligenceProvider,
  type OperationalIntelligenceProviderResult,
  type OperationalIntelligenceQuery,
  type OperationalIntelligenceRpcArgs,
  type OperationalIntelligenceRpcExecutor,
  type OperationalIntelligenceSnapshot,
  type OperationalUnitVolume,
} from '../operational-contracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OPERATIONAL_ROLES = new Set([
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
  'institution_user',
]);

function assertDate(value: string, field: string) {
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} deve usar uma data ISO válida (AAAA-MM-DD).`);
  }
}

function periodDays(startDate: string, endDateExclusive: string) {
  return (Date.parse(`${endDateExclusive}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
}

function normalizeIds(values: readonly string[] | undefined, field: string) {
  if (values === undefined) return null;
  if (values.length === 0) throw new Error(`${field} não aceita lista vazia; omita o filtro para selecionar todo o escopo autorizado.`);
  const unique = [...new Set(values)];
  if (unique.length > 100 || unique.some((value) => !UUID_PATTERN.test(value))) {
    throw new Error(`${field} deve conter de 1 a 100 UUIDs válidos.`);
  }
  return unique;
}

export function buildOperationalIntelligenceRpcArgs(query: OperationalIntelligenceQuery): OperationalIntelligenceRpcArgs {
  const periods = [
    ['currentPeriod.startDate', query.currentPeriod.startDate],
    ['currentPeriod.endDateExclusive', query.currentPeriod.endDateExclusive],
    ['previousPeriod.startDate', query.previousPeriod.startDate],
    ['previousPeriod.endDateExclusive', query.previousPeriod.endDateExclusive],
  ] as const;
  for (const [field, value] of periods) assertDate(value, field);

  const currentDays = periodDays(query.currentPeriod.startDate, query.currentPeriod.endDateExclusive);
  const previousDays = periodDays(query.previousPeriod.startDate, query.previousPeriod.endDateExclusive);
  if (currentDays < 1 || currentDays > 366 || previousDays !== currentDays) {
    throw new Error('Os períodos devem ter a mesma duração, entre 1 e 366 dias, com fim exclusivo.');
  }

  return {
    p_period_start: query.currentPeriod.startDate,
    p_period_end: query.currentPeriod.endDateExclusive,
    p_previous_start: query.previousPeriod.startDate,
    p_previous_end: query.previousPeriod.endDateExclusive,
    p_institution_ids: normalizeIds(query.institutionIds, 'institutionIds'),
    p_unit_ids: normalizeIds(query.unitIds, 'unitIds'),
    p_category_ids: normalizeIds(query.categoryIds, 'categoryIds'),
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Resposta inválida em ${field}.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Resposta inválida em ${field}.`);
  return value;
}

function count(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`Resposta inválida em ${field}.`);
  return value;
}

function decimal(value: unknown, field: string, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Resposta inválida em ${field}.`);
  return value;
}

function stringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`Resposta inválida em ${field}.`);
  return [...value] as string[];
}

function array(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new Error(`Resposta inválida em ${field}.`);
  return value;
}

export function parseOperationalIntelligenceRpcPayload(payload: unknown): OperationalIntelligenceSnapshot {
  const root = record(payload, 'payload');
  if (root.schema_version !== OPERATIONAL_INTELLIGENCE_SCHEMA_VERSION) throw new Error('Versão incompatível do contrato operacional.');
  const periods = record(root.periods, 'periods');
  const current = record(periods.current, 'periods.current');
  const previous = record(periods.previous, 'periods.previous');
  const scope = record(root.applied_scope, 'applied_scope');
  const comparison = record(root.period_comparison, 'period_comparison');

  const volumeByUnit: OperationalUnitVolume[] = array(root.volume_by_unit, 'volume_by_unit').map((item, index) => {
    const unit = record(item, `volume_by_unit[${index}]`);
    return {
      unitId: text(unit.unit_id, `volume_by_unit[${index}].unit_id`),
      institutionId: text(unit.institution_id, `volume_by_unit[${index}].institution_id`),
      unitName: text(unit.unit_name, `volume_by_unit[${index}].unit_name`),
      mealsServed: count(unit.meals_served, `volume_by_unit[${index}].meals_served`),
      previousMealsServed: count(unit.previous_meals_served, `volume_by_unit[${index}].previous_meals_served`),
      variationPercent: decimal(unit.variation_percent, `volume_by_unit[${index}].variation_percent`, true),
    };
  });

  const utilizationByCategory: OperationalCategoryUtilization[] = array(root.utilization_by_category, 'utilization_by_category').map((item, index) => {
    const category = record(item, `utilization_by_category[${index}]`);
    return {
      categoryId: text(category.category_id, `utilization_by_category[${index}].category_id`),
      categoryCode: text(category.category_code, `utilization_by_category[${index}].category_code`),
      categoryName: text(category.category_name, `utilization_by_category[${index}].category_name`),
      mealsServed: count(category.meals_served, `utilization_by_category[${index}].meals_served`),
      percentage: decimal(category.percentage, `utilization_by_category[${index}].percentage`) as number,
    };
  });

  const snapshot: OperationalIntelligenceSnapshot = {
    schemaVersion: OPERATIONAL_INTELLIGENCE_SCHEMA_VERSION,
    generatedAt: text(root.generated_at, 'generated_at'),
    periods: {
      current: { startDate: text(current.start_date, 'periods.current.start_date'), endDateExclusive: text(current.end_date_exclusive, 'periods.current.end_date_exclusive') },
      previous: { startDate: text(previous.start_date, 'periods.previous.start_date'), endDateExclusive: text(previous.end_date_exclusive, 'periods.previous.end_date_exclusive') },
    },
    appliedScope: {
      institutionIds: stringArray(scope.institution_ids, 'applied_scope.institution_ids'),
      unitIds: stringArray(scope.unit_ids, 'applied_scope.unit_ids'),
      categoryIds: stringArray(scope.category_ids, 'applied_scope.category_ids'),
    },
    mealsServed: count(root.meals_served, 'meals_served'),
    volumeByUnit,
    utilizationByCategory,
    periodComparison: {
      currentMealsServed: count(comparison.current_meals_served, 'period_comparison.current_meals_served'),
      previousMealsServed: count(comparison.previous_meals_served, 'period_comparison.previous_meals_served'),
      variationPercent: decimal(comparison.variation_percent, 'period_comparison.variation_percent', true),
    },
  };

  const unitTotal = snapshot.volumeByUnit.reduce((total, unit) => total + unit.mealsServed, 0);
  const categoryTotal = snapshot.utilizationByCategory.reduce((total, category) => total + category.mealsServed, 0);
  if (unitTotal !== snapshot.mealsServed || categoryTotal !== snapshot.mealsServed || snapshot.periodComparison.currentMealsServed !== snapshot.mealsServed) {
    throw new Error('Resposta operacional inconsistente entre totais e agrupamentos.');
  }
  return snapshot;
}

export class RpcOperationalIntelligenceProvider implements OperationalIntelligenceProvider {
  constructor(private readonly executor: OperationalIntelligenceRpcExecutor) {}

  async getOperationalSnapshot(
    query: OperationalIntelligenceQuery,
    access: IntelligenceAccessContext
  ): Promise<OperationalIntelligenceProviderResult> {
    if (
      access.mode !== 'authenticated'
      || !access.tenantId
      || access.profileStatus !== 'active'
      || !access.role
      || !OPERATIONAL_ROLES.has(access.role)
    ) {
      return { status: 'unavailable', reason: 'Contexto autenticado e perfil ativo são obrigatórios.', retryable: false };
    }
    try {
      const args = buildOperationalIntelligenceRpcArgs(query);
      const { data, error } = await this.executor.invoke(OPERATIONAL_INTELLIGENCE_RPC, args);
      if (error) return { status: 'unavailable', reason: 'A consulta operacional foi recusada ou está indisponível.', retryable: false };
      const snapshot = parseOperationalIntelligenceRpcPayload(data);
      return snapshot.mealsServed === 0
        ? { status: 'empty', snapshot, reason: 'Nenhuma refeição servida no escopo e período selecionados.' }
        : { status: 'ready', snapshot };
    } catch {
      return { status: 'unavailable', reason: 'Contrato operacional inválido ou resposta inconsistente.', retryable: false };
    }
  }
}
