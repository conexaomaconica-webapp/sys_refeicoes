'use client';

import type { IntelligenceCategoryMetric } from '@/features/intelligence/contracts';

interface TrendPoint {
  label: string;
  value: number;
}

export function TrendChart({ points, target = 60000 }: { points: TrendPoint[]; target?: number }) {
  const width = 760;
  const height = 250;
  const padding = 28;
  const maximum = Math.max(...points.map((point) => point.value), target) * 1.08;
  const minimum = Math.min(...points.map((point) => point.value)) * 0.9;
  const range = Math.max(maximum - minimum, 1);
  const x = (index: number) => padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
  const y = (value: number) => height - padding - ((value - minimum) / range) * (height - padding * 2);
  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label="Evolução demonstrativa de refeições servidas nos últimos doze meses"
      >
        <defs>
          <linearGradient id="demo-area-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#dc2626" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((row) => {
          const gridY = padding + (row * (height - padding * 2)) / 3;
          return <line key={row} x1={padding} x2={width - padding} y1={gridY} y2={gridY} stroke="#e2e8f0" strokeDasharray="4 7" />;
        })}
        <line x1={padding} x2={width - padding} y1={y(target)} y2={y(target)} stroke="#f59e0b" strokeDasharray="8 7" strokeWidth="2" />
        <text x={width - padding} y={y(target) - 8} textAnchor="end" fill="#b45309" fontSize="11" fontWeight="700">Meta fictícia</text>
        <polygon points={area} fill="url(#demo-area-gradient)" />
        <polyline points={line} fill="none" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <g key={point.label}>
            <circle cx={x(index)} cy={y(point.value)} r="5" fill="#ffffff" stroke="#dc2626" strokeWidth="3" tabIndex={0}>
              <title>{`${point.label}: ${point.value.toLocaleString('pt-BR')} refeições`}</title>
            </circle>
            <text x={x(index)} y={height - 5} textAnchor="middle" fill="#64748b" fontSize="11">{point.label}</text>
          </g>
        ))}
      </svg>
      <details className="mt-2 text-xs text-slate-500">
        <summary className="cursor-pointer font-bold text-slate-600">Alternativa textual do gráfico</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-3">
          {points.map((point) => <li key={point.label}>{point.label}: {point.value.toLocaleString('pt-BR')}</li>)}
        </ul>
      </details>
    </div>
  );
}

export function HorizontalBars({
  items,
  valueFormatter = (value) => value.toLocaleString('pt-BR'),
  accent = '#dc2626',
}: {
  items: Array<{ label: string; value: number; note?: string }>;
  valueFormatter?: (value: number) => string;
  accent?: string;
}) {
  const maximum = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-4" role="list" aria-label="Gráfico de barras horizontais demonstrativo">
      {items.map((item) => (
        <div key={item.label} role="listitem" title={`${item.label}: ${valueFormatter(item.value)}`}>
          <div className="mb-1.5 flex items-end justify-between gap-3 text-sm">
            <span className="font-bold text-slate-700">{item.label}</span>
            <span className="text-right font-black text-slate-950">{valueFormatter(item.value)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max((item.value / maximum) * 100, 3)}%`, backgroundColor: accent }}
            />
          </div>
          {item.note && <p className="mt-1 text-xs text-slate-500">{item.note}</p>}
        </div>
      ))}
    </div>
  );
}

export function AudienceDonut({
  categories,
}: {
  categories: IntelligenceCategoryMetric[];
}) {
  let cursor = 0;
  const segments = categories.map((category) => {
    const start = cursor;
    cursor += category.percentage;
    return `${category.color} ${start}% ${cursor}%`;
  });
  const gradient = categories.length === 1
    ? categories[0].color
    : `conic-gradient(${segments.join(', ')})`;
  const accessibleSummary = categories
    .map((category) => `${category.percentage} por cento ${category.label}`)
    .join(', ');
  return (
    <div className="grid items-center gap-8 md:grid-cols-[220px_1fr]">
      <div
        className="relative mx-auto aspect-square w-52 rounded-full"
        style={{ background: gradient }}
        role="img"
        aria-label={accessibleSummary}
      >
        <div className="absolute inset-[22%] grid place-items-center rounded-full bg-white text-center shadow-inner">
          <div><strong className="block text-2xl font-black text-slate-950">100%</strong><span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">do público</span></div>
        </div>
      </div>
      <div className="space-y-4">
        {categories.map((category) => (
          <div key={category.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
              <div><p className="font-bold text-slate-800">{category.label}</p><p className="text-xs text-slate-500">{category.meals.toLocaleString('pt-BR')} refeições</p></div>
            </div>
            <strong className="text-xl font-black text-slate-950">{category.percentage}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
