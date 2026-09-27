'use client';

import React, { useState } from 'react';
import { SplashScreen } from '@/components/branding/SplashScreen';
import LoginPage from './(auth)/login/page';
import { useBrand } from '@/components/branding/BrandProvider';
import {
  Layers,
  Database,
  ShieldCheck,
  CheckCircle2,
  Lock,
  RefreshCw,
} from 'lucide-react';

export default function AppEntry() {
  const [splashFinished, setSplashFinished] = useState<boolean>(false);
  const [showStatusPanel, setShowStatusPanel] = useState<boolean>(false);
  const { branding, tenantSlug, refreshBranding } = useBrand();

  return (
    <>
      {/* 1. Splash Screen Animado com carregamento paralelo de branding e sessão */}
      {!splashFinished && (
        <SplashScreen
          onFinish={() => {
            setSplashFinished(true);
          }}
        />
      )}

      {/* 2. Interface Principal: Página de Login preparada com Branding do Tenant */}
      <div className="relative">
        <LoginPage />

        {/* Botão flutuante para auditoria técnica da Sprint 1 */}
        <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2">
          <button
            onClick={() => setShowStatusPanel(!showStatusPanel)}
            className="flex items-center gap-2 px-3 py-2 bg-slate-900/90 border border-slate-700/80 rounded-full text-xs font-semibold text-slate-300 hover:text-white shadow-xl backdrop-blur-md cursor-pointer transition-all hover:border-slate-500"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Auditoria Sprint 1</span>
          </button>
        </div>

        {/* Modal de Status da Sprint 1 */}
        {showStatusPanel && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-slate-100">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">Sprint 1: Fundação SaaS e Branding</h2>
                    <p className="text-xs text-slate-400">Status dos entregáveis arquiteturais</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowStatusPanel(false)}
                  className="text-slate-400 hover:text-white text-sm cursor-pointer p-1"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">Hierarquia de Domínio e Tenant</p>
                    <p className="text-slate-400">
                      Tenant atual: <span className="font-mono text-sky-400">{tenantSlug}</span> (Empresa de alimentação). Instituições e unidades subordinadas com FK composta.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <Database className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">4 Migrations Versionadas</p>
                    <p className="text-slate-400">
                      <code>tenants</code>, <code>tenant_branding</code>, <code>institutions</code>, <code>units</code> criadas em <code>supabase/migrations/</code>.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">RLS Deny-by-Default & RPC Segura</p>
                    <p className="text-slate-400">
                      Tabelas administrativas bloqueadas para anon. Exposição pré-login exclusivamente pela RPC <code>get_public_tenant_branding</code> com <code>search_path = &apos;&apos;</code>.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">Proteção server-only</p>
                    <p className="text-slate-400">
                      <code>src/lib/supabase/admin.ts</code> protegido por <code>import &apos;server-only&apos;</code> contra importação acidental em client components.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-between items-center text-xs">
                <button
                  onClick={() => {
                    setSplashFinished(false);
                    setShowStatusPanel(false);
                    refreshBranding();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reexecutar Splash
                </button>

                <span className="text-slate-500 font-mono">
                  App: {branding.app_name}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
