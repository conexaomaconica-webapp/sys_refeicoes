'use client';

import React, { useEffect, useState } from 'react';
import { useBrand } from './BrandProvider';
import { createBrowserClient } from '@/lib/supabase/client';
import { Utensils, ShieldCheck } from 'lucide-react';

interface SplashScreenProps {
  onFinish?: (hasSession: boolean) => void;
}

export function SplashScreen({ onFinish }: SplashScreenProps) {
  const { branding, refreshBranding } = useBrand();
  const [isFadingOut, setIsFadingOut] = useState<boolean>(false);
  const [isVisible, setIsVisible] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    const startTime = Date.now();
    const minDisplayTimeMs = 800; // Mínimo estético para evitar flicker
    const configuredDurationMs = branding.splash_duration_ms || 1200;

    async function initializeApp() {
      const supabase = createBrowserClient();

      // Execução paralela: Branding e Checagem de Sessão
      const [, sessionResult] = await Promise.allSettled([
        refreshBranding(),
        supabase.auth.getSession(),
      ]);

      const hasSession =
        sessionResult.status === 'fulfilled' &&
        !!sessionResult.value.data?.session?.user;

      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(minDisplayTimeMs - elapsed, 0);
      const totalWait = Math.min(remainingTime + 200, configuredDurationMs);

      setTimeout(() => {
        if (!isMounted) return;
        setIsFadingOut(true);

        // Aguarda animação de fade-out (300ms)
        setTimeout(() => {
          if (!isMounted) return;
          setIsVisible(false);
          if (onFinish) {
            onFinish(hasSession);
          }
        }, 350);
      }, totalWait);
    }

    initializeApp();

    return () => {
      isMounted = false;
    };
  }, [branding.splash_duration_ms, refreshBranding, onFinish]);

  if (!isVisible) return null;

  return (
    <aside
      role="status"
      aria-label="Carregando aplicativo"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center p-6 transition-opacity duration-300 ease-in-out ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        backgroundColor: branding.splash_background || '#0f172a',
        backgroundImage:
          'radial-gradient(ellipse at 50% 30%, rgba(2, 132, 199, 0.15) 0%, transparent 70%)',
      }}
    >
      <div className="flex flex-col items-center max-w-sm w-full text-center">
        {/* Ícone ou Logo do Tenant */}
        <div className="relative mb-6">
          <div
            className="w-24 h-24 rounded-3xl flex items-center justify-center shadow-2xl relative overflow-hidden animate-pulse"
            style={{
              backgroundColor: branding.primary_color || '#0284c7',
              boxShadow: '0 20px 40px -10px rgba(2, 132, 199, 0.4)',
            }}
          >
            {branding.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logo_url}
                alt={branding.app_name}
                className="w-16 h-16 object-contain"
              />
            ) : (
              <Utensils className="w-12 h-12 text-white" />
            )}
          </div>

          {/* Micro-badge decorativo */}
          <div className="absolute -bottom-1 -right-1 bg-slate-900 border border-slate-700 rounded-full p-1.5 shadow-md">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
        </div>

        {/* Nome do Aplicativo / Tenant */}
        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
          {branding.app_name}
        </h1>

        <p className="text-sm text-slate-400 font-medium mb-8">
          Controle de Refeições &middot; {branding.slug}
        </p>

        {/* Indicador de carregamento minimalista e refinado */}
        <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
          <div
            className="h-full rounded-full animate-indeterminate"
            style={{
              backgroundColor: branding.primary_color || '#0284c7',
            }}
          />
        </div>
      </div>
    </aside>
  );
}
