'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Utensils,
} from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import { createBrowserClient } from '@/lib/supabase/client';
import { getPostLoginDestination } from '@/lib/auth/post-login-destination';

interface PortalLoginProps {
  audience: 'staff' | 'consumer';
}

export function PortalLogin({ audience }: PortalLoginProps) {
  const { branding, isLoading } = useBrand();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const isConsumer = audience === 'consumer';
  const desktopBackground = isConsumer
    ? branding.consumer_login_background_url
    : branding.staff_login_background_url;
  const mobileBackground = isConsumer
    ? branding.consumer_login_mobile_background_url
    : branding.staff_login_mobile_background_url;
  const hasBackground = Boolean(desktopBackground || mobileBackground);
  const visible = branding.login_element_visibility;
  const desktopPanelPosition = branding.login_panel_positions[
    isConsumer ? 'consumer_desktop' : 'staff_desktop'
  ];
  const mobilePanelPosition = branding.login_panel_positions[
    isConsumer ? 'consumer_mobile' : 'staff_mobile'
  ];
  const panelStyle = {
    '--login-panel-desktop-x': `${desktopPanelPosition.x}%`,
    '--login-panel-desktop-y': `${desktopPanelPosition.y}%`,
    '--login-panel-mobile-x': `${mobilePanelPosition.x}%`,
    '--login-panel-mobile-y': `${mobilePanelPosition.y}%`,
  } as CSSProperties;

  useEffect(() => setLogoFailed(false), [branding.logo_url]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: identifier.trim(),
        password,
      });

      if (error) {
        setErrorMessage(
          error.message === 'Invalid login credentials'
            ? 'Credenciais inválidas. Verifique o e-mail e a senha.'
            : error.message
        );
        return;
      }

      if (!data.user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('role,status')
        .eq('id', data.user.id)
        .maybeSingle();
      const profile = profileData as { role: string; status: string } | null;

      if (profile?.status !== 'active') {
        await supabase.auth.signOut();
        setErrorMessage('Usuário inativo ou sem perfil de acesso válido.');
        return;
      }

      if (isConsumer && profile.role !== 'student') {
        await supabase.auth.signOut();
        setErrorMessage('Este acesso é exclusivo para consumidores. Use o portal interno.');
        return;
      }

      if (!isConsumer && profile.role === 'student') {
        await supabase.auth.signOut();
        setErrorMessage('Consumidores devem entrar pelo Portal do Consumidor.');
        return;
      }

      // Navegação completa garante que o middleware leia os cookies de sessão
      // recém-gravados antes de renderizar a área protegida.
      window.location.assign(getPostLoginDestination(profile.role));
    } catch (submitError) {
      setErrorMessage((submitError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-slate-100 text-slate-900"
    >
      {hasBackground ? (
        <picture className="absolute inset-0">
          <source
            media="(max-width: 767px)"
            srcSet={mobileBackground || desktopBackground || undefined}
          />
          <img
            src={desktopBackground || mobileBackground || undefined}
            alt=""
            className={`h-full w-full ${isConsumer ? 'object-cover object-top' : 'object-cover'}`}
          />
        </picture>
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 18% 22%, ${branding.terminal_accent_color}55, transparent 32%), linear-gradient(135deg, #ffffff 0%, #fff7ed 46%, ${branding.primary_color || '#C5161D'}22 100%)`,
          }}
        />
      )}

      <div
        className={`absolute inset-0 ${
          isConsumer
            ? 'bg-gradient-to-b from-transparent via-white/5 to-white/80 md:bg-gradient-to-r md:from-transparent md:via-white/20 md:to-white/70'
            : 'bg-gradient-to-b from-white/5 via-white/10 to-white/70 md:bg-gradient-to-r md:from-transparent md:via-white/10 md:to-white/75'
        }`}
      />

      {!hasBackground && visible.marketing && (
        <aside className="absolute inset-y-0 left-0 hidden w-[58%] items-center px-12 lg:flex xl:px-20">
          <div className="max-w-xl">
            <p className="text-sm font-black uppercase tracking-[0.24em]" style={{ color: branding.primary_color || '#C5161D' }}>
              {isConsumer ? 'Portal do Consumidor' : 'Portal do Administrador & Operador'}
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight xl:text-5xl">
              {isConsumer
                ? 'Seu acesso às refeições em um só lugar.'
                : 'Gestão, operação e controle em tempo real.'}
            </h1>
            <p className="mt-5 max-w-lg text-lg text-slate-600">
              {isConsumer
                ? 'Consulte seu cartão virtual, histórico e, quando aplicável, saldo e recargas.'
                : 'Acompanhe unidades, caixas, cadastros e indicadores com segurança.'}
            </p>
          </div>
        </aside>
      )}

      <main className="relative z-10 min-h-screen w-full" style={panelStyle}>
        <section className="absolute left-[var(--login-panel-mobile-x)] top-[var(--login-panel-mobile-y)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-2xl backdrop-blur-md sm:p-8 md:left-[var(--login-panel-desktop-x)] md:top-[var(--login-panel-desktop-y)]">
          <div className="text-center">
            {visible.logo && <div className="mx-auto flex h-24 items-center justify-center">
              {isLoading ? (
                <div className="h-16 w-40 animate-pulse rounded-2xl bg-slate-100" />
              ) : branding.logo_url && !logoFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logo_url}
                  alt={branding.app_name}
                  className="max-h-24 max-w-[250px] object-contain"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <div
                  className="grid h-16 w-16 place-items-center rounded-2xl text-white shadow-lg"
                  style={{ backgroundColor: branding.primary_color || '#C5161D' }}
                >
                  <Utensils className="h-8 w-8" />
                </div>
              )}
            </div>}
            {visible.title && <h2 className="mt-3 text-2xl font-black">
              {isConsumer ? 'Portal do Consumidor' : 'Acesso ao Sistema'}
            </h2>}
            {visible.description && <p className="mt-2 text-sm text-slate-500">
              {isConsumer
                ? 'Entre para acessar seu cartão, histórico e serviços.'
                : 'Administradores, gestores e operadores.'}
            </p>}
          </div>

          {errorMessage && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="block">
              <label
                htmlFor={`${audience}-login-email`}
                className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600"
              >
                {isConsumer ? 'E-mail de acesso' : 'E-mail'}
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id={`${audience}-login-email`}
                  type="email"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="usuario@dominio.com"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100"
                />
              </div>
            </div>

            <div className="block">
              <label
                htmlFor={`${audience}-login-password`}
                className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600"
              >
                Senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id={`${audience}-login-password`}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-12 text-sm outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-300"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={showPassword}
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-black text-white shadow-lg transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
              style={{ backgroundColor: branding.primary_color || '#C5161D' }}
            >
              {isSubmitting ? 'Conectando...' : 'Entrar'}
              {!isSubmitting && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          {visible.access_links && <div className={`mt-4 flex items-center gap-3 text-xs font-bold ${isConsumer ? 'justify-between' : 'justify-center'}`}>
            {isConsumer && (
              <Link href="/conta/primeiro-acesso" className="text-red-700 hover:underline">
                Primeiro acesso
              </Link>
            )}
            <Link href="/conta/esqueci-senha" className="text-slate-600 hover:underline">
              Esqueci minha senha
            </Link>
          </div>}

          {visible.portal_switch && <div className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
            {isConsumer ? 'Acesso da equipe?' : 'Você é consumidor?'}{' '}
            <Link
              href={isConsumer ? '/login' : '/conta/login'}
              className="font-black hover:underline"
              style={{ color: branding.primary_color || '#C5161D' }}
            >
              {isConsumer ? 'Portal interno' : 'Portal do Consumidor'}
            </Link>
          </div>}

          {visible.security_badge && <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Ambiente seguro · {branding.app_name}
          </div>}
        </section>
      </main>
    </div>
  );
}
