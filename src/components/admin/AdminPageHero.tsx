import React from 'react';

interface AdminPageHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
  className?: string;
}

export function AdminPageHero({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}: AdminPageHeroProps) {
  return (
    <section
      className={`flex flex-col justify-between gap-5 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-red-950 p-6 text-white shadow-xl md:flex-row md:items-end md:p-8 ${className}`.trim()}
    >
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-black">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </section>
  );
}

