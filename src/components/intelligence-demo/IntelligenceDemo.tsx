'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudOff,
  Filter,
  Gauge,
  Info,
  Landmark,
  Loader2,
  MapPin,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  Target,
  TriangleAlert,
  Utensils,
  WalletCards,
} from 'lucide-react';
import { AudienceDonut, HorizontalBars, TrendChart } from './DemoCharts';
import type { IntelligenceSnapshot } from '@/features/intelligence/contracts';
import { useIntelligenceSnapshot } from '@/features/intelligence/use-intelligence-snapshot';
import {
  demoCategoryOptions,
  demoViews,
  formatCurrency,
  formatNumber,
  type DemoFilters,
  type DemoScreenState,
  type DemoViewId,
} from './data';

const surface = 'rounded-[28px] border border-slate-200/80 bg-white shadow-[0_18px_50px_-34px_rgba(15,23,42,0.4)]';

function MetricCard({
  label,
  value,
  helper,
  trend,
  tone = 'neutral',
  trendTone,
  icon: Icon,
}: {
  label: string;
  value: string;
  helper: string;
  trend?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'critical';
  trendTone?: 'positive' | 'negative';
  icon: typeof Utensils;
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700',
    positive: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    critical: 'bg-red-50 text-red-700',
  };
  return (
    <article className={`${surface} group p-5 transition duration-300 hover:-translate-y-1 hover:shadow-xl`}>
      <div className="flex items-start justify-between gap-4">
        <div className={`grid h-11 w-11 place-items-center rounded-2xl ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
        {trend && <span className={`rounded-full px-2.5 py-1 text-xs font-black ${(trendTone ?? (trend.startsWith('+') ? 'positive' : 'negative')) === 'positive' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{trend}</span>}
      </div>
      <p className="mt-5 text-xs font-black uppercase tracking-[0.13em] text-slate-500">{label}</p>
      <strong className="mt-2 block text-3xl font-black tracking-tight text-slate-950">{value}</strong>
      <p className="mt-2 text-xs leading-5 text-slate-500">{helper}</p>
    </article>
  );
}

function Insight({ tone, title, children }: { tone: 'positive' | 'warning' | 'critical' | 'info'; title: string; children: React.ReactNode }) {
  const styles = {
    positive: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
    warning: 'border-amber-200 bg-amber-50/70 text-amber-950',
    critical: 'border-red-200 bg-red-50/70 text-red-950',
    info: 'border-blue-200 bg-blue-50/70 text-blue-950',
  };
  const Icon = tone === 'positive' ? CheckCircle2 : tone === 'critical' ? ShieldAlert : tone === 'warning' ? TriangleAlert : Info;
  return (
    <div className={`rounded-2xl border p-4 ${styles[tone]}`}>
      <div className="flex gap-3"><Icon className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">{title}</p><div className="mt-1 text-sm leading-6 opacity-80">{children}</div></div></div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-red-600">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-black tracking-[-0.035em] text-slate-950 md:text-5xl">{title}</h2>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-500 md:text-base">{description}</p>
    </div>
  );
}

function MonthView({ snapshot, onOpenCriticalUnit }: { snapshot: IntelligenceSnapshot; onOpenCriticalUnit: () => void }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Visão executiva" title="Como está o mês?" description="A resposta essencial vem primeiro: volume, valor facial, custódia e o ponto que merece atenção agora." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Utensils} label="Refeições servidas" value={formatNumber(snapshot.summary.mealsServed)} trend={`+${snapshot.summary.periodVariation.toFixed(1).replace('.', ',')}%`} helper="Comparação fictícia com o período anterior." tone="positive" />
        <MetricCard icon={BadgeDollarSign} label="Valor facial" value={formatCurrency(snapshot.summary.faceValue, true)} trend="+8,2%" helper="Não representa receita líquida." />
        <MetricCard icon={WalletCards} label="Saldo em custódia" value={formatCurrency(snapshot.summary.custodyBalance, true)} helper="Saldo demonstrativo mantido nas carteiras." />
        <MetricCard icon={Scale} label="Divergências de caixa" value={formatCurrency(snapshot.summary.cashDivergence)} trend="-14%" trendTone="positive" helper="3 fechamentos pedem revisão." tone="warning" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.65fr_0.75fr]">
        <section className={`${surface} p-5 md:p-7`}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="font-black text-slate-950">Evolução de 12 meses</p><p className="text-xs text-slate-500">Refeições servidas · valores ilustrativos</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">Meta 60 mil</span></div>
          <TrendChart points={snapshot.trend.points} target={snapshot.trend.target} />
        </section>
        <aside className={`${surface} flex flex-col justify-between overflow-hidden !bg-slate-950 p-6 text-white`}>
          <div><span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold"><Sparkles className="h-3.5 w-3.5" /> Leitura rápida</span><h3 className="mt-6 text-2xl font-black">O mês está acima da meta fictícia.</h3><p className="mt-3 text-sm leading-6 text-slate-300">O crescimento vem principalmente do Restaurante Central, enquanto a Unidade Norte concentra as divergências.</p></div>
          <button type="button" onClick={onOpenCriticalUnit} className="mt-8 flex items-center justify-between rounded-2xl bg-red-600 px-4 py-3 text-sm font-black transition hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Ver unidade crítica <ArrowRight className="h-4 w-4" /></button>
        </aside>
      </div>
    </div>
  );
}

function ServiceView({ snapshot }: { snapshot: IntelligenceSnapshot }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Operação e filas" title="Estamos atendendo bem?" description="Tempo de atendimento, concentração de demanda e bloqueios ajudam a entender a experiência no restaurante." />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={Clock3} label="Tempo médio" value={`${snapshot.service.averageServiceSeconds}s`} trend="-2,1s" trendTone="positive" helper="Meta fictícia de até 22 segundos." tone="positive" />
        <MetricCard icon={Gauge} label="Pico simultâneo" value={formatNumber(snapshot.service.peakVolume)} helper="Maior concentração entre 12h e 13h." tone="warning" />
        <MetricCard icon={CloudOff} label="Eventos offline" value={formatNumber(snapshot.service.offlineEvents)} helper="Eventos conhecidos; não representa falha confirmada." />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <section className={`${surface} p-6`}><h3 className="font-black text-slate-950">Fluxo por faixa horária</h3><p className="mb-6 mt-1 text-xs text-slate-500">Barras ordenadas pelo horário operacional.</p><HorizontalBars items={snapshot.service.hourlyFlow} accent="#dc2626" /></section>
        <section className={`${surface} p-6`}><h3 className="font-black text-slate-950">Por que bloqueamos?</h3><div className="mt-5 space-y-4"><HorizontalBars items={snapshot.service.blockedReasons} accent="#f59e0b" /></div><div className="mt-6"><Insight tone="warning" title="Ação sugerida">Reforçar comunicação de saldo antes do jantar.</Insight></div></section>
      </div>
    </div>
  );
}

function ResultView({ snapshot }: { snapshot: IntelligenceSnapshot }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Leitura financeira" title="Onde está o resultado?" description="Cada valor mantém seu significado: valor facial, recargas e custódia aparecem separados para evitar dupla contagem." />
      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard icon={BadgeDollarSign} label="Valor facial das refeições" value={formatCurrency(snapshot.summary.faceValue, true)} trend="+8,2%" helper="Referência econômica das refeições servidas." />
        <MetricCard icon={CircleDollarSign} label="Recargas confirmadas" value={formatCurrency(snapshot.summary.confirmedRecharges, true)} trend="+3,7%" helper="Fluxo financeiro separado do valor facial." tone="positive" />
        <MetricCard icon={Landmark} label="Saldo em custódia" value={formatCurrency(snapshot.summary.custodyBalance, true)} helper="Obrigação representada pelo saldo das carteiras." />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={`${surface} p-6 md:p-8`}><div className="flex items-center justify-between"><div><h3 className="font-black text-slate-950">Composição do valor facial</h3><p className="mt-1 text-xs text-slate-500">Distribuição ilustrativa por categoria.</p></div><Banknote className="h-6 w-6 text-red-600" /></div><div className="mt-8 space-y-5"><HorizontalBars items={snapshot.financialComposition} valueFormatter={(value) => formatCurrency(value, true)} /></div></section>
        <section className={`${surface} p-6 md:p-8`}><h3 className="font-black text-slate-950">Decisão recomendada</h3><div className="mt-5 space-y-3"><Insight tone="positive" title="Volume saudável">O valor facial cresce junto com o número de refeições.</Insight><Insight tone="info" title="Leitura sem mistura">Recargas não são apresentadas como receita das refeições.</Insight><Insight tone="warning" title="Homologação pendente">Termos contábeis definitivos ainda dependem de validação financeira.</Insight></div></section>
      </div>
    </div>
  );
}

function UnitsView({ snapshot }: { snapshot: IntelligenceSnapshot }) {
  const visibleUnits = snapshot.units;
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Comparação operacional" title="Qual unidade precisa de atenção?" description="O ranking mostra volume, meta fictícia e sinais operacionais que ajudam a priorizar a gestão." />
      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <section className={`${surface} p-6 md:p-8`}><div className="mb-7 flex items-center justify-between"><div><h3 className="font-black text-slate-950">Ranking por refeições</h3><p className="text-xs text-slate-500">Ordenado do maior para o menor volume.</p></div><MapPin className="h-5 w-5 text-red-600" /></div><HorizontalBars items={visibleUnits.map((unit) => ({ label: unit.name, value: unit.meals, note: `${unit.variation > 0 ? '+' : ''}${unit.variation}% versus período anterior` }))} /></section>
        <aside className="space-y-4">{visibleUnits.map((unit) => <article key={unit.id} className={`${surface} p-5`}><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-950">{unit.name}</p><p className="mt-1 text-xs text-slate-500">Meta fictícia: {formatNumber(unit.target)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-black ${unit.divergence > 0.5 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{unit.divergence.toFixed(2).replace('.', ',')}%</span></div><div className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-600">{unit.variation >= 0 ? <ArrowUpRight className="h-4 w-4 text-emerald-600" /> : <ArrowDownRight className="h-4 w-4 text-red-600" />}{unit.variation >= 0 ? 'Evolução positiva' : 'Abaixo do período anterior'}</div></article>)}</aside>
      </div>
    </div>
  );
}

function AudienceView({ snapshot }: { snapshot: IntelligenceSnapshot }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Perfil de utilização" title="Quem está utilizando o serviço?" description="Entenda a composição do público sem transformar dados pessoais em exposição desnecessária." />
      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className={`${surface} p-6 md:p-8`}><h3 className="font-black text-slate-950">Consumo por categoria</h3><p className="mb-8 mt-1 text-xs text-slate-500">Distribuição sintética do período selecionado.</p><AudienceDonut categories={snapshot.audience.categories} /></section>
        <section className={`${surface} p-6 md:p-8`}><h3 className="font-black text-slate-950">Frequência de utilização</h3><div className="mt-6"><HorizontalBars items={snapshot.audience.frequencies} accent="#15803d" /></div><div className="mt-6"><Insight tone="info" title="Privacidade por padrão">Esta visão usa somente dados agregados e fictícios.</Insight></div></section>
      </div>
    </div>
  );
}

function ConceptView({ type }: { type: 'waste' | 'forecast' }) {
  const isWaste = type === 'waste';
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Conceito não homologado" title={isWaste ? 'Onde estamos desperdiçando?' : 'Como vamos fechar o mês?'} description={isWaste ? 'Uma proposta visual para cruzar produção, consumo e sobras quando existirem dados homologados.' : 'Uma proposta de previsão com faixa de confiança, sem apresentar projeções fictícias como resultado real.'} />
      <div className={`${surface} relative overflow-hidden p-6 md:p-10`}>
        <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-amber-100/70 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
          <div><span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-800"><TriangleAlert className="h-4 w-4" /> Dados ainda não homologados</span><h3 className="mt-5 text-3xl font-black tracking-tight text-slate-950">{isWaste ? 'Do prato à decisão.' : 'Previsão com responsabilidade.'}</h3><p className="mt-3 text-sm leading-7 text-slate-600">{isWaste ? 'A futura visão mostrará produção planejada, refeições efetivas, sobra limpa e descarte por unidade.' : 'A futura visão deverá separar realizado, tendência e intervalo de confiança, sempre indicando premissas.'}</p><button type="button" disabled className="mt-6 inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-200 px-4 py-3 text-sm font-black text-slate-500">Integração bloqueada <ShieldAlert className="h-4 w-4" /></button></div>
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/80 p-5 md:p-7"><div className="grid grid-cols-7 items-end gap-2" role="img" aria-label="Gráfico conceitual com sete barras fictícias e sem significado operacional">{[44, 58, 51, 68, 62, 76, 82].map((height, index) => <div key={index} className="group flex flex-col items-center gap-2"><div className="relative h-48 w-full overflow-hidden rounded-xl bg-white"><div className="absolute inset-x-0 bottom-0 rounded-xl bg-slate-300 transition group-hover:bg-red-300" style={{ height: `${height}%` }} /></div><span className="text-[10px] font-bold text-slate-400">S{index + 1}</span></div>)}</div><p className="mt-4 text-center text-xs font-bold text-slate-400">Visual ilustrativo · sem significado operacional</p></div>
        </div>
      </div>
    </div>
  );
}

function ActionsView({ snapshot }: { snapshot: IntelligenceSnapshot }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Prioridades gerenciais" title="O que exige ação agora?" description="Alertas demonstrativos transformam sinais em responsáveis, prazo e próximo passo claro." />
      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <section className={`${surface} overflow-hidden`}><div className="border-b border-slate-100 p-6"><h3 className="font-black text-slate-950">Fila de decisões</h3><p className="mt-1 text-xs text-slate-500">Alertas fictícios ordenados por urgência.</p></div><div className="divide-y divide-slate-100">{snapshot.actions.map((item, index) => { const Icon = item.severity === 'critical' ? AlertTriangle : item.severity === 'warning' ? BellRing : Info; return <article key={item.title} className="group flex gap-4 p-5 transition hover:bg-slate-50"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${item.severity === 'critical' ? 'bg-red-50 text-red-700' : item.severity === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}><Icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-black uppercase tracking-wider text-slate-400">Prioridade {index + 1}</p><h4 className="mt-1 font-black text-slate-950">{item.title}</h4></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{item.due}</span></div><p className="mt-2 text-sm leading-6 text-slate-500">{item.detail}</p><div className="mt-3 flex items-center justify-between"><span className="text-xs font-bold text-slate-600">Responsável: {item.owner}</span><ChevronRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1" /></div></div></article>; })}</div></section>
        <aside className="space-y-4"><div className={`${surface} !bg-slate-950 p-6 text-white`}><Target className="h-7 w-7 text-red-400" /><p className="mt-5 text-sm font-bold text-slate-300">Foco recomendado</p><strong className="mt-2 block text-2xl font-black">Resolver caixa antes de ampliar análises.</strong><p className="mt-3 text-sm leading-6 text-slate-400">A recomendação demonstra como o painel poderá transformar exceções em prioridade.</p></div><Insight tone="info" title="Alertas demonstrativos">Nenhuma tarefa foi criada e nenhum usuário real foi notificado.</Insight></aside>
      </div>
    </div>
  );
}

function ReadyView({ activeView, snapshot, onOpenCriticalUnit }: { activeView: DemoViewId; snapshot: IntelligenceSnapshot; onOpenCriticalUnit: () => void }) {
  if (activeView === 'month') return <MonthView snapshot={snapshot} onOpenCriticalUnit={onOpenCriticalUnit} />;
  if (activeView === 'service') return <ServiceView snapshot={snapshot} />;
  if (activeView === 'result') return <ResultView snapshot={snapshot} />;
  if (activeView === 'units') return <UnitsView snapshot={snapshot} />;
  if (activeView === 'audience') return <AudienceView snapshot={snapshot} />;
  if (activeView === 'waste') return <ConceptView type="waste" />;
  if (activeView === 'forecast') return <ConceptView type="forecast" />;
  return <ActionsView snapshot={snapshot} />;
}

function SimulatedState({ state }: { state: Exclude<DemoScreenState, 'ready'> }) {
  if (state === 'loading') return <div className="space-y-6" aria-live="polite"><div className="h-9 w-72 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" /><div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className={`${surface} h-44 animate-pulse bg-slate-100 motion-reduce:animate-none`} />)}</div><div className={`${surface} grid min-h-80 place-items-center`}><div className="text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-red-600 motion-reduce:animate-none" /><p className="mt-3 text-sm font-bold text-slate-500">Carregando demonstração...</p></div></div></div>;
  const empty = state === 'empty';
  return <div className={`${surface} grid min-h-[480px] place-items-center p-8 text-center`}><div className="max-w-md">{empty ? <Filter className="mx-auto h-12 w-12 text-slate-300" /> : <CloudOff className="mx-auto h-12 w-12 text-red-400" />}<h2 className="mt-5 text-2xl font-black text-slate-950">{empty ? 'Nenhum dado para esta combinação' : 'Indicadores temporariamente indisponíveis'}</h2><p className="mt-3 text-sm leading-6 text-slate-500">{empty ? 'Este estado demonstra como a interface orienta o usuário a revisar os filtros.' : 'Este estado demonstra uma falha segura, sem reutilizar valores antigos como se fossem atuais.'}</p></div></div>;
}

export function IntelligenceDemo() {
  const [activeView, setActiveView] = useState<DemoViewId>('month');
  const [screenState, setScreenState] = useState<DemoScreenState>('ready');
  const [filters, setFilters] = useState<DemoFilters>({ period: 'october', unit: 'all', category: 'all' });
  const providerResult = useIntelligenceSnapshot(filters);
  const activeQuestion = demoViews.find((view) => view.id === activeView)?.question;
  const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600';
  const openCriticalUnit = () => {
    setFilters((current) => ({ ...current, unit: 'north' }));
    setScreenState('ready');
    setActiveView('units');
  };

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-slate-900">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-5 py-5 md:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-red-600 shadow-lg shadow-red-950/30"><Utensils className="h-6 w-6" /></div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-black tracking-tight">Central de Inteligência</h1><span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-200">Demonstração</span></div><p className="mt-0.5 text-xs text-slate-400">MA Refeições · dados 100% fictícios</p></div></div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300"><span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-2"><CalendarDays className="h-4 w-4 text-red-400" /> Atualizado em 24/10/2026 às 14:35</span><span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-2 font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Protótipo local</span></div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5 md:px-8 md:py-8">
        <nav className="overflow-x-auto pb-2" aria-label="Experiências da Central de Inteligência"><div className="flex min-w-max gap-2">{demoViews.map((view) => <button key={view.id} type="button" onClick={() => setActiveView(view.id)} aria-current={activeView === view.id ? 'page' : undefined} title={view.question} className={`rounded-full px-4 py-2.5 text-sm font-black transition ${focusRing} ${activeView === view.id ? 'bg-slate-950 text-white shadow-lg' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-950'}`}>{view.shortLabel}</button>)}</div></nav>

        <section className={`${surface} mt-4 p-4`} aria-label="Filtros demonstrativos">
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
            <label className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500">Período<select value={filters.period} onChange={(event) => setFilters((current) => ({ ...current, period: event.target.value as DemoFilters['period'] }))} className={`mt-1 block w-full bg-transparent text-sm font-bold normal-case tracking-normal text-slate-950 ${focusRing}`}><option value="october">Outubro de 2026</option><option value="september">Setembro de 2026</option><option value="last30">Últimos 30 dias</option></select></label>
            <label className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500">Unidade<select value={filters.unit} onChange={(event) => setFilters((current) => ({ ...current, unit: event.target.value as DemoFilters['unit'] }))} className={`mt-1 block w-full bg-transparent text-sm font-bold normal-case tracking-normal text-slate-950 ${focusRing}`}><option value="all">Todas as unidades</option><option value="central">Restaurante Central</option><option value="north">Unidade Norte</option><option value="south">Unidade Sul</option></select></label>
            <label className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500">Categoria<select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value as DemoFilters['category'] }))} className={`mt-1 block w-full bg-transparent text-sm font-bold normal-case tracking-normal text-slate-950 ${focusRing}`}><option value="all">Todas as categorias</option>{demoCategoryOptions.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
            <button type="button" onClick={() => setFilters({ period: 'october', unit: 'all', category: 'all' })} className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 ${focusRing}`}><RefreshCw className="h-4 w-4" /> Limpar</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><p className="text-xs text-slate-500"><strong className="text-slate-700">Pergunta ativa:</strong> {activeQuestion}</p><div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" aria-label="Simular estados da interface">{(['ready', 'loading', 'empty', 'unavailable'] as DemoScreenState[]).map((state) => <button key={state} type="button" onClick={() => setScreenState(state)} aria-pressed={screenState === state} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-black transition ${focusRing} ${screenState === state ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{state === 'ready' ? 'Dados' : state === 'loading' ? 'Carregando' : state === 'empty' ? 'Vazio' : 'Indisponível'}</button>)}</div></div>
        </section>

        <section className="mt-8" aria-live="polite">{
          screenState !== 'ready'
            ? <SimulatedState state={screenState} />
            : !providerResult
              ? <SimulatedState state="loading" />
              : providerResult.status === 'ready'
                ? <ReadyView activeView={activeView} snapshot={providerResult.snapshot} onOpenCriticalUnit={openCriticalUnit} />
                : <SimulatedState state={providerResult.status} />
        }</section>

        <footer className="mt-10 flex flex-col gap-3 border-t border-slate-200 py-6 text-xs text-slate-500 md:flex-row md:items-center md:justify-between"><p className="inline-flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-red-600" /> Protótipo sem conexão com Supabase, autenticação ou serviços operacionais.</p><p>Valores, metas, alertas e tendências são exclusivamente ilustrativos.</p></footer>
      </main>
    </div>
  );
}
