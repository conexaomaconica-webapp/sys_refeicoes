import type { IntelligenceFilters } from '@/features/intelligence/contracts';

export type DemoViewId =
  | 'month'
  | 'service'
  | 'result'
  | 'units'
  | 'audience'
  | 'waste'
  | 'forecast'
  | 'actions';

export type DemoScreenState = 'ready' | 'loading' | 'empty' | 'unavailable';

export type DemoFilters = IntelligenceFilters;

export const demoViews: Array<{ id: DemoViewId; shortLabel: string; question: string }> = [
  { id: 'month', shortLabel: 'Mês', question: 'Como está o mês?' },
  { id: 'service', shortLabel: 'Atendimento', question: 'Estamos atendendo bem?' },
  { id: 'result', shortLabel: 'Resultado', question: 'Onde está o resultado?' },
  { id: 'units', shortLabel: 'Unidades', question: 'Qual unidade precisa de atenção?' },
  { id: 'audience', shortLabel: 'Público', question: 'Quem está utilizando o serviço?' },
  { id: 'waste', shortLabel: 'Desperdício', question: 'Onde estamos desperdiçando?' },
  { id: 'forecast', shortLabel: 'Previsão', question: 'Como vamos fechar o mês?' },
  { id: 'actions', shortLabel: 'Ações', question: 'O que exige ação agora?' },
];

export const demoCategoryOptions = [
  { id: 'integral', label: 'Bolsista integral' },
  { id: 'partial', label: 'Comensal parcial' },
  { id: 'visitor', label: 'Visitante e servidor' },
] as const;

export function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatCurrency(value: number, compact = false) {
  const sign = value < 0 ? '-' : '';
  const absoluteValue = Math.abs(value);

  if (compact && absoluteValue >= 1000) {
    const divisor = absoluteValue >= 1_000_000 ? 1_000_000 : 1_000;
    const suffix = divisor === 1_000_000 ? 'mi' : 'mil';
    const roundedValue = Math.round((absoluteValue / divisor) * 10) / 10;
    const formattedValue = Number.isInteger(roundedValue)
      ? roundedValue.toFixed(0)
      : roundedValue.toFixed(1).replace('.', ',');

    return `${sign}R$ ${formattedValue} ${suffix}`;
  }

  const roundedValue = Math.round(absoluteValue);
  const formattedValue = roundedValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${sign}R$ ${formattedValue}`;
}
