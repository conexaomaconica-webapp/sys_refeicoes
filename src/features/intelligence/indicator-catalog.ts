export type IntelligenceIndicatorId =
  | 'meals_served'
  | 'volume_by_unit'
  | 'audience_by_category'
  | 'period_comparison'
  | 'face_value'
  | 'confirmed_recharges'
  | 'custody_balance'
  | 'cash_divergence';

export interface IntelligenceIndicatorContract {
  id: IntelligenceIndicatorId;
  label: string;
  classification: 'operational' | 'financial';
  aggregation: 'count' | 'sum' | 'ratio' | 'grouped-count';
  requiredScopes: Array<'tenant' | 'institution' | 'unit'>;
  candidateSources: readonly string[];
  integrationStatus: 'candidate' | 'prepared-local' | 'blocked';
  blockedBy: readonly string[];
}

const OPERATIONAL_REMOTE_BLOCKERS = [
  'schema e policies de staging ainda não reconciliados',
  'RPC somente leitura ainda não homologada em staging',
  'índices, concorrência e SLA ainda não homologados',
] as const;

export const intelligenceIndicatorCatalog: readonly IntelligenceIndicatorContract[] = [
  {
    id: 'meals_served',
    label: 'Refeições servidas',
    classification: 'operational',
    aggregation: 'count',
    requiredScopes: ['tenant', 'institution', 'unit'],
    candidateSources: ['meal_consumptions'],
    integrationStatus: 'prepared-local',
    blockedBy: OPERATIONAL_REMOTE_BLOCKERS,
  },
  {
    id: 'volume_by_unit',
    label: 'Volume por restaurante',
    classification: 'operational',
    aggregation: 'grouped-count',
    requiredScopes: ['tenant', 'institution', 'unit'],
    candidateSources: ['meal_consumptions', 'units'],
    integrationStatus: 'prepared-local',
    blockedBy: OPERATIONAL_REMOTE_BLOCKERS,
  },
  {
    id: 'audience_by_category',
    label: 'Utilização por categoria',
    classification: 'operational',
    aggregation: 'grouped-count',
    requiredScopes: ['tenant', 'institution', 'unit'],
    candidateSources: ['meal_consumptions', 'student_categories'],
    integrationStatus: 'prepared-local',
    blockedBy: OPERATIONAL_REMOTE_BLOCKERS,
  },
  {
    id: 'period_comparison',
    label: 'Comparativo por período',
    classification: 'operational',
    aggregation: 'ratio',
    requiredScopes: ['tenant', 'institution', 'unit'],
    candidateSources: ['meal_consumptions'],
    integrationStatus: 'prepared-local',
    blockedBy: OPERATIONAL_REMOTE_BLOCKERS,
  },
  ...(['face_value', 'confirmed_recharges', 'custody_balance', 'cash_divergence'] as const).map((id) => ({
    id,
    label: {
      face_value: 'Valor facial',
      confirmed_recharges: 'Recargas confirmadas',
      custody_balance: 'Saldo em custódia',
      cash_divergence: 'Divergências de caixa',
    }[id],
    classification: 'financial' as const,
    aggregation: id === 'cash_divergence' ? 'sum' as const : 'sum' as const,
    requiredScopes: ['tenant', 'institution', 'unit'] as Array<'tenant' | 'institution' | 'unit'>,
    candidateSources: {
      face_value: ['meal_consumptions'],
      confirmed_recharges: ['recharges', 'payments'],
      custody_balance: ['wallets'],
      cash_divergence: ['cash_shifts'],
    }[id],
    integrationStatus: 'blocked' as const,
    blockedBy: [...OPERATIONAL_REMOTE_BLOCKERS, 'escopo financeiro canônico por unidade e fórmulas contábeis ainda não aprovados'],
  })),
];

export const remoteIntegrationGates = [
  'Homologar os 31 cenários contra o schema reconciliado de staging',
  'Reconciliar o schema e as policies de staging',
  'Definir vínculo canônico entre instituição, unidade, comensal e financeiro',
  'Aprovar nomes e fórmulas contábeis',
  'Disponibilizar contratos API/RPC exclusivamente de leitura',
  'Homologar índices, concorrência e SLA',
  'Garantir tenant, perfil ativo e escopo de unidade em toda consulta',
] as const;
