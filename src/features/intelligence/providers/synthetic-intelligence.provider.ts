import type {
  IntelligenceCategoryMetric,
  IntelligenceDataProvider,
  IntelligenceFilters,
  IntelligencePoint,
  IntelligenceProviderResult,
  IntelligenceRequest,
  IntelligenceSnapshot,
  IntelligenceUnitMetric,
} from '../contracts';

const baseTrend: IntelligencePoint[] = [
  ['Nov', 48800], ['Dez', 45100], ['Jan', 47600], ['Fev', 51200],
  ['Mar', 54800], ['Abr', 56300], ['Mai', 57900], ['Jun', 55200],
  ['Jul', 58400], ['Ago', 59600], ['Set', 58720], ['Out', 62480],
].map(([label, value]) => ({ label: String(label), value: Number(value) }));

const baseUnits: IntelligenceUnitMetric[] = [
  { id: 'central', name: 'Restaurante Central', meals: 28420, target: 27000, variation: 8.4, divergence: 0.18 },
  { id: 'north', name: 'Unidade Norte', meals: 19680, target: 20500, variation: -2.8, divergence: 0.71 },
  { id: 'south', name: 'Unidade Sul', meals: 14380, target: 13800, variation: 4.1, divergence: 0.32 },
];

const baseCategories: IntelligenceCategoryMetric[] = [
  { id: 'integral', label: 'Bolsista integral', percentage: 58, meals: 36238, color: '#15803d' },
  { id: 'partial', label: 'Comensal parcial', percentage: 34, meals: 21243, color: '#f59e0b' },
  { id: 'visitor', label: 'Visitante e servidor', percentage: 8, meals: 4999, color: '#475569' },
];

const periodFactor = { october: 1, september: 0.94, last30: 1.025 } as const;
const unitFactor = { all: 1, central: 0.455, north: 0.315, south: 0.23 } as const;
const categoryFactor = { all: 1, integral: 0.58, partial: 0.34, visitor: 0.08 } as const;

export function intelligenceFactor(filters: IntelligenceFilters) {
  return periodFactor[filters.period] * unitFactor[filters.unit] * categoryFactor[filters.category];
}

function scaledPoints(points: IntelligencePoint[], factor: number) {
  return points.map((point) => ({ ...point, value: Math.round(point.value * factor) }));
}

export class SyntheticIntelligenceProvider implements IntelligenceDataProvider {
  readonly id = 'synthetic-stage6';
  readonly sourceKind = 'synthetic' as const;

  constructor(private readonly scenario: 'ready' | 'empty' | 'unavailable' = 'ready') {}

  async getSnapshot(request: IntelligenceRequest): Promise<IntelligenceProviderResult> {
    if (request.access.mode !== 'synthetic-demo') {
      return { status: 'unavailable', reason: 'O fornecedor sintético aceita somente o contexto de demonstração.', retryable: false };
    }
    if (this.scenario === 'empty') return { status: 'empty', reason: 'Cenário sintético sem dados.' };
    if (this.scenario === 'unavailable') return { status: 'unavailable', reason: 'Falha sintética controlada.', retryable: true };

    const { filters } = request;
    const factor = intelligenceFactor(filters);
    const factorWithoutUnit = periodFactor[filters.period] * categoryFactor[filters.category];
    const factorWithoutCategory = periodFactor[filters.period] * unitFactor[filters.unit];
    const units = baseUnits
      .filter((unit) => filters.unit === 'all' || unit.id === filters.unit)
      .map((unit) => ({ ...unit, meals: Math.round(unit.meals * factorWithoutUnit), target: Math.round(unit.target * factorWithoutUnit) }))
      .sort((a, b) => b.meals - a.meals);
    const categories = baseCategories
      .filter((category) => filters.category === 'all' || category.id === filters.category)
      .map((category) => ({
        ...category,
        percentage: filters.category === 'all' ? category.percentage : 100,
        meals: Math.round(category.meals * factorWithoutCategory),
      }));

    const snapshot: IntelligenceSnapshot = {
      source: {
        providerId: this.id,
        kind: this.sourceKind,
        synthetic: true,
        generatedAt: '2026-10-24T14:35:00-03:00',
        disclaimer: 'Valores, metas, alertas e tendências são exclusivamente ilustrativos.',
      },
      filters,
      summary: {
        mealsServed: Math.round(62480 * factor),
        previousMealsServed: Math.round(58720 * factor),
        periodVariation: 6.4,
        faceValue: 796000 * factor,
        confirmedRecharges: 238400 * factor,
        custodyBalance: 184300 * factor,
        cashDivergence: 420 * Math.max(factor, 0.35),
      },
      service: {
        averageServiceSeconds: 18,
        peakVolume: Math.round(12860 * factor),
        offlineEvents: Math.round(14 * Math.max(factor, 0.25)),
        hourlyFlow: scaledPoints([
          ['10h–11h', 2840], ['11h–12h', 8940], ['12h–13h', 12860], ['13h–14h', 7380],
          ['17h–18h', 4460], ['18h–19h', 9860], ['19h–20h', 6120],
        ].map(([label, value]) => ({ label: String(label), value: Number(value) })), factor),
        blockedReasons: scaledPoints([
          ['Saldo insuficiente', 184], ['Refeição já utilizada', 92], ['Cadastro inativo', 31], ['Fora do horário', 18],
        ].map(([label, value]) => ({ label: String(label), value: Number(value) })), factor),
      },
      trend: { points: scaledPoints(baseTrend, factor), target: 60000 * factor },
      units,
      audience: {
        categories,
        frequencies: scaledPoints([
          ['5 ou mais vezes/semana', 4380], ['3 a 4 vezes/semana', 3120], ['1 a 2 vezes/semana', 1960], ['Uso eventual', 740],
        ].map(([label, value]) => ({ label: String(label), value: Number(value) })), factorWithoutCategory),
      },
      financialComposition: scaledPoints([
        ['Subsídio integral', 462000], ['Subsídio parcial', 190000], ['Parcela do comensal', 144000],
      ].map(([label, value]) => ({ label: String(label), value: Number(value) })), factor),
      actions: [
        { severity: 'critical', title: 'Revisar fechamento da Unidade Norte', detail: '2 caixas com divergência acima da meta fictícia de 0,5%.', owner: 'Financeiro', due: 'Hoje' },
        { severity: 'warning', title: 'Investigar pico de bloqueios no jantar', detail: 'Saldo insuficiente cresceu 18% na comparação demonstrativa.', owner: 'Operações', due: 'Amanhã' },
        { severity: 'info', title: 'Confirmar 14 eventos offline', detail: 'Eventos conhecidos aguardam revisão operacional demonstrativa.', owner: 'Supervisão', due: '2 dias' },
      ],
    };
    return { status: 'ready', snapshot };
  }
}

export const syntheticIntelligenceProvider = new SyntheticIntelligenceProvider();
