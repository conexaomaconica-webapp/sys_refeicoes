'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import { redefinePasswordAction } from './actions';

export function ResetPasswordForm() {
  const router = useRouter();
  const { branding } = useBrand();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await redefinePasswordAction(password, confirmation);
            if (!result.success) return setError(result.error);
            router.replace(result.redirectTo);
            router.refresh();
          });
        }}
        className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl"
      >
        <h1 className="text-2xl font-black">Definir nova senha</h1>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
        <label className="mt-6 block text-sm font-bold">
          Nova senha
          <div className="relative mt-1.5">
            <input
              type={showPassword ? 'text' : 'password'}
              minLength={6}
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 pr-10 font-normal"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <label className="mt-4 block text-sm font-bold">
          Confirmar senha
          <div className="relative mt-1.5">
            <input
              type={showConfirmation ? 'text' : 'password'}
              minLength={6}
              required
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 pr-10 font-normal"
            />
            <button
              type="button"
              onClick={() => setShowConfirmation((current) => !current)}
              aria-label={showConfirmation ? 'Ocultar confirmação' : 'Mostrar confirmação'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              {showConfirmation ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <button
          disabled={isPending}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-black text-white disabled:opacity-50"
          style={{ backgroundColor: branding.primary_color || '#C5161D' }}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar nova senha
        </button>
      </form>
    </main>
  );
}
