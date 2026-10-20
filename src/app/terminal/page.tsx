'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { ReceptionTerminal } from '@/components/terminal/ReceptionTerminal';
import { createBrowserClient } from '@/lib/supabase/client';
import { Loader2, Lock, User, AlertCircle, ArrowRight, ShieldCheck, Terminal as TerminalIcon } from 'lucide-react';
import { useBrand } from '@/components/branding/BrandProvider';

interface ProfileRecord {
  id: string;
  full_name: string | null;
  role: string;
  tenant_id: string;
}

interface UnitRecord {
  id: string;
  name: string;
}

interface MealTypeRecord {
  id: string;
  name: string;
}

interface TerminalContextState {
  tenantId: string;
  unitId: string;
  unitName: string;
  terminalId: string;
  operatorId: string;
  operatorName: string;
  operatorRole: string;
  mealTypeId: string;
  mealTypeName: string;
  studentPrice: number;
}

export default function TerminalPage() {
  const { branding } = useBrand();
  const [loading, setLoading] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);

  // Configuração física do terminal (Desacoplada da identidade do operador)
  const physicalTerminalId = 'TERM-01';

  const [context, setContext] = useState<TerminalContextState>({
    tenantId: 'e1000000-0000-0000-0000-000000000001',
    unitId: 'e2222222-2222-2222-2222-222222222221',
    unitName: 'RU Central Universitário',
    terminalId: physicalTerminalId,
    operatorId: '',
    operatorName: '',
    operatorRole: 'operator',
    mealTypeId: 'e5555555-5555-5555-5555-555555555552',
    mealTypeName: 'Almoço',
    studentPrice: 3.5,
  });

  // Função para carregar contexto do operador autenticado
  const initSessionFromAuthUser = useCallback(async (userId: string) => {
    const supabase = createBrowserClient();

    // 1. Validar Perfil e Papel do Operador
    const { data: profileData, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name, role, tenant_id')
      .eq('id', userId)
      .maybeSingle();

    const profile = profileData as unknown as ProfileRecord | null;

    if (profileErr || !profile) {
      throw new Error('Perfil de operador não encontrado.');
    }

    const allowedRoles = ['operator', 'unit_manager', 'supervisor', 'operations_director', 'admin_general'];
    if (!allowedRoles.includes(profile.role)) {
      throw new Error(`Perfil '${profile.role}' não possui permissão operacional neste terminal.`);
    }

    // 2. Localizar uma unidade ativa permitida pela RLS.
    // Perfis globais acessam todas as unidades do tenant; perfis operacionais
    // continuam limitados aos vínculos existentes em user_unit_access.
    const { data: unitData, error: unitError } = await supabase
      .from('units')
      .select('id, name')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'active')
      .order('name', { ascending: true })
      .limit(1)
      .maybeSingle();

    const unit = unitData as unknown as UnitRecord | null;
    if (unitError || !unit) {
      throw new Error(
        ['admin_general', 'operations_director'].includes(profile.role)
          ? 'Nenhuma unidade ativa foi encontrada para este tenant.'
          : 'Operador sem acesso a uma unidade. Solicite o vínculo ao administrador.'
      );
    }

    // 3. Obter Tipo de Refeição Ativa
    const { data: mealData } = await supabase
      .from('meal_types')
      .select('id, name')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    const mealType = mealData as unknown as MealTypeRecord | null;

    setContext({
      tenantId: profile.tenant_id,
      unitId: unit.id,
      unitName: unit.name,
      terminalId: physicalTerminalId,
      operatorId: profile.id,
      operatorName: profile.full_name || 'Operador',
      operatorRole: profile.role,
      mealTypeId: mealType?.id || 'e5555555-5555-5555-5555-555555555552',
      mealTypeName: mealType?.name || 'Almoço',
      studentPrice: 3.5,
    });

    setIsAuthenticated(true);

  }, [physicalTerminalId]);

  // Checagem de Sessão Existente ao Inicializar
  useEffect(() => {
    async function checkAuthSession() {
      try {
        const supabase = createBrowserClient();
        const { data: authData } = await supabase.auth.getUser();

        if (authData?.user) {
          await initSessionFromAuthUser(authData.user.id);
        } else {
          setIsAuthenticated(false);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    }

    checkAuthSession();
  }, [initSessionFromAuthUser]);

  // Handler de Login Manual do Operador
  const handleOperatorLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setAuthError('Preencha o e-mail e a senha do operador.');
      return;
    }

    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });

      if (error || !data.user) {
        setAuthError(
          error?.message === 'Invalid login credentials'
            ? 'Credenciais de operador inválidas. Verifique usuário e senha.'
            : error?.message || 'Erro na autenticação do operador.'
        );
        setIsAuthenticating(false);
        return;
      }

      try {
        await initSessionFromAuthUser(data.user.id);
      } catch (error) {
        await supabase.auth.signOut();
        throw error;
      }
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Handler de Encerramento de Turno / Troca de Operador
  const handleOperatorSignOut = async () => {
    setLoading(true);
    try {
      const supabase = createBrowserClient();
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      setLoginPassword('');
    } finally {
      setLoading(false);
    }
  };

  // 1. Tela de Carregamento
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center text-slate-600 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: branding.terminal_primary_color }} />
        <p className="text-sm font-mono tracking-wider">Verificando Credenciais do Terminal...</p>
      </div>
    );
  }

  // 2. Tela de Autenticação Segura do Operador (Caso não haja sessão ativa)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4 text-slate-900">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            {branding.logo_url ? (
              <img /* eslint-disable-line @next/next/no-img-element */ src={branding.logo_url} alt={branding.app_name} className="h-16 w-28 object-contain" />
            ) : (
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: branding.terminal_primary_color }}>
                <TerminalIcon className="w-8 h-8" />
              </div>
            )}
            <h1 className="text-xl font-black tracking-wide text-slate-900">{branding.app_name}</h1>
            <p className="text-xs font-mono text-slate-400">
              Terminal: {physicalTerminalId} &middot; Unidade Central
            </p>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] text-slate-600">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Autenticação Individual Obrigatória</span>
            </div>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleOperatorLogin} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-1">
                E-mail do Operador
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="operador@instituicao.br"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/10 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-1">
                Senha Operacional
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/10 outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isAuthenticating}
              className="w-full py-3.5 px-4 rounded-xl text-white font-black text-sm uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
              style={{ backgroundColor: branding.terminal_primary_color }}
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Validando Permissões...</span>
                </>
              ) : (
                <>
                  <span>Abrir Caixa / Iniciar Turno</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Auxílio de desenvolvimento: apenas preenchimento rápido de e-mail */}
          {process.env.NODE_ENV !== 'production' && (
            <div className="pt-3 border-t border-slate-800 text-center">
              <button
                type="button"
                onClick={() => {
                  setLoginEmail('operador@marefeicoes.com');
                  setLoginPassword('');
                }}
                className="text-[11px] text-slate-400 hover:text-sky-300 font-mono cursor-pointer transition-colors"
              >
                Preencher e-mail do Operador (operador@marefeicoes.com)
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3. Terminal Liberado para Operação
  return (
    <ReceptionTerminal
      tenantId={context.tenantId}
      unitId={context.unitId}
      unitName={context.unitName}
      terminalId={context.terminalId}
      operatorId={context.operatorId}
      operatorName={context.operatorName}
      operatorRole={context.operatorRole}
      mealTypeId={context.mealTypeId}
      mealTypeName={context.mealTypeName}
      studentPrice={context.studentPrice}
      onSignOut={handleOperatorSignOut}
    />
  );
}
