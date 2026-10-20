'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBrand } from '@/components/branding/BrandProvider';
import { Utensils, Lock, Mail, ArrowRight, Shield, AlertCircle } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const { branding, tenantSlug } = useBrand();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.message === 'Invalid login credentials'
          ? 'Credenciais inválidas. Verifique o e-mail e a senha.'
          : error.message);
        setIsSubmitting(false);
        return;
      }

      if (data.user) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('role,status')
          .eq('id', data.user.id)
          .maybeSingle();
        const profile = profileData as { role: string; status: string } | null;

        if (profile?.status !== 'active') {
          await supabase.auth.signOut();
          setErrorMessage('Usuário inativo ou sem perfil de acesso válido.');
          setIsSubmitting(false);
          return;
        }

        const administrativeRoles = [
          'admin_general',
          'operations_director',
          'finance',
          'supervisor',
          'unit_manager',
        ];
        router.replace(administrativeRoles.includes(profile.role) ? '/admin' : '/terminal');
        router.refresh();
      }
    } catch (err) {
      setErrorMessage((err as Error).message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-white text-slate-900 relative overflow-hidden">
      {/* Luz ambiente de fundo usando as cores dinâmicas do tenant */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{
          backgroundColor: branding.primary_color || '#0284c7',
        }}
      />

      <div className="w-full max-w-md relative z-10">
        {/* Card Principal */}
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-2xl">
          {/* Cabeçalho da Marca */}
          <div className="flex flex-col items-center text-center mb-8">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
              style={{
                backgroundColor: branding.primary_color || '#0284c7',
              }}
            >
              {branding.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logo_url}
                  alt={branding.app_name}
                  className="w-10 h-10 object-contain"
                />
              ) : (
                <Utensils className="w-8 h-8 text-white" />
              )}
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {branding.app_name}
            </h1>
            <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-semibold">
              Tenant &middot; {tenantSlug}
            </p>
          </div>

          {/* Mensagem de Erro */}
          {errorMessage && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Formulário de Login */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5"
              >
                E-mail ou Matrícula
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@dominio.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 transition-all"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5"
              >
                Senha
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 shadow-lg hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50 mt-6"
              style={{
                backgroundColor: branding.primary_color || '#0284c7',
              }}
            >
              {isSubmitting ? (
                <span>Conectando...</span>
              ) : (
                <>
                  <span>Entrar no Sistema</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Rodapé Informativo */}
          <div className="mt-8 pt-6 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
              Ambiente Seguro
            </span>
            <span>Versão 1.0 (Sprint 1)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
