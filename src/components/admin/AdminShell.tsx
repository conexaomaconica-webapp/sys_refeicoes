'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Building2,
  CreditCard,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Monitor,
  Palette,
  ShieldCheck,
  Tags,
  Users,
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
  secondaryColor: string;
}

interface AdminShellProps {
  children: React.ReactNode;
  role: UserRole;
  branding: AdminBranding;
}

const navigation: Array<{ href: string; label: string; icon: typeof LayoutDashboard; roles: UserRole[] }> = [
  { href: '/admin', label: 'Visão geral', icon: LayoutDashboard, roles: ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'] },
  { href: '/admin/identidade', label: 'Configurações Master', icon: Palette, roles: ['admin_general'] },
  { href: '/admin/usuarios', label: 'Usuários e acessos', icon: ShieldCheck, roles: ['admin_general', 'operations_director', 'unit_manager'] },
  { href: '/admin/unidades', label: 'Unidades', icon: Building2, roles: ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'] },
  { href: '/admin/financeiro', label: 'Financeiro', icon: CreditCard, roles: ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'] },
  { href: '/admin/categorias', label: 'Categorias e valores', icon: Tags, roles: ['admin_general', 'operations_director', 'supervisor', 'unit_manager'] },
  { href: '/admin/caixa', label: 'Caixas e turnos', icon: WalletCards, roles: ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'] },
  { href: '/admin/comensais', label: 'Comensais', icon: Users, roles: ['admin_general', 'operations_director', 'supervisor', 'unit_manager'] },
  { href: '/admin/importacoes', label: 'Importação de comensais', icon: FileSpreadsheet, roles: ['admin_general', 'operations_director'] },
];

export function AdminShell({ children, role, branding }: AdminShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const allowedNavigation = navigation.filter((item) => item.roles.includes(role));

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    window.localStorage.setItem('ma-refeicoes-tenant-slug', branding.slug);
  }, [branding.slug]);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem('ma-refeicoes-admin-sidebar-collapsed') === 'true');
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('ma-refeicoes-admin-sidebar-collapsed', String(next));
      return next;
    });
  };

  const shellStyle = {
    '--admin-primary': branding.primaryColor,
    '--admin-secondary': branding.secondaryColor,
    background: `radial-gradient(circle at 92% 4%, ${branding.primaryColor}14, transparent 24rem), radial-gradient(circle at 12% 96%, ${branding.secondaryColor}10, transparent 28rem), #f8fafc`,
  } as CSSProperties;

  const renderSidebar = (compact: boolean) => (
    <div
      className="flex h-full flex-col text-white"
      style={{
        background: `linear-gradient(165deg, ${branding.secondaryColor} 0%, ${branding.primaryColor} 100%)`,
      }}
    >
      <div className={`flex min-h-20 items-center border-b border-white/15 py-4 ${compact ? 'justify-center px-2' : 'gap-3 px-5'}`}>
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-lg">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.appName} className="h-full w-full object-contain" />
          ) : (
            <LayoutDashboard className="h-5 w-5" style={{ color: branding.primaryColor }} />
          )}
        </div>
        {!compact && <div className="min-w-0">
          <p className="truncate text-sm font-black">{branding.appName}</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/65">Administração</p>
        </div>}
      </div>

      <nav className={`flex-1 space-y-1 overflow-y-auto ${compact ? 'px-2 py-3' : 'p-3'}`} aria-label="Menu administrativo">
        {allowedNavigation.map((item) => {
          const Icon = item.icon;
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={compact ? item.label : undefined}
              className={`flex items-center rounded-xl py-3 text-sm font-bold transition ${compact ? 'justify-center px-2' : 'gap-3 px-3'} ${
                active ? 'bg-white shadow-lg' : 'text-white/80 hover:bg-white/15 hover:text-white'
              }`}
              style={active ? { color: branding.primaryColor } : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!compact && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-white/15 ${compact ? 'p-2' : 'p-3'}`}>
        <Link
          href="/terminal"
          title={compact ? 'Abrir terminal' : undefined}
          className={`flex items-center rounded-xl py-3 text-sm font-bold text-white/80 transition hover:bg-white/15 hover:text-white ${compact ? 'justify-center px-2' : 'gap-3 px-3'}`}
        >
          <Monitor className="h-5 w-5 shrink-0" />
          {!compact && 'Abrir terminal'}
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`mt-1 hidden w-full items-center rounded-xl py-3 text-sm font-bold text-white/80 transition hover:bg-white/15 hover:text-white lg:flex ${compact ? 'justify-center px-2' : 'gap-3 px-3'}`}
          aria-label={compact ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          title={compact ? 'Expandir menu lateral' : undefined}
        >
          {compact ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          {!compact && 'Recolher menu'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen text-slate-900 lg:flex" style={shellStyle}>
      <aside className={`sticky top-0 hidden h-screen shrink-0 transition-[width] duration-300 lg:block ${collapsed ? 'w-20' : 'w-64'}`}>
        {renderSidebar(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-72 max-w-[86vw] shadow-2xl">{renderSidebar(false)}</aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header
          className="sticky top-0 z-40 flex min-h-20 items-center justify-between gap-4 border-b bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:px-6"
          style={{ borderColor: `${branding.primaryColor}30`, boxShadow: `inset 0 3px 0 ${branding.primaryColor}` }}
        >
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
              <p className="truncate text-sm font-black" style={{ color: branding.primaryColor }}>Painel administrativo</p>
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
