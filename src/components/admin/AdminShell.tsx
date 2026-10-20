'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  FileSpreadsheet,
  LayoutDashboard,
  Menu,
  Monitor,
  Palette,
  Tags,
  WalletCards,
  X,
} from 'lucide-react';
import type { UserRole } from '@/types/auth';
import { AdminSignOutButton } from './AdminSignOutButton';

interface AdminBranding {
  appName: string;
  logoUrl: string | null;
  slug: string;
  primaryColor: string;
}

interface AdminShellProps {
  children: React.ReactNode;
  role: UserRole;
  branding: AdminBranding;
}

const navigation: Array<{ href: string; label: string; icon: typeof LayoutDashboard; roles: UserRole[] }> = [
  { href: '/admin', label: 'Visão geral', icon: LayoutDashboard, roles: ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'] },
  { href: '/admin/identidade', label: 'Identidade visual', icon: Palette, roles: ['admin_general'] },
  { href: '/admin/categorias', label: 'Categorias e valores', icon: Tags, roles: ['admin_general', 'operations_director', 'supervisor', 'unit_manager'] },
  { href: '/admin/caixa', label: 'Caixas e turnos', icon: WalletCards, roles: ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'] },
  { href: '/admin/importacoes', label: 'Importação de comensais', icon: FileSpreadsheet, roles: ['admin_general', 'operations_director'] },
];

export function AdminShell({ children, role, branding }: AdminShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const allowedNavigation = navigation.filter((item) => item.roles.includes(role));

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    window.localStorage.setItem('ma-refeicoes-tenant-slug', branding.slug);
  }, [branding.slug]);

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <div className="flex min-h-20 items-center gap-3 border-b border-white/10 px-5 py-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-lg">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.appName} className="h-full w-full object-contain" />
          ) : (
            <LayoutDashboard className="h-5 w-5" style={{ color: branding.primaryColor }} />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black">{branding.appName}</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Administração</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Menu administrativo">
        {allowedNavigation.map((item) => {
          const Icon = item.icon;
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition ${
                active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link href="/terminal" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/10 hover:text-white">
          <Monitor className="h-4 w-4" />
          Abrir terminal
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-72 max-w-[86vw] shadow-2xl">{sidebar}</aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex min-h-20 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMobileOpen((open) => !open)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 lg:hidden" aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}>
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1 lg:hidden">
              {branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branding.logoUrl} alt={branding.appName} className="h-full w-full object-contain" />
              ) : (
                <LayoutDashboard className="h-5 w-5" style={{ color: branding.primaryColor }} />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black">Painel administrativo</p>
              <p className="truncate text-xs text-slate-500">{branding.appName}</p>
            </div>
          </div>
          <AdminSignOutButton />
        </header>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
